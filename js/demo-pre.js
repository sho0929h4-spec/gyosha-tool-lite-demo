// tools/demo/demo-pre.js — お試し版（dist-demo）だけで読む。tools/build-demo.sh が js/fake-sb.js の直前に入れる。
// localStorage から「役割」と「保存した偽DB」を戻し、偽バックエンド（tests/e2e/fake-sb.js）の起動のしかたを決める。
//   偽DBが無い（初めて・最初に戻した）: 管理者として起動し、js/demo.js がお試しデータを入れる
//   役割なし: ログインしていない状態（ログイン画面に「管理者で試す」「作業担当者で試す」）
//   staff: 作業担当者（佐藤）・owner: 管理者（田中）
(() => {
  const KEY_DB = 'demo-db-v2', KEY_ROLE = 'demo-role';
  const get = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const set = (k, v) => {
    try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); return true; } catch (e) { return false; }
  };
  let snap = null;
  try { snap = JSON.parse(get(KEY_DB) || 'null'); } catch (e) { snap = null; }
  if (!snap || !snap.db) snap = null;
  let role = get(KEY_ROLE);
  if (role !== 'owner' && role !== 'staff') role = null;
  const vendor = /\/r\.html$/.test(location.pathname); // 担当者URLのページ（ログインなし）
  window.__demo = { KEY_DB, KEY_ROLE, get, set, role, fresh: !snap, vendor };
  if (snap) window.__fakeSnapshot = snap;
  if (vendor) { window.__fakeAnon = true; return; }
  if (!snap) return;
  if (role === 'staff') window.__fakeUser = 'staff';
  else if (!role) window.__fakeAnon = true;
})();
