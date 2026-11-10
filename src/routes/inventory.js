// Manajemen barang (inventaris OSIS) & peminjaman barang.
const express = require('express');
const { z } = require('zod');
const { query, tx } = require('../db');
const { requireAdmin, requireAuth, ROLE_LABEL } = require('../auth');
const { wrap, parseBody, idParam, HttpError, logHistory } = require('../util');

const router = express.Router();
const actor = (req) => `${req.user.display_name} (${ROLE_LABEL[req.user.role]})`;
const text = (label, max) => z.string().trim().max(max, `${label} terlalu panjang`).default('');
const name = (label, max = 120) => z.string().trim().min(1, `${label} wajib diisi`).max(max, `${label} terlalu panjang`);
const CONDITIONS = ['baik', 'rusak_ringan', 'rusak_berat'];
const CONDITION_LABEL = { baik: 'Baik', rusak_ringan: 'Rusak ringan', rusak_berat: 'Rusak berat' };
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format tanggal tidak valid');

const ITEM_SELECT = `
  SELECT i.id, i.name, i.category, i.quantity, i.unit, i.condition, i.location, i.notes, i.updated_at,
         COALESCE(l.borrowed, 0)::int AS borrowed
  FROM items i
  LEFT JOIN (SELECT item_id, sum(quantity) AS borrowed FROM item_loans WHERE status='dipinjam' GROUP BY item_id) l
    ON l.item_id = i.id`;

const LOAN_SELECT = `
  SELECT id, item_id, item_name, quantity, member_id, borrower_name, purpose,
         to_char(loan_date,'YYYY-MM-DD') AS loan_date, to_char(due_date,'YYYY-MM-DD') AS due_date,
         status, returned_at, return_condition, return_note, recorded_by, returned_by, created_at
  FROM item_loans`;

router.get('/items', wrap(async (_req, res) => {
  const [items, active, done] = await Promise.all([
    query(`${ITEM_SELECT} ORDER BY lower(i.category), lower(i.name)`),
    query(`${LOAN_SELECT} WHERE status='dipinjam' ORDER BY loan_date, id`),
    query(`${LOAN_SELECT} WHERE status='dikembalikan' ORDER BY returned_at DESC, id DESC LIMIT 100`),
  ]);
  res.json({ items: items.rows, activeLoans: active.rows, returnedLoans: done.rows });
}));

const itemSchema = z.object({
  name: name('Nama barang', 120),
  category: text('Kategori', 60),
  quantity: z.coerce.number({ message: 'Jumlah harus angka' }).int('Jumlah harus bilangan bulat').min(0, 'Jumlah tidak boleh negatif').max(100000),
  unit: z.string().trim().max(20).default('buah').transform((v) => v || 'buah'),
  condition: z.enum(CONDITIONS, { message: 'Kondisi tidak valid' }).default('baik'),
  location: text('Lokasi', 120),
  notes: text('Catatan', 500),
});

