// tools/demo/demo.js — お試し版（dist-demo）だけで読む。tools/build-demo.sh が js/fake-sb.js の直後に入れる。
// ① 初めて開いたとき（偽DBが無い）: 架空の会社・担当者・依頼元を入れる。案件は入れない
// ② 偽DBを localStorage に保存（変わったら 1.5 秒ごと・画面を離れたとき）。データはこのブラウザの中だけ
// ③ ログイン画面に「管理者で試す」「作業担当者で試す」・上に「お試し版」の帯（役割を切り替える）・設定に「お試しデータを最初に戻す」
// 本物の Supabase には一切つながない（偽バックエンドはメモリの中だけで動く）。名前・住所・電話・メールはすべて架空
(() => {
  const D = window.__demo, F = window.__fake;
  if (!D || !F) return;
  // Task 70: 移動の目安は Google につながず偽バックエンドの横取り（架空の30分）で見せる。キーは形だけの架空の値
  if (!F.db.orgs[0].routes_api_key) F.db.orgs[0].routes_api_key = 'demo_not_a_real_key_0000';

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

    // 案件は入れない（空のところから試してもらう）
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
