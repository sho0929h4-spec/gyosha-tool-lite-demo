// tools/demo/demo.js — お試し版（dist-demo）だけで読む。tools/build-demo.sh が js/fake-sb.js の直後に入れる。
// ① 初めて開いたとき（偽DBが無い）: 架空のお試しデータを入れる（管理者として。画面の API をそのまま使う）
// ② 偽DBを localStorage に保存（変わったら 1.5 秒ごと・画面を離れたとき）。データはこのブラウザの中だけ
// ③ ログイン画面に「管理者で試す」「作業担当者で試す」・上に「お試し版」の帯（役割を切り替える）・設定に「お試しデータを最初に戻す」
// 本物の Supabase には一切つながない（偽バックエンドはメモリの中だけで動く）。名前・住所・電話・メールはすべて架空
(() => {
  const D = window.__demo, F = window.__fake;
  if (!D || !F) return;

  /* ---------- ② 保存 ---------- */
  let lastSig = null, saving = false, full = false;
  async function save() {
    if (saving) return;
    const sig = JSON.stringify(F.db) + '|' + [...F.files.keys()].join() + '|' + [...F.pubFiles.keys()].join();
    if (sig === lastSig) return;
    saving = true;
    try {
      // shortcut: 写真は data URL で丸ごと入れる（localStorage はおよそ 5MB まで）。足りなくなったら IndexedDB に替える
      full = !D.set(D.KEY_DB, JSON.stringify(await F.snapshot()));
      if (!full) lastSig = sig;
      const w = document.getElementById('demo-full');
      if (w) w.hidden = !full;
    } catch (e) { console.warn('お試しデータを保存できませんでした', e); }
    finally { saving = false; }
  }

  /* ---------- ① お試しデータ ---------- */
  const pad = n => String(n).padStart(2, '0');
  // 今日から n 日後の h:m（日本時間）
  const at = (n, h, m) => {
    const j = new Date(Date.now() + 9 * 3600e3);
    return new Date(Date.UTC(j.getUTCFullYear(), j.getUTCMonth(), j.getUTCDate() + n, h - 9, m || 0)).toISOString();
  };
  const ymd = n => at(n, 12).slice(0, 10);
  // 小さい写真（JPEG）をその場で描く。E2E と同じく本物の写真は使わない
  const photo = (label, color) => new Promise(res => {
    const c = document.createElement('canvas');
    c.width = 480; c.height = 360;
    const g = c.getContext('2d');
    g.fillStyle = color; g.fillRect(0, 0, 480, 360);
    g.fillStyle = 'rgba(255,255,255,.25)';
    for (let i = 0; i < 6; i++) g.fillRect(40 + i * 70, 60 + (i % 2) * 40, 50, 220);
    g.fillStyle = '#fff'; g.font = 'bold 30px sans-serif'; g.textAlign = 'center';
    g.fillText(label, 240, 170);
    g.font = '18px sans-serif'; g.fillText('お試し用の画像', 240, 210);
    c.toBlob(b => res(new File([b], 'demo.jpg', { type: 'image/jpeg' })), 'image/jpeg', 0.7);
  });

  async function seed() {
    const { db, ids } = F;
    const u = () => crypto.randomUUID();
    // 偽バックエンドの初期データ（E2E 用）を片付けて、架空の会社に置き換える
    ['cases', 'case_actions', 'clients', 'timeline_entries'].forEach(t => { db[t].length = 0; });
    Object.assign(db.orgs[0], { name: 'お試し工業', plan: 'standard', address: '東京都架空区見本町1-1-1',
      tel: '03-0000-0000', email: 'info@example.invalid' });
    Object.assign(db.memberships[0], { display_name: '田中', email: 'tanaka@example.invalid', phone: '090-0000-0001' });
    Object.assign(db.memberships[1], { display_name: '佐藤', email: 'sato@example.invalid', phone: '090-0000-0002' });
    db.org_usage[0].record_count = 0;
    const now = new Date().toISOString();
    const K = u();
    db.clients.push({ id: K, org_id: ids.ORG_ID, name: 'みどり管理（架空）', contact_name: '見本 一郎', email: 'kanri@example.invalid',
      tel: '03-0000-1111', billing_mode: 'single', memo: null, created_by: ids.U_ME, created_at: now, updated_at: now });

    ctx = await getMyContext(); // 画面の API（PhasesApi など）は ctx を使う。boot がもう一度入れ直す
    const newCase = async (f, request) => {
      const c = await CasesApi.createCase(Object.assign({ client_id: K, client_name: 'みどり管理（架空）', client_email: 'kanri@example.invalid',
        assignee_id: ids.U_ME, status: 'open' }, f));
      if (request) await CasesApi.saveRequest(c.id, request);
      return Object.assign(c, { client_billing_mode: 'single' });
    };
    const phase = async (c, kind, set, label) => {
      const p = await PhasesApi.create(c.id, kind, c, null, label);
      if (set && set.done_at) { // 済んだ対応: 自動で作られた報告書の下書きと担当者URLは要らない
        const r = new Set(db.reports.filter(x => x.phase_id === p.id).map(x => x.id));
        for (const t of ['reports', 'report_shares']) db[t].splice(0, db[t].length, ...db[t].filter(x => !r.has(t === 'reports' ? x.id : x.report_id)));
      }
      if (!set) return p;
      const r = await sb.from('case_phases').update(set).eq('id', p.id).select().single();
      if (r.error) throw r.error;
      return r.data;
    };
    const draftOf = async p => (await ReportsApi.ensurePhaseReport(p, null, {})) || { report: (await sb.from('reports').select('*').eq('phase_id', p.id)).data[0] };
    const est = (c, p, status, no, lines, extra) => {
      const sub = lines.reduce((s, l) => s + l.amount, 0), tax = Math.floor(sub / 10);
      db.estimates.push({ id: u(), org_id: ids.ORG_ID, case_id: c.id, phase_id: p.id, series_id: u(), version: 1, status, number: status === 'draft' ? null : no,
        data: { subject: PhaseLogic.placeName(c) + ' ' + PhaseLogic.kindLabel(p.kind), notes: { koki: { on: true, val: '1' }, jikan: { on: true, val: '9:00〜17:00' }, hotel: 'none', katazuke: { sel: 'none' }, extra: '' } },
        lines, subtotal: sub, tax, total: sub + tax, linked_request_ids: [], created_by: ids.U_ME, created_at: now, updated_at: now,
        issued_at: null, sent_at: null, accepted_at: null, ...extra });
    };
    const L = (description, quantity, unit, unitPrice) => ({ description, detail: '', quantity, unit, unitPrice, amount: quantity * unitPrice });
    const talk = (c, p, from, subject, body, ago) => db.staff_messages.push({ id: u(), org_id: ids.ORG_ID, case_id: c.id, phase_id: p ? p.id : null,
      from_user: from, to_user: from === ids.U_ME ? ids.U_STAFF : null, subject, body, attachments: [], read_at: null, reply_to: null,
      created_at: new Date(Date.now() - ago * 60e3).toISOString(), source: 'staff', daily_date: null, as_client: false });

    // A. グリーンハイツ 203: 調査済み → 原因元工事（昨日。報告書は提出済み・写真つき・見積は承諾）→ 復旧工事（3日後。見積は提出・工事掲示）
    const A = await newCase({ name: 'グリーンハイツ（架空）', room: '203', address: '東京都架空区見本町2-3-4', resident_name: '見本 花子',
      resident_tel: '090-0000-1203', due_date: ymd(3) },
    { text: '203号室の洗面所の床が濡れている。階下 103号室の天井にシミ。', symptoms: ['floor', 'downstairs'], damage: '103号室 洗面所の天井', suspect: '洗面台の給水管' });
    await phase(A, 'survey', { scheduled_at: at(-3, 10), worker_id: ids.U_STAFF, done_at: at(-3, 12) });
    const A2 = await phase(A, 'cause', { scheduled_at: at(-1, 10), scheduled_end: at(-1, 12), worker_id: ids.U_STAFF });
    const A3 = await phase(A, 'repair', { scheduled_at: at(3, 9), scheduled_end: at(3, 17), worker_id: ids.U_STAFF });
    const { report: rep } = await draftOf(A2);
    for (const [label, color, ph] of [['作業前', '#2563eb', 'wbefore'], ['作業中', '#ea580c', 'wduring'], ['作業後', '#0d9488', 'wafter']]) {
      await ReportsApi.addPhoto(rep, await photo(label + '（洗面台下）', color), { phase: ph });
    }
    const caps = ['洗面台下の給水管 継手からにじみ', '継手を交換しているところ', '交換後。通水して漏れなし'];
    await ReportsApi.save(rep.id, { room: '203', work_date: ymd(-1), time_start: '10:00', time_end: '11:30', worker_id: ids.U_STAFF,
      photos: rep.photos.map((x, i) => Object.assign({}, x, { caption: caps[i] })),
      data: Object.assign(ReportLogic.emptyData(), { f1: '洗面台下の給水管の継手（13mm）を交換。通水して漏れが無いことを確認した。', afterSel: '正常に復旧',
        workChecklist: ['設備の動作確認をした（通水・通電・排水など）', '交換・修繕箇所から漏れ・不具合がないか確認した'] }) });
    await sb.from('reports').update({ status: 'submitted', submitted_at: at(-1, 12), submitted_by: ids.U_STAFF, submitted_via: 'member' }).eq('id', rep.id);
    est(A, A2, 'accepted', 'E-0001', [L('給水管継手交換', 1, '式', 18000), L('出張費', 1, '式', 5000)], { issued_at: at(-2, 9), sent_at: at(-2, 10), accepted_at: at(-2, 15) });
    est(A, A3, 'sent', 'E-0002', [L('天井ボード張替え（103号室 洗面所）', 3, '㎡', 6000), L('クロス張替え', 8, '㎡', 1500), L('養生・清掃', 1, '式', 5000)],
      { issued_at: at(-1, 15), sent_at: at(-1, 16) });
    await NoticesApi.create(A.id, A, { phase_id: A3.id, phaseTitle: '復旧工事', data: { workDate: ymd(3), timeStart: '09:00', timeEnd: '17:00', roomNo: '103', workName: '天井の復旧工事' } });
    await CasesApi.addEntry(A.id, 'memo', '103号室の見本さんには管理会社から連絡済み。工事の日は在宅とのこと。', []);
    talk(A, A2, ids.U_STAFF, '原因元工事 終わりました', '継手の交換が終わりました。報告書を出しています。', 60 * 20);
    talk(A, A2, ids.U_ME, 'ありがとうございます', '確認しました。復旧工事は3日後でお願いします。', 60 * 19);

    // B. コーポさくら 105: 現地確認は明日（作業担当者に知らせた・まだ確認していない）
    const B = await newCase({ name: 'コーポさくら（架空）', room: '105', address: '東京都架空区例示町5-6-7', resident_name: '例示 太郎',
      resident_tel: '090-0000-1105', due_date: ymd(1) },
    { text: '浴室の天井から水が落ちてくる。', symptoms: ['ceiling'], items: [{ key: 'visual' }] });
    await phase(B, 'site_check', { scheduled_at: at(1, 10), scheduled_end: at(1, 11), worker_id: ids.U_STAFF, notified_at: now });

    // C. メゾン青空 302: 今日 14:00 の調査（報告書は下書き）・トーク
    const C = await newCase({ name: 'メゾン青空（架空）', room: '302', address: '東京都架空区試験町8-9-10', resident_name: '試験 次郎',
      resident_tel: '090-0000-1302', due_date: ymd(0) },
    { text: 'キッチンの床下から水の音がする。水道代が先月から高い。', symptoms: ['water_bill', 'floor'], items: [{ key: 'visual' }, { key: 'pressure' }] });
    const C1 = await phase(C, 'survey', { scheduled_at: at(0, 14), scheduled_end: at(0, 16), worker_id: ids.U_STAFF });
    talk(C, C1, ids.U_ME, '今日の調査', '入居者の試験さんは 13:30 から在宅です。駐車場はありません。', 90);
    talk(C, C1, ids.U_STAFF, '了解です', 'コインパーキングに停めて向かいます。', 75);

    // D. ハイツ若葉 101: 調査済み → 原因元工事の見積書を明日までに（作業担当者のタスク）
    const Dc = await newCase({ name: 'ハイツ若葉（架空）', room: '101', address: '東京都架空区見本町11-12', resident_name: '見本 三郎',
      resident_tel: '090-0000-1101', due_date: ymd(1) },
    { text: 'トイレの床に水たまり。', symptoms: ['floor'] });
    await phase(Dc, 'survey', { scheduled_at: at(-2, 13), worker_id: ids.U_STAFF, done_at: at(-2, 15) });
    await phase(Dc, 'cause', { worker_id: ids.U_STAFF, estimate_due: ymd(1) });

    // E. サンライズ荘 2F: その他（点検）を全員に募集（明日）
    const E = await newCase({ name: 'サンライズ荘（架空）', room: '2F共用部', address: '東京都架空区例示町13-14', due_date: ymd(2) },
    { text: '2階廊下の排水口の点検。' });
    const E1 = await phase(E, 'other', null, '点検');
    await PhasesApi.openCall(E1.id, 'tomorrow', null);

    // F. 完了した案件（1件）
    const G = await newCase({ name: 'パークサイド（架空）', room: '401', address: '東京都架空区試験町15-16', due_date: ymd(-10), status: 'done' });
    await phase(G, 'cause', { scheduled_at: at(-12, 10), worker_id: ids.U_STAFF, done_at: at(-12, 12) });
    ctx = null;
  }

  /* ---------- 起動 ---------- */
  const realGetUser = sb.auth.getUser.bind(sb.auth), realSignOut = sb.auth.signOut.bind(sb.auth);
  let seeding = false, readyP = null;
  // 画面のスクリプトを全部読んでから（最初の getUser = app.js の boot）入れる
  const ready = () => readyP || (readyP = (async () => {
    if (D.vendor) return;
    if (D.fresh) {
      seeding = true;
      try { await seed(); } catch (e) { console.error('お試しデータを入れられませんでした', e); }
      seeding = false;
      await save();
      if (D.role === 'staff' && !full) { location.reload(); return new Promise(() => {}); } // 作業担当者で開き直す
      if (!D.role) await realSignOut();
    }
  })().then(() => {
    setInterval(save, 1500);
    document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });
    addEventListener('pagehide', save);
  }));
  sb.auth.getUser = async (...a) => { if (!seeding) await ready(); return realGetUser(...a); };
  // アプリのログアウト = 役割を外す（外さないと開き直すと同じ役割でログインしたまま）
  sb.auth.signOut = async (...a) => { D.set(D.KEY_ROLE, null); return realSignOut(...a); };
  if (D.vendor) addEventListener('DOMContentLoaded', ready); // 担当者URLのページは getUser を呼ばない

  /* ---------- ③ 画面 ---------- */
  if (D.vendor) return;
  const go = role => {
    if (role) {
      if (!D.set(D.KEY_ROLE, role)) {
        const e = document.getElementById('demo-login-err');
        if (e) e.textContent = 'このブラウザでは保存ができないため、お試し版を開けません（プライベートブラウズを切ってください）';
        return;
      }
    } else D.set(D.KEY_ROLE, null);
    location.replace(location.pathname);
  };
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; };
  const btn = (cls, text, fn) => { const b = el('button', cls, text); b.type = 'button'; b.addEventListener('click', fn); return b; };
  function resetCard(cls) {
    const box = el('div', cls);
    box.id = cls === 'card' ? 'demo-reset' : 'demo-reset-f';
    box.appendChild(el('div', cls === 'card' ? 'card-ttl' : null, 'お試し版'));
    box.appendChild(el('p', 'demo-note', '入れたデータはこのブラウザの中だけに残ります。ほかの人には見えません。'));
    const b = btn('btn demo-reset-btn', 'お試しデータを最初に戻す', async () => {
      if (!(await askPopup('入れた案件・写真・メッセージはすべて消え、最初のお試しデータに戻ります。',
        { title: 'お試しデータを最初に戻しますか？', okLabel: '最初に戻す', danger: true, id: 'demo-reset-ask' }))) return;
      D.set(D.KEY_DB, null);
      lastSig = null; saving = true; // 開き直すまで保存しない
      location.replace(location.pathname);
    });
    box.appendChild(b);
    return box;
  }
  document.addEventListener('DOMContentLoaded', () => {
    const css = el('style');
    css.textContent = `
      .demo-band{background:#fef3c7;color:#78350f;font-size:13px;line-height:1.4;padding:6px 16px;padding-top:calc(6px + env(safe-area-inset-top,0px));
        display:flex;gap:8px;align-items:center;justify-content:space-between;flex-wrap:wrap;border-bottom:1px solid #fcd34d}
      .demo-band b{font-weight:700}
      .demo-band button{background:none;border:0;color:#1d4ed8;text-decoration:underline;font:inherit;padding:4px 0;cursor:pointer}
      #demo-full{color:#b91c1c}
      #login-form .fld,#login-btn,#login-form .login-foot{display:none}
      .demo-login{display:flex;flex-direction:column;gap:12px;margin-top:8px}
      .demo-login .btn{font-size:17px;padding:16px;min-height:56px;width:100%}
      .demo-login .btn.demo-staff{background:#0d9488}
      .demo-note{font-size:13px;color:var(--muted,#64748b);margin:6px 0 10px}
      #demo-reset-f{margin-top:12px}`;
    document.head.appendChild(css);
    const band = el('div', 'demo-band');
    band.id = 'demo-band';
    const left = el('span');
    left.append(el('b', null, 'お試し版'), document.createTextNode('　架空のデータ・この端末だけに保存'));
    const warn = el('span', null, '（保存の容量がいっぱいです）');
    warn.id = 'demo-full'; warn.hidden = !full;
    left.appendChild(warn);
    band.append(left, btn('', '役割を切り替える', () => go(null)));
    document.body.prepend(band);

    const form = document.getElementById('login-form');
    if (form) {
      const box = el('div', 'demo-login');
      box.append(el('p', 'demo-note', 'パスワードは要りません。どちらかを押してください。'),
        btn('btn demo-owner', '管理者で試す', () => go('owner')),
        btn('btn demo-staff', '作業担当者で試す', () => go('staff')));
      const err = el('div', 'err');
      err.id = 'demo-login-err';
      box.appendChild(err);
      form.querySelector('.brand').after(box);
    }
    const set = document.querySelector('#screen-settings .set-body');
    if (set) set.appendChild(resetCard('card'));
    // 作業担当者の設定（#f/settings）は js/field-ui.js が描き直すので、描かれるたびに足す
    const root = document.getElementById('field-root');
    if (root) new MutationObserver(() => {
      if (location.hash === '#f/settings' && !document.getElementById('demo-reset-f') && root.firstChild) root.appendChild(resetCard('fd-card fd-set'));
    }).observe(root, { childList: true });
  });
})();
