(() => {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const day = (d) => new Date(d).toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const date = (d) => new Date(d).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
  const box = document.getElementById('letter');

  async function load() {
    const id = location.pathname.split('/').pop();
    const res = await fetch(`/api/violations/${encodeURIComponent(id)}`, { credentials: 'same-origin' });
    const v = await res.json().catch(() => ({}));
    if (res.status === 401) { box.innerHTML = '<p class="text-center py-20">Silakan masuk sebagai pengelola terlebih dahulu untuk melihat surat ini.</p>'; return; }
    if (!res.ok) { box.innerHTML = `<p class="text-center py-20">${esc(v.error || 'Surat tidak ditemukan.')}</p>`; return; }
    if (v.status !== 'approved') { box.innerHTML = '<p class="text-center py-20">Surat hanya tersedia untuk laporan yang sudah disahkan.</p>'; return; }
    document.title = `Surat Keterangan Pelanggaran ${v.letter_number}`;
    const approvers = v.approvals.filter((a) => a.decision === 'approve');
    const sigs = [
      ...approvers.map((a) => ({ title: `Menyetujui,<br>${esc(a.roleLabel)}`, name: a.user_name })),
      { title: 'Yang bersangkutan,', name: v.member_name },
    ];
    box.innerHTML = `
      <header class="text-center border-b-4 border-double border-black pb-3 mb-6">
        <h2 class="text-base font-bold uppercase tracking-wide">Organisasi Siswa Intra Sekolah (OSIS)</h2>
        <h1 class="text-xl font-bold uppercase">${esc(v.schoolName)}</h1>
        <p class="text-sm">Sistem Manajemen Poin Ekakarsa Point</p>
      </header>
      <div class="text-center mb-6">
        <h2 class="text-lg font-bold underline uppercase">Surat Keterangan Pelanggaran</h2>
        <p>Nomor: ${esc(v.letter_number)}</p>
      </div>
      <p class="mb-3">Yang bertanda tangan di bawah ini menerangkan bahwa pengurus OSIS:</p>
      <table class="data mb-4 ml-6"><tbody>
        <tr><td class="w-40">Nama</td><td>:</td><td><b>${esc(v.member_name)}</b></td></tr>
        <tr><td>Kelas</td><td>:</td><td>${esc(v.member_kelas || '-')}</td></tr>
        <tr><td>Divisi</td><td>:</td><td>${esc(v.member_division || '-')}</td></tr>
      </tbody></table>
      <p class="mb-3">telah terbukti melakukan pelanggaran dengan rincian sebagai berikut:</p>
      <table class="data mb-4 ml-6"><tbody>
        <tr><td class="w-40">Jenis pelanggaran</td><td>:</td><td>${esc(v.jenis)}</td></tr>
        <tr><td>Hari, tanggal</td><td>:</td><td>${day(v.incident_date)}</td></tr>
        <tr><td>Tempat</td><td>:</td><td>${esc(v.location || '-')}</td></tr>
        <tr><td>Pengurangan poin</td><td>:</td><td><b>${v.points} poin</b></td></tr>
        ${v.description ? `<tr><td>Kronologi</td><td>:</td><td class="whitespace-pre-line">${esc(v.description)}</td></tr>` : ''}
      </tbody></table>
      <p class="mb-2">Pelanggaran tersebut disaksikan oleh:</p>
      <ol class="list-decimal ml-12 mb-4">${v.witnesses.map((w) => `<li>${esc(w.name)}${w.info ? ` (${esc(w.info)})` : ''}</li>`).join('')}</ol>
      <p class="mb-8 text-justify">Laporan ini dibuat oleh ${esc(v.reporter_name)} dan telah disahkan pada ${date(v.decided_at)}. Pengurangan poin telah dicatat dalam sistem. Demikian surat keterangan ini dibuat untuk dipergunakan sebagaimana mestinya.</p>
      <p class="text-right mb-4">${date(v.decided_at)}</p>
      <div class="grid gap-6 text-center ${sigs.length >= 3 ? 'grid-cols-3' : 'grid-cols-2'}">
        ${sigs.map((s) => `<div class="sig flex flex-col justify-between"><p>${s.title}</p><p class="font-bold underline mt-16">${esc(s.name)}</p></div>`).join('')}
      </div>
      <p class="text-[9pt] text-gray-500 mt-10">Dokumen dibuat otomatis oleh Ekakarsa Point &middot; ID laporan #${v.id}</p>`;
  }

  document.getElementById('printBtn').addEventListener('click', () => window.print());
  load().catch(() => { box.innerHTML = '<p class="text-center py-20">Gagal memuat surat.</p>'; });
})();
