// js/supabase-config.js — Supabase の接続先（公開してよい値だけ: プロジェクトURL と anon キー）
// index.html は supabase-config.js → supabase.js（ログイン用の既定クライアント sb を作る）の順に読む。
// 協力業者ページ r.html はこのファイルだけを読み、既定の sb は作らない（js/vendor.js がセッションなしのクライアントを作る）。
// 簡易版: 本番の Supabase には接続しない（データベースは後で決める）。画面は tests/e2e の偽バックエンドで動かす
const SUPABASE_URL = 'https://example.invalid';
const SUPABASE_ANON_KEY = 'disabled';