router.post('/items', requireAdmin, wrap(async (req, res) => {
  const b = parseBody(itemSchema, req.body);
  const out = await tx(async (db) => {
    const { rows } = await db.query(
      `INSERT INTO items (name, category, quantity, unit, condition, location, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [b.name, b.category, b.quantity, b.unit, b.condition, b.location, b.notes]);
    await logHistory(db, { action: 'barang_tambah', description: `Menambahkan barang "${b.name}" (${b.quantity} ${b.unit})`, actor: actor(req) });
    return rows[0];
  });
  res.status(201).json(out);
}));

router.put('/items/:id', requireAdmin, wrap(async (req, res) => {
  const id = idParam(req.params.id);
  const b = parseBody(itemSchema, req.body);
  const out = await tx(async (db) => {
    await db.query('SELECT id FROM items WHERE id=$1 FOR UPDATE', [id]);
    const cur = await db.query(`${ITEM_SELECT} WHERE i.id=$1`, [id]);
    if (!cur.rows[0]) throw new HttpError(404, 'Barang tidak ditemukan.');
    if (b.quantity < cur.rows[0].borrowed) {
      throw new HttpError(400, `Jumlah tidak boleh kurang dari yang sedang dipinjam (${cur.rows[0].borrowed}).`);
    }
    const { rows } = await db.query(
      `UPDATE items SET name=$1, category=$2, quantity=$3, unit=$4, condition=$5, location=$6, notes=$7, updated_at=now()
       WHERE id=$8 RETURNING *`,
      [b.name, b.category, b.quantity, b.unit, b.condition, b.location, b.notes, id]);
    await logHistory(db, { action: 'barang_ubah', description: `Memperbarui barang "${b.name}" (${b.quantity} ${b.unit}, ${CONDITION_LABEL[b.condition]})`, actor: actor(req) });
    return rows[0];
  });
  res.json(out);
}));

router.delete('/items/:id', requireAdmin, wrap(async (req, res) => {
  const id = idParam(req.params.id);
  await tx(async (db) => {
    const cur = await db.query(`${ITEM_SELECT} WHERE i.id=$1`, [id]);
    if (!cur.rows[0]) throw new HttpError(404, 'Barang tidak ditemukan.');
    if (cur.rows[0].borrowed > 0) throw new HttpError(400, 'Barang masih dipinjam. Selesaikan pengembalian terlebih dahulu.');
    await db.query('DELETE FROM items WHERE id=$1', [id]);
    await logHistory(db, { action: 'barang_hapus', description: `Menghapus barang "${cur.rows[0].name}"`, actor: actor(req) });
  });
  res.json({ ok: true });
}));

/* ---------------- Peminjaman ---------------- */

router.post('/loans', requireAuth, wrap(async (req, res) => {
  const b = parseBody(z.object({
    itemId: z.coerce.number().int().positive('Pilih barang'),
    quantity: z.coerce.number().int('Jumlah harus bilangan bulat').min(1, 'Jumlah minimal 1').max(100000),
    memberId: z.union([z.coerce.number().int().positive(), z.literal(''), z.null()]).optional().transform((v) => (v ? Number(v) : null)),
    borrowerName: text('Nama peminjam', 120),
    purpose: text('Keperluan', 300),
    loanDate: dateStr.optional().or(z.literal('')),
    dueDate: dateStr.optional().or(z.literal('')),
  }), req.body);
  const out = await tx(async (db) => {
    // Kunci baris barang dulu, baru hitung stok (snapshot baru) agar dua peminjaman bersamaan tidak melebihi stok.
    await db.query('SELECT id FROM items WHERE id=$1 FOR UPDATE', [b.itemId]);
    const it = await db.query(`${ITEM_SELECT} WHERE i.id=$1`, [b.itemId]);
    const item = it.rows[0];
    if (!item) throw new HttpError(404, 'Barang tidak ditemukan.');
    const available = item.quantity - item.borrowed;
    if (b.quantity > available) throw new HttpError(400, `Stok tersedia hanya ${available} ${item.unit}.`);
    let borrower = b.borrowerName;
    if (b.memberId) {
      const m = await db.query('SELECT name, kelas FROM members WHERE id=$1', [b.memberId]);
      if (!m.rows[0]) throw new HttpError(404, 'Anggota tidak ditemukan.');
      borrower = m.rows[0].name + (m.rows[0].kelas ? ` (${m.rows[0].kelas})` : '');
    }
    if (!borrower) throw new HttpError(400, 'Pilih anggota atau isi nama peminjam.');
    const loanDate = b.loanDate || null;
    const dueDate = b.dueDate || null;
    if (dueDate && loanDate && dueDate < loanDate) throw new HttpError(400, 'Tanggal kembali tidak boleh sebelum tanggal pinjam.');
    const { rows } = await db.query(
      `INSERT INTO item_loans (item_id, item_name, quantity, member_id, borrower_name, purpose, loan_date, due_date, recorded_by)
       VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7::date, CURRENT_DATE),$8,$9) RETURNING id`,
      [item.id, item.name, b.quantity, b.memberId, borrower, b.purpose, loanDate, dueDate, actor(req)]);
    await logHistory(db, { action: 'barang_pinjam', description: `${borrower} meminjam ${b.quantity} ${item.unit} "${item.name}"${b.purpose ? ` untuk ${b.purpose}` : ''}`, actor: actor(req) });
    return rows[0];
  });
  res.status(201).json(out);
}));

router.post('/loans/:id/return', requireAuth, wrap(async (req, res) => {
  const id = idParam(req.params.id);
  const b = parseBody(z.object({
    condition: z.enum(CONDITIONS, { message: 'Kondisi tidak valid' }).default('baik'),
    note: text('Catatan', 300),
  }), req.body);
  await tx(async (db) => {
    const { rows } = await db.query('SELECT * FROM item_loans WHERE id=$1 FOR UPDATE', [id]);
    const loan = rows[0];
    if (!loan) throw new HttpError(404, 'Data peminjaman tidak ditemukan.');
    if (loan.status !== 'dipinjam') throw new HttpError(400, 'Barang ini sudah dikembalikan.');
    await db.query(
      `UPDATE item_loans SET status='dikembalikan', returned_at=now(), return_condition=$1, return_note=$2, returned_by=$3 WHERE id=$4`,
      [b.condition, b.note, actor(req), id]);
    await logHistory(db, { action: 'barang_kembali', description: `${loan.borrower_name} mengembalikan ${loan.quantity} "${loan.item_name}" (kondisi: ${CONDITION_LABEL[b.condition]})${b.note ? `: ${b.note}` : ''}`, actor: actor(req) });
  });
  res.json({ ok: true });
}));

router.delete('/loans/:id', requireAdmin, wrap(async (req, res) => {
  const id = idParam(req.params.id);
  await tx(async (db) => {
    const { rows } = await db.query('DELETE FROM item_loans WHERE id=$1 RETURNING borrower_name, item_name, quantity', [id]);
    if (!rows[0]) throw new HttpError(404, 'Data peminjaman tidak ditemukan.');
    await logHistory(db, { action: 'barang_pinjam_hapus', description: `Menghapus catatan peminjaman ${rows[0].quantity} "${rows[0].item_name}" oleh ${rows[0].borrower_name}`, actor: actor(req) });
  });
  res.json({ ok: true });
}));

module.exports = router;
