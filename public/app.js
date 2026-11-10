/* Ekakarsa Point - frontend. Semua data dari API server; tidak ada logika keamanan di sisi klien. */
(() => {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtDate = (d) => new Date(d).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
  const fmtDay = (d) => new Date(d).toLocaleDateString('id-ID', { dateStyle: 'long' });
  const signed = (n) => (n > 0 ? `+${n}` : `${n}`);

  const state = {
    me: null, members: [], divisions: [], programs: [], history: [], violations: [], users: [],
    vconfig: null, tab: 'dashboard',
  };
  const isAdmin = () => state.me?.role === 'admin';
  const isApprover = () => ['pembina', 'ketua', 'calon_ketua'].includes(state.me?.role);

  /* ---------------- API ---------------- */
  async function api(method, url, body) {
    const opts = { method, headers: { 'X-Requested-With': 'EkakarsaPoint' }, credentials: 'same-origin' };
    if (body instanceof FormData) opts.body = body;
    else if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    const res = await fetch(url, opts);
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && state.me && !url.startsWith('/api/auth/login')) { state.me = null; applyRole(); }
    if (!res.ok) throw new Error(data.error || `Gagal (${res.status})`);
    return data;
  }

  function toast(msg, type = 'ok') {
    const t = $('#toast');
    t.textContent = msg;
    t.className = `fixed bottom-4 left-1/2 -translate-x-1/2 z-[60] px-4 py-2 rounded-lg shadow-lg text-sm text-white max-w-[90vw] ${type === 'ok' ? 'bg-brandGreen' : 'bg-red-600'}`;
    clearTimeout(toast.t);
    toast.t = setTimeout(() => t.classList.add('hidden'), 3500);
  }

  // Menjalankan aksi dengan penanganan error & tombol non-aktif.
  async function run(btn, fn) {
    if (btn) btn.disabled = true;
    try { await fn(); } catch (e) { toast(e.message, 'err'); } finally { if (btn) btn.disabled = false; }
  }

  /* ---------------- Load data ---------------- */
  async function loadSummary() {
    const s = await api('GET', '/api/summary');
    Object.assign(state, { members: s.members, divisions: s.divisions, programs: s.programs });
  }
  async function loadHistory() {
    const m = $('#historyFilter').value;
    state.history = (await api('GET', `/api/history?limit=300${m ? `&member=${m}` : ''}`)).history;
  }
  async function loadViolations() {
    if (!state.me) { state.violations = []; return; }
    const r = await api('GET', '/api/violations');
    state.violations = r.violations;
    if (!state.vconfig) state.vconfig = await api('GET', '/api/violations/config');
  }
  async function loadUsers() { state.users = isAdmin() ? (await api('GET', '/api/users')).users : []; }

  async function refresh() {
    await Promise.all([loadSummary(), loadHistory(), loadViolations(), loadUsers()]);
    renderAll();
  }

  /* ---------------- Render ---------------- */
  function renderAll() {
    populateSelects();
    renderDashboard(); renderAnggota(); renderDivisi(); renderProker(); renderRiwayat(); renderViolations(); renderUsers();
  }

  const pointClass = (p) => (p < 0 ? 'text-red-600' : 'text-brandGreen');

  function renderDashboard() {
    $('#dashTotalPoin').textContent = state.members.reduce((a, m) => a + m.points, 0);
    $('#dashCount').textContent = state.members.length;
  }

  function renderAnggota() {
    const q = $('#searchAnggota').value.trim().toLowerCase();
    const list = [...state.members].sort((a, b) => a.kelas.localeCompare(b.kelas) || a.name.localeCompare(b.name))
      .filter((m) => !q || `${m.name} ${m.kelas} ${m.division || ''} ${m.jabatan}`.toLowerCase().includes(q));
    const admin = isAdmin();
    $('#tableAnggota').innerHTML = list.length ? list.map((m) => `
      <tr class="hover:bg-gray-50">
        <td class="p-3 font-medium text-gray-800"><button class="hover:text-brandGreen hover:underline text-left" data-action="member-history" data-id="${m.id}">${esc(m.name)}</button></td>
        <td class="p-3 text-gray-600">${esc(m.kelas || '-')}</td>
        <td class="p-3 text-gray-600">${esc(m.division || 'Tanpa Divisi')}</td>
        <td class="p-3 text-gray-600">${esc(m.jabatan)}</td>
        <td class="p-3 text-right font-bold ${pointClass(m.points)}">${m.points}</td>
        ${admin ? `<td class="p-3 text-center whitespace-nowrap">
          <button class="icon-btn text-brandGreen hover:bg-green-50" title="Tambah/Kurangi poin" data-action="points" data-id="${m.id}"><i class="fa-solid fa-plus-minus"></i></button>
          <button class="icon-btn text-sky-600 hover:bg-sky-50" title="Edit" data-action="edit-member" data-id="${m.id}"><i class="fa-solid fa-pen"></i></button>
          <button class="icon-btn text-red-600 hover:bg-red-50" title="Hapus" data-action="delete-member" data-id="${m.id}"><i class="fa-solid fa-trash"></i></button>
        </td>` : ''}
      </tr>`).join('') : `<tr><td colspan="6" class="p-4 text-center text-gray-400">${q ? 'Tidak ada yang cocok' : 'Belum ada data anggota'}</td></tr>`;
  }

  function renderDivisi() {
    $('#gridDivisi').innerHTML = state.divisions.map((d) => {
      const members = state.members.filter((m) => m.division_id === d.id);
      const progs = state.programs.filter((p) => p.division_id === d.id).length;
      return `<div class="bg-white p-5 rounded-xl shadow-sm border hover:shadow-md transition space-y-3">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-lg bg-green-50 text-brandGreen flex items-center justify-center"><i class="fa-solid fa-sitemap"></i></div>
          <div class="min-w-0"><h3 class="font-bold text-gray-800 truncate">${esc(d.name)}</h3>
          <p class="text-xs text-gray-500">${d.member_count} anggota &middot; ${progs} proker &middot; ${d.total_points} poin</p></div>
        </div>
        ${members.length ? `<ul class="text-xs text-gray-600 space-y-1">${members.map((m) => `<li class="flex justify-between gap-2"><span class="truncate">${esc(m.name)} <span class="text-gray-400">(${esc(m.jabatan)})</span></span><b class="${pointClass(m.points)}">${m.points}</b></li>`).join('')}</ul>` : '<p class="text-xs text-gray-400">Belum ada anggota</p>'}
      </div>`;
    }).join('') || '<p class="text-gray-400">Belum ada divisi</p>';
  }

  function renderProker() {
    const admin = isAdmin();
    $('#listProker').innerHTML = state.divisions.map((d) => {
      const progs = state.programs.filter((p) => p.division_id === d.id);
      return `<div class="bg-white rounded-xl shadow-sm border p-5">
        <h3 class="font-bold text-gray-800 mb-3 flex items-center gap-2"><i class="fa-solid fa-folder-open text-brandGold"></i> ${esc(d.name)}</h3>
        ${progs.length ? `<ul class="space-y-2">${progs.map((p) => `<li class="flex items-center justify-between gap-2 bg-gray-50 px-3 py-2 rounded-lg text-sm">
          <span><i class="fa-solid fa-circle-check text-brandGreen mr-2"></i>${esc(p.name)}</span>
          ${admin ? `<button class="icon-btn text-red-600 hover:bg-red-50" title="Hapus proker" data-action="delete-program" data-id="${p.id}"><i class="fa-solid fa-trash"></i></button>` : ''}
        </li>`).join('')}</ul>` : '<p class="text-sm text-gray-400">Belum ada program kerja</p>'}
      </div>`;
    }).join('');
  }

  const HISTORY_ICON = {
    poin_tambah: ['fa-arrow-up', 'bg-green-100 text-brandGreen'], poin_kurang: ['fa-arrow-down', 'bg-red-100 text-red-600'],
    pelanggaran: ['fa-gavel', 'bg-red-100 text-red-600'], poin_reset: ['fa-rotate-left', 'bg-gray-100 text-gray-600'],
    reset_semua: ['fa-triangle-exclamation', 'bg-red-100 text-red-700'], import_excel: ['fa-file-excel', 'bg-green-100 text-brandGreen'],
  };
  function renderRiwayat() {
    $('#listRiwayat').innerHTML = state.history.length ? state.history.map((h) => {
      const [icon, cls] = HISTORY_ICON[h.action] || ['fa-pen-to-square', 'bg-sky-100 text-sky-600'];
      const delta = h.delta != null && h.points_before != null
        ? `<div class="text-right shrink-0"><div class="font-bold ${h.delta < 0 ? 'text-red-600' : 'text-brandGreen'}">${signed(h.delta)}</div><div class="text-[11px] text-gray-400">${h.points_before} &rarr; ${h.points_after}</div></div>` : '';
      return `<div class="flex items-start gap-3 p-3 border rounded-lg">
        <div class="w-9 h-9 shrink-0 rounded-full flex items-center justify-center ${cls}"><i class="fa-solid ${icon}"></i></div>
        <div class="flex-1 min-w-0">
          ${h.member_name ? `<p class="font-semibold text-gray-800 text-sm">${esc(h.member_name)}</p>` : ''}
          <p class="text-sm text-gray-700">${esc(h.description)}</p>
          <p class="text-[11px] text-gray-400 mt-1">${fmtDate(h.created_at)} &middot; oleh ${esc(h.actor_name)}</p>
        </div>${delta}
      </div>`;
    }).join('') : '<p class="text-center text-gray-400 py-4">Belum ada riwayat</p>';
  }

  const STATUS = {
    pending: ['Menunggu persetujuan', 'bg-amber-100 text-amber-700'],
    approved: ['Disahkan', 'bg-green-100 text-brandGreen'],
    rejected: ['Ditolak', 'bg-gray-200 text-gray-600'],
  };
  function renderViolations() {
    const pending = state.violations.filter((v) => v.status === 'pending').length;
    const badge = $('#pendingBadge');
    badge.textContent = pending; badge.classList.toggle('hidden', !pending);
    if (state.vconfig) {
      $('#violationRule').textContent = `Setiap laporan wajib memiliki minimal ${state.vconfig.minWitnesses} saksi dan disetujui oleh ${state.vconfig.requiredApprovals} orang dari Pembina / Ketua / Calon Ketua OSIS sebelum poin dikurangi.`;
    }
    const f = $('#violationFilter').value;
    const list = state.violations.filter((v) => !f || v.status === f);
    $('#listViolations').innerHTML = list.length ? list.map((v) => {
      const [label, cls] = STATUS[v.status];
      const approvals = v.approvals.filter((a) => a.decision === 'approve').length;
      return `<div class="bg-white rounded-xl shadow-sm border p-4 flex flex-col sm:flex-row gap-3 sm:items-center">
        <div class="flex-1 min-w-0 space-y-1">
          <div class="flex flex-wrap items-center gap-2"><span class="chip ${cls}">${label}</span><span class="text-xs text-gray-400">#${v.id}${v.letter_number ? ` &middot; No. ${esc(v.letter_number)}` : ''}</span></div>
          <p class="font-semibold text-gray-800">${esc(v.member_name)} <span class="text-gray-400 font-normal text-sm">${v.member_kelas ? `Kelas ${esc(v.member_kelas)}` : ''}</span></p>
          <p class="text-sm text-gray-700">${esc(v.jenis)} <b class="text-red-600">(-${v.points} poin)</b></p>
          <p class="text-xs text-gray-400">${fmtDay(v.incident_date)} &middot; ${v.witnesses.length} saksi &middot; dilaporkan oleh ${esc(v.reporter_name)}${v.status === 'pending' ? ` &middot; persetujuan ${approvals}/${state.vconfig?.requiredApprovals ?? 1}` : ''}</p>
        </div>
        <div class="flex gap-2 shrink-0">
          <button class="btn-ghost" data-action="violation-detail" data-id="${v.id}">Detail</button>
          ${v.status === 'approved' ? `<a class="btn-primary" href="/surat/${v.id}" target="_blank" rel="noopener"><i class="fa-solid fa-print"></i> Surat</a>` : ''}
        </div>
      </div>`;
    }).join('') : '<p class="text-center text-gray-400 py-6 bg-white rounded-xl border">Belum ada laporan pelanggaran</p>';
  }

  function renderUsers() {
    if (!isAdmin()) { $('#listUsers').innerHTML = ''; return; }
    $('#listUsers').innerHTML = state.users.map((u) => `<div class="flex items-center justify-between py-2 gap-2">
      <div><b>${esc(u.name)}</b> <span class="text-gray-400">@${esc(u.username)}</span> <span class="chip bg-green-50 text-brandGreen ml-1">${esc(u.roleLabel)}</span></div>
      ${u.id === state.me.id ? '<span class="text-xs text-gray-400">Akun Anda</span>' : `<button class="icon-btn text-red-600 hover:bg-red-50" title="Hapus akun" data-action="delete-user" data-id="${u.id}"><i class="fa-solid fa-trash"></i></button>`}
    </div>`).join('');
  }

  function populateSelects() {
    const opts = state.divisions.map((d) => `<option value="${d.id}">${esc(d.name)}</option>`).join('');
    $$('.division-select').forEach((s) => { const v = s.value; s.innerHTML = `<option value="">Tanpa Divisi</option>${opts}`; s.value = v; });
    $$('.division-select-plain').forEach((s) => { const v = s.value; s.innerHTML = opts; if (v) s.value = v; });
    const hs = $('#historyFilter'); const hv = hs.value;
    hs.innerHTML = `<option value="">Semua anggota</option>${[...state.members].sort((a, b) => a.name.localeCompare(b.name)).map((m) => `<option value="${m.id}">${esc(m.name)}</option>`).join('')}`;
    hs.value = state.members.some((m) => String(m.id) === hv) ? hv : '';
  }

  function applyRole() {
    const me = state.me;
    $('#adminStatus').textContent = me ? `Mode: ${me.roleLabel} (${me.name})` : 'Mode: Pengunjung';
    $('#adminTabLabel').textContent = me ? 'Panel Pengelola' : 'Akses Admin';
    $('#adminLoginBox').classList.toggle('hidden', !!me);
    $('#adminPanel').classList.toggle('hidden', !me);
    $$('.admin-only').forEach((el) => el.classList.toggle('hidden', !isAdmin()));
    $$('.staff-only').forEach((el) => el.classList.toggle('hidden', !me));
    $('#approverInfo').classList.toggle('hidden', !isApprover());
    if (me) {
      $('#panelTitle').textContent = `Panel ${me.roleLabel}`;
      $('#panelSubtitle').textContent = isAdmin() ? 'Kelola anggota, poin, divisi, program kerja, dan akun' : 'Kelola laporan pelanggaran';
      $('#approverRole').textContent = me.roleLabel;
    }
    if (!me && state.tab === 'pelanggaran') switchTab('dashboard');
  }

  function switchTab(tab) {
    state.tab = tab;
    $$('main > section').forEach((s) => s.classList.toggle('hidden', s.id !== `tab-${tab}`));
    $$('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    try { sessionStorage.setItem('ep_tab', tab); } catch (_) { /* abaikan */ }
  }

  /* ---------------- Modal ---------------- */
  function openModal(html, onSubmit) {
    const m = $('#modal');
    $('#modalBody').innerHTML = html;
    m.classList.remove('hidden'); m.classList.add('flex');
    const form = $('#modalBody form');
    if (form && onSubmit) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const btn = form.querySelector('[type=submit]');
        run(btn, async () => { await onSubmit(form, new FormData(form)); });
      });
    }
    const first = $('#modalBody input:not([type=hidden]), #modalBody select, #modalBody textarea');
    if (first) first.focus();
  }
  function closeModal() { const m = $('#modal'); m.classList.add('hidden'); m.classList.remove('flex'); $('#modalBody').innerHTML = ''; }
  const modalButtons = (submitLabel, cls = 'btn-primary') => `<div class="flex justify-end gap-2 pt-2">
    <button type="button" class="btn-ghost" data-action="close-modal">Batal</button>
    <button type="submit" class="${cls}">${submitLabel}</button></div>`;

  function confirmModal(title, text, label, fn) {
    openModal(`<h3 class="text-lg font-bold text-gray-800">${esc(title)}</h3><p class="text-sm text-gray-600">${text}</p>
      <form>${modalButtons(esc(label), 'btn-danger')}</form>`, async () => { await fn(); closeModal(); });
  }

  const memberById = (id) => state.members.find((m) => m.id === Number(id));

  function openPoints(id) {
    const m = memberById(id);
    openModal(`<h3 class="text-lg font-bold text-gray-800">Tambah / Kurangi Poin</h3>
      <p class="text-sm text-gray-600"><b>${esc(m.name)}</b> &middot; poin saat ini <b class="${pointClass(m.points)}">${m.points}</b></p>
      <form class="space-y-3">
        <div class="grid grid-cols-2 gap-2">
          <label class="flex items-center gap-2 border rounded-lg p-2 cursor-pointer has-[:checked]:border-brandGreen has-[:checked]:bg-green-50"><input type="radio" name="dir" value="1" checked> <i class="fa-solid fa-plus text-brandGreen"></i> Tambah</label>
          <label class="flex items-center gap-2 border rounded-lg p-2 cursor-pointer has-[:checked]:border-red-500 has-[:checked]:bg-red-50"><input type="radio" name="dir" value="-1"> <i class="fa-solid fa-minus text-red-600"></i> Kurangi</label>
        </div>
        <input type="number" name="amount" min="1" max="100000" placeholder="Jumlah poin" class="input" required>
        <input type="text" name="reason" maxlength="300" placeholder="Alasan (cth: Panitia MPLS, terlambat rapat)" class="input" required>
        <p class="text-xs text-gray-400">Untuk pelanggaran tata tertib gunakan tab Pelanggaran (butuh saksi & persetujuan).</p>
        ${modalButtons('Simpan')}
      </form>`, async (_f, fd) => {
      const delta = Number(fd.get('amount')) * Number(fd.get('dir'));
      await api('POST', `/api/members/${id}/points`, { delta, reason: fd.get('reason') });
      closeModal(); toast(`Poin ${m.name} ${signed(delta)}`); await refresh();
    });
  }

  function openEditMember(id) {
    const m = memberById(id);
    const opts = state.divisions.map((d) => `<option value="${d.id}" ${d.id === m.division_id ? 'selected' : ''}>${esc(d.name)}</option>`).join('');
    openModal(`<h3 class="text-lg font-bold text-gray-800">Edit Anggota</h3>
      <form class="space-y-3">
        <div><label class="text-xs text-gray-500">Nama</label><input name="name" class="input mt-1" required maxlength="120" value="${esc(m.name)}"></div>
        <div class="grid grid-cols-2 gap-3">
          <div><label class="text-xs text-gray-500">Kelas</label><input name="kelas" class="input mt-1" maxlength="20" value="${esc(m.kelas)}"></div>
          <div><label class="text-xs text-gray-500">Jabatan</label><input name="jabatan" class="input mt-1" maxlength="60" value="${esc(m.jabatan)}"></div>
        </div>
        <div><label class="text-xs text-gray-500">Divisi</label><select name="divisionId" class="input mt-1"><option value="">Tanpa Divisi</option>${opts}</select></div>
        <p class="text-xs text-gray-400">Poin diubah lewat tombol <i class="fa-solid fa-plus-minus"></i> agar tercatat di riwayat.</p>
        ${modalButtons('Simpan')}
      </form>`, async (_f, fd) => {
      await api('PUT', `/api/members/${id}`, Object.fromEntries(fd));
      closeModal(); toast('Data anggota diperbarui'); await refresh();
    });
  }

  function openMemberHistory(id) {
    $('#historyFilter').value = String(id);
    switchTab('riwayat');
    run(null, async () => { await loadHistory(); renderRiwayat(); });
  }

  function importReportHtml(r) {
    const rowsTable = (items, cols) => `<div class="max-h-60 overflow-y-auto border rounded-lg"><table class="w-full text-xs"><tbody class="divide-y">${items.map((i) => `<tr>${cols.map((c) => `<td class="p-1.5">${esc(i[c])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
    return `<div class="grid grid-cols-3 gap-2 text-center text-sm">
        <div class="bg-green-50 rounded-lg p-2"><b class="text-lg text-brandGreen">${r.created.length}</b><br>baru</div>
        <div class="bg-sky-50 rounded-lg p-2"><b class="text-lg text-sky-700">${r.updated.length}</b><br>diperbarui</div>
        <div class="bg-gray-100 rounded-lg p-2"><b class="text-lg text-gray-600">${r.skipped.length + r.errors.length}</b><br>dilewati</div>
      </div>
      ${r.newDivisions.length ? `<p class="text-xs text-amber-700 bg-amber-50 p-2 rounded">Divisi baru yang akan dibuat: ${r.newDivisions.map(esc).join(', ')}</p>` : ''}
      ${r.created.length ? `<p class="text-xs font-semibold text-gray-600">Anggota baru</p>${rowsTable(r.created, ['row', 'name', 'kelas', 'division', 'jabatan', 'points'])}` : ''}
      ${r.skipped.length || r.errors.length ? `<p class="text-xs font-semibold text-gray-600">Dilewati</p>${rowsTable([...r.errors, ...r.skipped], ['row', 'name', 'reason'])}` : ''}`;
  }

  async function handleImport(form) {
    const file = form.file.files[0];
    if (!file) throw new Error('Pilih file .xlsx');
    const mode = form.update.checked ? 'update' : 'skip';
    const fd = new FormData(); fd.append('file', file);
    const preview = await api('POST', `/api/import/members?dryRun=1&mode=${mode}`, fd);
    const nothing = !preview.created.length && !preview.updated.length;
    openModal(`<h3 class="text-lg font-bold text-gray-800">Pratinjau Import: ${esc(file.name)}</h3>
      <p class="text-sm text-gray-600">${preview.total} baris terbaca.</p>${importReportHtml(preview)}
      <form>${nothing ? '<div class="flex justify-end"><button type="button" class="btn-ghost" data-action="close-modal">Tutup</button></div>' : modalButtons(`Import ${preview.created.length + preview.updated.length} Anggota`)}</form>`,
    async () => {
      const fd2 = new FormData(); fd2.append('file', file);
      const r = await api('POST', `/api/import/members?mode=${mode}`, fd2);
      closeModal(); form.reset();
      toast(`Import selesai: ${r.created.length} baru, ${r.updated.length} diperbarui`);
      await refresh();
    });
  }

  /* ---------- Pelanggaran ---------- */
  function memberOptions(exclude) {
    return [...state.members].sort((a, b) => a.name.localeCompare(b.name)).filter((m) => m.id !== exclude)
      .map((m) => `<option value="${m.id}">${esc(m.name)}${m.kelas ? ` (${esc(m.kelas)})` : ''}</option>`).join('');
  }
  function witnessRow(i) {
    return `<div class="witness grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2 items-center border rounded-lg p-2">
      <select name="w_member_${i}" class="input"><option value="">— Saksi dari anggota OSIS —</option>${memberOptions()}</select>
      <input name="w_name_${i}" class="input" placeholder="atau nama saksi lain + keterangan (cth: Bu Sri, Guru BK)" maxlength="240">
      <button type="button" class="icon-btn text-red-600 hover:bg-red-50" data-action="remove-witness" title="Hapus saksi"><i class="fa-solid fa-xmark"></i></button>
    </div>`;
  }

  function openViolationForm() {
    if (!state.members.length) { toast('Belum ada anggota', 'err'); return; }
    const min = state.vconfig?.minWitnesses ?? 2;
    const today = new Date().toISOString().slice(0, 10);
    openModal(`<h3 class="text-lg font-bold text-gray-800"><i class="fa-solid fa-gavel text-red-600"></i> Laporan Pelanggaran</h3>
      <form class="space-y-3">
        <div><label class="text-xs text-gray-500">Anggota terlapor</label><select name="memberId" class="input mt-1" required><option value="">— Pilih anggota —</option>${memberOptions()}</select></div>
        <div class="grid grid-cols-3 gap-3">
          <div class="col-span-2"><label class="text-xs text-gray-500">Jenis pelanggaran</label><input name="jenis" class="input mt-1" required maxlength="200" placeholder="cth: Tidak hadir rapat tanpa izin"></div>
          <div><label class="text-xs text-gray-500">Poin dikurangi</label><input type="number" name="points" min="1" max="1000" class="input mt-1" required></div>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div><label class="text-xs text-gray-500">Tanggal kejadian</label><input type="date" name="incidentDate" class="input mt-1" required max="${today}" value="${today}"></div>
          <div><label class="text-xs text-gray-500">Tempat</label><input name="location" class="input mt-1" maxlength="200" placeholder="cth: Ruang OSIS"></div>
        </div>
        <div><label class="text-xs text-gray-500">Kronologi / keterangan</label><textarea name="description" rows="3" maxlength="2000" class="input mt-1"></textarea></div>
        <div class="space-y-2">
          <div class="flex justify-between items-center"><label class="text-xs text-gray-500 font-semibold">Saksi (minimal ${min})</label>
            <button type="button" class="text-xs text-brandGreen hover:underline" data-action="add-witness"><i class="fa-solid fa-plus"></i> Tambah saksi</button></div>
          <div id="witnessList" class="space-y-2">${Array.from({ length: min }, (_, i) => witnessRow(i)).join('')}</div>
        </div>
        <p class="text-xs text-amber-700 bg-amber-50 p-2 rounded">Poin baru dikurangi setelah laporan disetujui Pembina / Ketua / Calon Ketua OSIS.</p>
        ${modalButtons('Kirim Laporan', 'btn-danger')}
      </form>`, async (form, fd) => {
      const witnesses = $$('.witness', form).map((row) => {
        const sel = row.querySelector('select').value;
        const raw = row.querySelector('input').value.trim();
        const [name, ...info] = raw.split(',');
        return sel ? { memberId: Number(sel) } : { name: (name || '').trim(), info: info.join(',').trim() };
      }).filter((w) => w.memberId || w.name);
      const body = Object.fromEntries(fd);
      await api('POST', '/api/violations', {
        memberId: Number(body.memberId), jenis: body.jenis, points: Number(body.points),
        incidentDate: body.incidentDate, location: body.location, description: body.description, witnesses,
      });
      closeModal(); toast('Laporan terkirim, menunggu persetujuan');
      await refresh();
    });
  }

  function openViolationDetail(id) {
    const v = state.violations.find((x) => x.id === Number(id));
    const [label, cls] = STATUS[v.status];
    const already = v.approvals.some((a) => a.user_id === state.me.id);
    const canDecide = isApprover() && v.status === 'pending' && v.reported_by !== state.me.id && !already;
    openModal(`<div class="flex items-start justify-between gap-2"><h3 class="text-lg font-bold text-gray-800">Laporan Pelanggaran #${v.id}</h3><span class="chip ${cls}">${label}</span></div>
      <dl class="text-sm grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        <dt class="text-gray-500">Terlapor</dt><dd class="font-semibold">${esc(v.member_name)}${v.member_kelas ? `, Kelas ${esc(v.member_kelas)}` : ''}${v.member_division ? ` &middot; ${esc(v.member_division)}` : ''}</dd>
        <dt class="text-gray-500">Pelanggaran</dt><dd>${esc(v.jenis)}</dd>
        <dt class="text-gray-500">Poin</dt><dd class="text-red-600 font-bold">-${v.points}</dd>
        <dt class="text-gray-500">Waktu/Tempat</dt><dd>${fmtDay(v.incident_date)}${v.location ? `, ${esc(v.location)}` : ''}</dd>
        <dt class="text-gray-500">Pelapor</dt><dd>${esc(v.reporter_name)}</dd>
        ${v.letter_number ? `<dt class="text-gray-500">No. Surat</dt><dd>${esc(v.letter_number)}</dd>` : ''}
      </dl>
      ${v.description ? `<p class="text-sm bg-gray-50 p-3 rounded-lg whitespace-pre-line">${esc(v.description)}</p>` : ''}
      <div><p class="text-xs font-semibold text-gray-500 mb-1">Saksi</p><ol class="text-sm list-decimal pl-5">${v.witnesses.map((w) => `<li>${esc(w.name)}${w.info ? ` <span class="text-gray-400">(${esc(w.info)})</span>` : ''}</li>`).join('')}</ol></div>
      <div><p class="text-xs font-semibold text-gray-500 mb-1">Keputusan</p>${v.approvals.length ? `<ul class="text-sm space-y-1">${v.approvals.map((a) => `<li><i class="fa-solid ${a.decision === 'approve' ? 'fa-check text-brandGreen' : 'fa-xmark text-red-600'}"></i> ${esc(a.user_name)} <span class="text-gray-400">(${esc(a.roleLabel)}, ${fmtDate(a.created_at)})</span>${a.note ? `: ${esc(a.note)}` : ''}</li>`).join('')}</ul>` : '<p class="text-sm text-gray-400">Belum ada</p>'}</div>
      ${canDecide ? `<form class="space-y-2 border-t pt-3">
        <textarea name="note" rows="2" maxlength="500" class="input" placeholder="Catatan (wajib jika menolak)"></textarea>
        <div class="flex justify-end gap-2">
          <button type="submit" name="decision" value="reject" class="btn-ghost text-red-600">Tolak</button>
          <button type="submit" name="decision" value="approve" class="btn-primary">Setujui & Kurangi Poin</button>
        </div></form>` : ''}
      ${v.status === 'pending' && isApprover() && !canDecide ? `<p class="text-xs text-gray-400">${v.reported_by === state.me.id ? 'Anda adalah pelapor, sehingga tidak dapat menyetujui laporan ini.' : 'Anda sudah memberikan keputusan.'}</p>` : ''}
      <div class="flex justify-end gap-2 border-t pt-3">
        ${isAdmin() && v.status !== 'approved' ? `<button type="button" class="btn-ghost text-red-600" data-action="delete-violation" data-id="${v.id}">Hapus Laporan</button>` : ''}
        ${v.status === 'approved' ? `<a class="btn-primary" href="/surat/${v.id}" target="_blank" rel="noopener"><i class="fa-solid fa-print"></i> Cetak Surat</a>` : ''}
        <button type="button" class="btn-ghost" data-action="close-modal">Tutup</button>
      </div>`);
    const form = $('#modalBody form');
    if (form) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const decision = e.submitter?.value;
        run(e.submitter, async () => {
          const r = await api('POST', `/api/violations/${v.id}/decision`, { decision, note: form.note.value });
          closeModal();
          toast(r.status === 'approved' ? `Disahkan. Surat No. ${r.letterNumber}` : r.status === 'rejected' ? 'Laporan ditolak' : `Persetujuan tercatat (${r.approvals}/${state.vconfig.requiredApprovals})`);
          await refresh();
        });
      });
    }
  }

  function openPassword() {
    openModal(`<h3 class="text-lg font-bold text-gray-800">Ganti Password</h3>
      <form class="space-y-3">
        <input type="password" name="oldPassword" class="input" placeholder="Password lama" required autocomplete="current-password">
        <input type="password" name="newPassword" class="input" placeholder="Password baru (min. 8)" minlength="8" required autocomplete="new-password">
        ${modalButtons('Simpan')}
      </form>`, async (_f, fd) => {
      await api('POST', '/api/auth/password', Object.fromEntries(fd));
      closeModal(); toast('Password diganti. Sesi di perangkat lain otomatis keluar.');
    });
  }

  /* ---------------- Events ---------------- */
  function bindForm(id, fn) {
    const form = document.getElementById(id);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      run(form.querySelector('[type=submit]'), () => fn(form, new FormData(form)));
    });
  }

  function bind() {
    $('#tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) switchTab(b.dataset.tab); });
    $('#searchAnggota').addEventListener('input', renderAnggota);
    $('#violationFilter').addEventListener('change', renderViolations);
    $('#historyFilter').addEventListener('change', () => run(null, async () => { await loadHistory(); renderRiwayat(); }));
    $('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

    document.addEventListener('click', (e) => {
      const el = e.target.closest('[data-action]');
      if (!el) return;
      const { action, id } = el.dataset;
      const actions = {
        'close-modal': closeModal,
        points: () => openPoints(id),
        'edit-member': () => openEditMember(id),
        'member-history': () => openMemberHistory(id),
        'delete-member': () => { const m = memberById(id); confirmModal('Hapus Anggota', `Hapus <b>${esc(m.name)}</b>? Riwayatnya tetap tersimpan.`, 'Hapus', async () => { await api('DELETE', `/api/members/${id}`); toast('Anggota dihapus'); await refresh(); }); },
        'delete-program': () => { const p = state.programs.find((x) => x.id === Number(id)); confirmModal('Hapus Program Kerja', `Hapus proker <b>${esc(p.name)}</b>?`, 'Hapus', async () => { await api('DELETE', `/api/programs/${id}`); toast('Proker dihapus'); await refresh(); }); },
        'delete-division': () => {
          const sel = $('#delDivisiSelect'); const d = state.divisions.find((x) => x.id === Number(sel.value));
          if (!d) return;
          confirmModal('Hapus Divisi', `Hapus <b>${esc(d.name)}</b>? ${d.member_count} anggota akan menjadi "Tanpa Divisi" dan proker divisi ini ikut terhapus.`, 'Hapus', async () => { await api('DELETE', `/api/divisions/${d.id}`); toast('Divisi dihapus'); await refresh(); });
        },
        'delete-user': () => { const u = state.users.find((x) => x.id === Number(id)); confirmModal('Hapus Akun', `Hapus akun <b>${esc(u.name)}</b> (${esc(u.roleLabel)})?`, 'Hapus', async () => { await api('DELETE', `/api/users/${id}`); toast('Akun dihapus'); await refresh(); }); },
        'open-violation-form': openViolationForm,
        'violation-detail': () => openViolationDetail(id),
        'delete-violation': () => confirmModal('Hapus Laporan', `Hapus laporan #${esc(id)}?`, 'Hapus', async () => { await api('DELETE', `/api/violations/${id}`); toast('Laporan dihapus'); await refresh(); }),
        'add-witness': () => { const list = $('#witnessList'); list.insertAdjacentHTML('beforeend', witnessRow(list.children.length + Date.now())); },
        'remove-witness': () => el.closest('.witness').remove(),
        'open-password': openPassword,
        logout: () => run(el, async () => { await api('POST', '/api/auth/logout'); state.me = null; applyRole(); await refresh(); toast('Anda telah keluar'); }),
      };
      if (actions[action]) { e.preventDefault(); actions[action](); }
    });

    bindForm('loginForm', async (form, fd) => {
      const r = await api('POST', '/api/auth/login', Object.fromEntries(fd));
      state.me = r.user; form.reset(); applyRole(); await refresh();
      toast(`Selamat datang, ${r.user.name}`);
    });
    bindForm('addMemberForm', async (form, fd) => {
      await api('POST', '/api/members', Object.fromEntries(fd));
      form.reset(); form.jabatan.value = 'Anggota'; form.points.value = 0; toast('Anggota ditambahkan'); await refresh();
    });
    bindForm('addDivisionForm', async (form, fd) => { await api('POST', '/api/divisions', Object.fromEntries(fd)); form.reset(); toast('Divisi ditambahkan'); await refresh(); });
    bindForm('addProgramForm', async (form, fd) => { await api('POST', '/api/programs', Object.fromEntries(fd)); form.name.value = ''; toast('Proker ditambahkan'); await refresh(); });
    bindForm('addUserForm', async (form, fd) => { await api('POST', '/api/users', Object.fromEntries(fd)); form.reset(); toast('Akun dibuat'); await refresh(); });
    bindForm('importForm', (form) => handleImport(form));
    bindForm('resetForm', async (form, fd) => {
      const body = Object.fromEntries(fd);
      if (body.confirm !== 'RESET') throw new Error('Ketik RESET (huruf besar) untuk konfirmasi');
      const r = await api('POST', '/api/members/reset-points', body);
      form.reset(); toast(`Poin ${r.affected} anggota direset ke 0`); await refresh();
    });
  }

  async function init() {
    bind();
    let tab = 'dashboard';
    try { tab = sessionStorage.getItem('ep_tab') || tab; } catch (_) { /* abaikan */ }
    try { state.me = (await api('GET', '/api/auth/me')).user; } catch (_) { state.me = null; }
    applyRole();
    switchTab(document.getElementById(`tab-${tab}`) && (tab !== 'pelanggaran' || state.me) ? tab : 'dashboard');
    try { await refresh(); } catch (e) { toast(e.message, 'err'); }
    // Segarkan data publik berkala agar anggota melihat perubahan terbaru.
    setInterval(() => { if (document.visibilityState === 'visible' && $('#modal').classList.contains('hidden')) refresh().catch(() => {}); }, 30000);
  }

  document.addEventListener('DOMContentLoaded', init);
})();
