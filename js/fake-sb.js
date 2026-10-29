// tests/e2e/fake-sb.js — E2E 用の偽 Supabase クライアント（メモリ上で動く）
// E2E では js/supabase.js の代わりにこのファイルが返される。本物の通信は一切しない。
// ログイン済み（オーナー「田中」）で起動し、メンバー2名・案件2件のデータを持つ。
// PostgREST の挙動のうち、アプリが実際に使う範囲だけを真似る:
//   from().select()/insert()/update()/delete() + eq/in/is/order/single/maybeSingle、select() の埋め込み orgs(*) と
//   case_actions の cases!inner(name,status)（+ .eq('cases.status', ..) による親行の絞り込み）
//   列権限（migration 007/008/009/013。reports / mail_drafts / notices を含む）、複合FK・check 制約の一部、case_summaries ビュー（保持データから計算）
//   rpc('add_usage')、storage.from('files'|'public-pdfs').upload(upsert)/createSignedUrl(files のみ。expiresIn は window.__fake.signed に記録)/getPublicUrl/remove/list。
//     public-pdfs は migration 012（pdf 20MBまで・自社フォルダのみ）。getPublicUrl は期限パラメータなしの公開URL。window.__fake.pubFiles
//   auth.getUser/signInWithPassword/signOut/onAuthStateChange/resetPasswordForEmail/updateUser/signUp
//   パスワード再設定（Task 41）: resetPasswordForEmail は送らずに window.__fake.resetMails に {email, redirectTo} を記録。
//     updateUser はログイン中だけ（無ければ本物と同じ AuthSessionMissingError）・window.__fake.pwUpdates に記録。
//     window.__fake.authErr = { reset: {...}, update: {...} } でその error を返す（例 { status: 429 } / { code: 'same_password' }）。
//     window.__fakeRecovery = true で読み込むと「再設定メールのリンクから開いた」状態（ログイン済み＋ PASSWORD_RECOVERY を通知）
//   協力業者URL（migration 009/010）: report_shares（token_hash だけ保存）、rpc share_open / share_submit / share_upload_ok、
//   window.supabase.createClient(...) で作る「セッションなし（anon）」のクライアント（r.html 用）:
//     表は全部 permission denied、rpc は share_* のみ、storage は share_upload_ok と同じ判定の新規 upload だけ
//   migration 014/015: estimates（列grant・状態遷移・合計の再検算・delete は draft のみ）、rpc('issue_estimate') の採番、rpc('new_estimate_version')（016）、case_summaries の estimate_count / latest_estimate_total
//   migration 018/019（お客様ページ。027 で廃止）: case_portals は読むだけ・rpc('portal_open') は permission denied（027）、
//     timeline_entries の type 'customer'（audiences 1つ以上・既知の種類のみ・添付なし。他の種別は audiences 空）。
//     window.__fakeAnon = true で読み込むとログインしていない状態で起動する（表は permission denied、rpc は share_* だけ）
//   migration 011: share_submit の写真は image/jpeg のみ、名前60字まで（入力中ロックは 044 で廃止）
//   migration 044: report_shares.token（平文）・発行時に同じ報告書の古い URL を無効・名前は任意・タイムラインは「担当者「○○」がURLから報告書を提出した」
//   migration 020/021/022（対応フェーズ）: case_phases（insert / update は列 grant・kind は作成後に変えられない・check の一部・
//     削除は見積書・報告書・工事掲示・送信済みメールがあれば P0001 で拒否し、未送信の下書きは一緒に消す・
//     schedule_set_at は 022 のトリガーと同じく予定を入れた/変えたときに今の時刻）。
//     estimates / reports / notices / mail_drafts の phase_id（同じ案件のフェーズだけ）、mail_drafts の purpose / remind_slot /
//     remind_for / skipped_at / recipients（check・リマインドの一意）。元請マスタの name / email を変えたら紐付く案件の
//     client_name / client_email も同じ値に（022）。
//     clients（元請マスタ）: insert も update も列 grant（name/contact_name/email/tel/billing_mode/memo）だけ・delete なし・
//     名前1〜100字・billing_mode は single/monthly・文字数の check・created_by = auth.uid()。
//     cases に client_id（複合FK → clients）・owner_* / resident_*（文字数の check・update の列 grant）。
//     シードの「大京管理」は 020 のデータ移行と同じく元請マスタに1件作って C1 に紐付けてある。
//     share_submit は次やること（case_actions）を足さない。new_estimate_version は phase_id を引き継ぐ。
//     case_summaries に client_master_name / client_billing_mode / phases / schedule_drafts_to_send / reminder_drafts_to_send
//   migration 024（入金期限）: case_phases.payment_due（update の列 grant・請求済みだけの check）、case_summaries の phases に payment_due
//   migration 025（号室・内容詳細）: cases.room（40字・update の列 grant）、case_phases.plan（既定 {}・update の列 grant）、
//     case_summaries の phases に plan（room は cases.* で出る）
//   migration 028（plan を「現場担当への指示」に）: plan の check を object / suspects・priority は文字列の配列 / note・visitNote は文字列 /
//     10000 バイトに
//   migration 026（作業担当者への確認依頼）: memberships.email（同じ会社だけ読める・画面から書けない）、case_phases の worker_id（insert で
//     空なら案件の担当者）/ notified_at・notified_by / ack_at・ack_by（update の列 grant は worker_id / notified_at / ack_at。by はトリガー相当で
//     自分を入れる。確認は担当者本人だけ・知らせた後だけ。知らせ直すと確認を消す。担当者を変えると両方消す）、mail_drafts.purpose に staff_notice
//     （フェーズ必須。remind_slot は d1 だけ）・recipients に worker・リマインドの一意に purpose、case_summaries の phases に担当者の項目。
//     window.__fakeUser = 'staff' で読み込むとメンバー（佐藤 U_STAFF）でログインした状態で起動する
//   migration 027（最終点検）: mail_drafts.worker_id（insert でフェーズの今の担当者を入れる・staff_notice だけ・update 不可）とリマインドの一意に
//     worker_id。case_actions / case_works / case_portals は読むだけ（書くと permission denied）、rpc portal_open は permission denied。
//     timeline_entries の audiences の pm → gc の読み替え（020 のトリガー）、case_phases の amount_override（bigint・0〜1兆）と ack の check（026）
//   migration 054（Task 31）: case_phases.plan.visitRooms（今回行く部屋）の check、関係する部屋の削除で visitRooms から外す（afterDelete）
//   migration 045（Task 25）: case_phases.plan / result の rooms（号室ごとの区画）の check、case_summaries の reports に submitted_by、
//     share_open の photo_rooms（指示で「被害箇所の写真撮影」を選んだ号室）
//   migration 023（調査結果）: case_phases.result（既定 {}・update の列 grant・object / cautions は配列 / 20000 バイトの check）、
//     mail_drafts.purpose に survey_result（フェーズ必須）、case_summaries の phases の各要素に result
//   migration 030（関係する部屋）: case_rooms（insert / update は列 grant・org_id / created_by は既定値・check の文字数・delete 可）、
//     mail_drafts.recipients に room:{uuid}、case_summaries の末尾に rooms（sort → 作成順）
//   migration 029（見積のよく使う明細）: estimate_presets（insert / update は列 grant の kind / label / line / sort だけ・org_id / created_by は既定値・
//     kind は common/survey/cause/repair・label 1〜40字・line の形の check（摘要必須・数量 0〜100万・金額は整数・unitPrice は数・postTax は false だけ・
//     決まったキーだけ・2000 バイト）・sort 0〜100万・delete 可・updated_at の touch）
//   migration 039（Task 22）: estimate_presets.line に step（null か 1〜100万の整数）。会社には初期の候補4件（共通・created_by null）:
//     養生対応 ¥3,000／排水作業 ¥5,000／調査人工 ¥10,000（人工）／交通費 ¥3,000（step 500。Task 49 で画面は step を使わない）
//   migration 068（Task 49）: estimate_presets.owner_user_id（insert だけ）。読むのは会社共通＋自分専用、書けるのは自分専用＝本人・会社共通＝管理者
//   migration 031（案件の削除＝ゴミ箱・1つ前に戻す）: cases.deleted_at / deleted_by（update の列 grant。restrictive policy:
//     削除済みの案件は管理者しか変えられない・deleted_at / deleted_by を入れられるのは管理者だけで deleted_by は自分・insert では入れられない）、
//     case_summaries は deleted_at が null の案件だけ、case_edits（読むだけ。cases / case_phases / case_rooms の update で変わった列だけを記録・
//     機械的な列は除外・1案件あたり直近200件）、rpc('undo_case_edit')（今の値が after と同じときだけ戻す・理由を返す・タイムラインに記録）。
//     クエリの not(col, 'is', null) と limit(n)
//   migration 032/033（写真の印）: share_submit は写真の marks を検査し（不正なら P0001「写真の印が不正です」）、決まったキーだけで残す。空なら marks を持たせない
//   migration 034（Task 16 報告書の流れ）: 報告書が draft → submitted になったら（社内の提出・share_submit とも）そのフェーズの done_at が空なら
//     提出日時を入れ、タイムラインに「調査 1回目を調査済みにした（報告書の提出）」／「原因元工事 1回目を完了にした（報告書の提出）」。
//     case_summaries の phases[].reports に submitted_at・share_active（使える協力業者URLがある）・submitted_via（035）
//   migration 036（Task 19）: estimates.margin_pct（0〜999）・source_pdf_path（自社・この案件の estimates/{uuid}/src-*.pdf）の列 grant と検査、
//     lines[] の cost（0以上の整数）・priceOverride（boolean）、提出後は2列も変更不可、new_estimate_version で引き継ぐ。orgs.default_margin_pct
//   functions.invoke('parse-estimate-pdf'): 本物の AI は呼ばず固定の読み取り結果（window.__fake.FAKE_AI）。window.__fake.ai = 'not_configured'（503）／'missing'（404）
//   migration 037（Task 20）: case_phases.estimate_due（insert / update の列 grant・日付）、case_summaries の phases に estimate_due、
//     _report_data_check（reports.data の workItems / causes / nextAction の形・調査で原因元工事は期日必須・再調査は理由と内容が必須）を
//     share_submit と（社内の）提出の update で検査、提出（draft → submitted・調査）で nextAction が cause なら完了していない原因元工事に
//     estimate_due（無ければ作る・元請マスタが月ごとなら monthly）＋タイムライン、resurvey はタイムラインに理由と内容（reports_next_action）
//   migration 038（Task 21）: _report_data_check に leakActionOther・keyBorrowed / keyReturned（boolean）・keyReturn・roomStatus
//     （luggage many|few・pet boolean・residents 0〜20 の整数）・再調査も期日必須。reports_next_action: 作業者（worker_id がメンバー）を
//     原因元工事の worker_id に（作るときは作業者が空なら空）、再調査は新しい調査フェーズ（estimate_due・worker_id）＋タイムライン2件。
//     share_submit の写真の区分は '' / wbefore / wduring / wafter / key / free（旧区分は読み替え・知らない値は「写真の区分が不正です」）・phaseNote（free だけ・30文字）
//   migration 040（Task 23）: reports_next_action は調査の提出で「その報告書の調査フェーズまで」の調査の estimate_due を消す（再調査の期限 A）、
//     既にある原因元工事の worker_id は空のときだけ入れる（上書きしない）。share_submit で名前がメンバーの表示名と1人だけ一致したら
//     報告書の worker_id にその人（reports_share_worker）
//   migration 046（Task 26）: case_phases の worker_id が変わったら、そのフェーズの未提出（draft）の報告書の worker_id を同じ人に・worker_name は空
//     （提出済みは変えない。外したら空。case_phases_sync_report_worker）
//   migration 041（Task 23）: staff_messages（現場からの連絡。insert は列 grant の case_id / phase_id / to_user / subject / body / attachments / reply_to、
//     from_user は自分・read_at は空・フェーズと返事のもとは同じ案件・添付は {org}/cases/{case}/messages/ の下。update は read_at だけで宛先の人だけ
//     （to_user = 自分、または空で自分が管理者。それ以外は 0 行）・delete 不可・タイムライン「現場からの連絡: 件名（送った人）」／返事）、
//     case_summaries.staff_unread（見ている人あての未読の数）
//   migration 047（Task 27）: staff_messages.source（staff / report_submit。画面からは入れられない＝insert の列に無い）。
//     reports_next_action の最後に、次の対応方針が原因元工事／再調査なら管理者あての自動の連絡（宛先なし・from = 提出した人（URL なら空）・
//     件名「調査報告を提出しました（見積書提案期日 M/D）」・本文 = 方針・期日（曜）・提出・再調査の理由と内容・■ 号室ごとの原因）。
//     自動の連絡はタイムラインに書かない
//   migration 051（Task 27）: case_summaries.staff_unread は自分が送った連絡を数えない
//   migration 042（Task 23）: 管理者だけ — undo_case_edit、case_phases の請求・入金の列と done_at の更新、estimates を sent / accepted にする更新、
//     reports を confirmed / sent にする更新（スタッフは 42501）、estimate_presets の update / delete・clients の update（スタッフは 0 行）
//   migration 052（Task 28）: cases.request（依頼内容。update の列 grant・_case_request_ok と同じ check・case_edits に記録しない）、
//     case_phases.late_at / late_by（画面から書けない。rpc phase_report_late（ログイン）・share_report_late（anon も）だけが入れる・2分以内の連続は拒否・
//     staff_messages に source 'late' の自動の連絡・タイムライン「○○が到着の遅れを報告した（約30分）」・返す値に入居者の電話）、case_summaries の
//     phases に late_at / late_by_name、share_open に phase / brief / request / late_ok / late_at / residents（late_at があるときだけ）・case.room、
//     anon の storage.createSignedUrl(s) は依頼内容に載っていて、createClient の global.headers['x-share-token'] がその案件の使える担当者URLのトークンの写真だけ（share_request_photo_ok・055）、
//     催促: case_phases.nudged_at / nudge_count（画面から書けない）・rpc phase_nudge（作業担当者あての staff_messages source 'nudge'・タイムライン「○○が鈴木に催促した」）
//   migration 053（Task 29）: case_phases.estimate_due_reason / estimate_due_by / report_overdue_at（画面から書けない）・case_summaries の phases に
//     それと late_by、reports に work_date / time_end、estimates に issued_at / created_by。staff_messages.source に overdue / daily・case_id は日報と
//     その返事だけ空（日報の写真は {org}/daily/{送った人}/）・日報はタイムラインに書かない。rpc phase_report_overdue（報告書の期限超過・1回だけ・
//     管理者あて・送った人なし）・staff_daily_send（1人1日1件・当日は差し替えて未読に戻す）。reports_next_action は期日が提出日＋2日より先なら
//     理由・提出できる日をフェーズに写し、連絡とタイムラインに「（理由: …・提出 M/D まで）」
//   migration 043（Task 23）: case_summaries から next_*・open_us_actions・my_open_actions・unsettled_works を外した。reports_to_confirm は協力業者URLの提出だけ
//   r.html では supabase-js 本体の代わりにこのファイルが返される（SUPABASE_URL / ANON_KEY は js/supabase-config.js が定義）
// 画面コードは触らず、テストから window.__fake で内部状態を覗く。
// 現在時刻の固定（対応フェーズ Task 6 のリマインド）: ページ読み込み前に window.__fakeNow（ISO かミリ秒）を入れるか、
//   window.__fake.setNow(v) を呼ぶと、画面・偽DBの Date（new Date() / Date.now()）がその時刻から進む（null で実時刻に戻す）。
//   setTimeout などのタイマーは実時間のまま。
// migration 062（Task 42）: rpc field_trash_case（自社・削除されていない・created_by = 呼んだ人・source 'case_create' の連絡がある案件だけ。
//   deleted_at / deleted_by・staff_messages source 'case_delete'（宛先なし）・タイムライン「○○が案件を削除した（現場用）」）。
//   パスワードの確かめ: window.__fake.password を入れると signInWithPassword はそのメール（ログイン中の人）とパスワードの組だけ通す
//   （違えば本物と同じ 400 invalid_credentials）。window.__fake.signIns にメールだけ残す（パスワードは残さない）。入れなければ今までどおり何でも通す
// migration 059: cases への直接の insert は permission denied。管理画面の作成は rpc admin_create_case（管理者だけ・CASE_COLS だけ・無料は3件まで）
// migration 058（Task 37）: case_phases.kind に other・label（その他だけ必須・1〜40字・前後の空白なし・作成時だけ）・source_phase_id（画面から書けない。
//   reports_next_action が原因元工事／再調査を作る・期日を入れ直すときに元の調査）。case_summaries の phases に label・source_phase_id。
//   rpc field_create_case（現場用の案件登録。案件＋フェーズ1つ＋依頼内容・作業担当者 = 呼んだ人・無料は保存件数3件まで・
//   staff_messages source 'case_create'（宛先なし）・タイムライン）。フェーズの名前は「その他（点検）」
// migration 065（Task 46）: staff_messages の select は talk_visible（スタッフは担当の案件・自分の・自分あて・管理者の全体だけ）・as_client（元請から。管理者だけ）・
//   案件なしの手動の連絡（全体）・タイムラインの「管理者からのメッセージ」「元請からのメッセージ」・talk_reads（自分の分だけ読める）・rpc talk_mark_read
// migration 074（Task 61）: 不明なら次の対応方針は再調査かその他（その他は内容必須）・data.keyStatus（returned/none）・data.tenantNote（1000字）（reportDataCheck）
// migration 064（Task 45）: 原因の key に 'unknown'（不明）。調査の提出で不明なら次の対応方針は再調査だけ（reportDataCheck）・連絡の原因の文に「不明」
// migration 063（Task 43）: phase_task_flags（読むだけ）・rpc field_task_dismiss（フェーズの作業担当者が本人・現場用で本人が登録した案件だけ。
//   staff_messages source 'task_delete'）・field_task_sendback（それ以外の案件。内容 1〜1000字必須・source 'sendback'）・task_flag_close（管理者だけ）。
//   管理者が差し戻しのやり取りに返事（staff_messages の insert で reply_to）→ 差し戻しを済みに。phase_report_overdue は報告書作成の削除中は 'dismissed'
// migration 085（Task 68）: rpc doc_share_sent（管理者か、現場用で本人が登録した案件の本人。送付メールの下書き → 送信済み・報告書 → 送付済み・見積書 → 送付済み・
//   紐付けた依頼を反映済み・タイムライン「302号室 調査報告書を共有した（LINE）」）・doc_share_undo（管理者だけ。下書きに戻す・ほかに送信済みが無ければ書類を戻す）
// migration 066（Task 47）: case_phases.lost_at / bill_requested_at（画面から書けない）・rpc phase_set_stage（管理者か、現場用で本人が登録した案件の本人。
//   lost / active / wait / done / bill_requested / billed / paid。後ろの段の記録は消す・staff_messages source 'stage'（既読）・タイムライン）・
//   phase_nudge は失注を拒否・phase_report_overdue は 'lost'。case_summaries の phases に lost_at / bill_requested_at、estimates に notes / line_texts
// migration 067（Task 48）: case_phases.completed_at（画面から書けない）・phase_set_stage の complete・rpc phase_set_payment_due・case_summaries の phases に completed_at
// migration 069（Task 50）: phase_schedules（読むだけ）・rpc phase_sched_offer / conditions / pick / propose / confirm（069 の _sched_act と同じ権限・状態・
//   staff_messages source 'schedule'（未読・meta にカードの中身）・タイムライン）・日時の欄で直接入れた／消したら確定／未定・case_summaries の phases に schedule
// migration 071: case_phases の直接 insert は管理者だけ・worker_id の直接更新は管理者か現場用で本人が登録した案件の本人だけ（それ以外は 42501）
// migration 072（Task 53）: phase_schedules.dur / blocked_at・rpc phase_sched_offer / propose の p_dur・時間帯の中の始まり（PhaseLogic.slotStarts = DB の _sched_starts）・
//   作業担当者のダブルブッキング（case_phases の作業担当者・日時が入る／変わるとき = 直接の更新・確定・行けます・現場用の登録。23P01）・候補が埋まった知らせ（source schedule・meta.action blocked）
// migration 070（Task 51）: case_phases.open_call_at / open_call_by（画面から書けない。担当者が入ったら空＝トリガー）・open_call_apps（読むだけ）・
//   staff_messages.source 'open_call'（案件なしの募集のカードは会社の全員が読める）・rpc phase_open_call / phase_open_call_cancel / phase_open_call_accept
//   （070 の _open_call_act と同じ権限・状態・お知らせ・タイムライン）・phase_report_overdue は募集中なら 'open_call'・case_summaries の phases に open_call_at / open_call_by。
//   window.__fakeUser = { id, email } で読み込むと、その人（テストが memberships に足した人）でログインした状態で起動する
// migration 057（Task 35）: reports / estimates の reedit_count・reedit_at・reedit_by・reedit_by_name・reedit_mark（画面から書けない・insert は既定値）・
//   estimates.prev_status（new_estimate_version が旧版にするとき入れる）。提出済みの報告書を下書きに戻す直接の更新は不可・見積も不可（今まで通り）。
//   確認／送付（報告書）・送付／承諾（見積）で印を消す。再編集で戻した下書き（報告書 reedit_count > 0・見積 番号あり）は削除できない。
//   rpc report_reedit / estimate_reedit（作業担当者・提出した人・作った人・管理者）・cancel_estimate_version（管理者だけ）・
//   share_state / share_reedit（担当者URL。anon も）。再編集・再提出は staff_messages（source reedit・宛先なし）とタイムライン。
//   share_open の report.photos・reedit_count、share_submit は報告書に入っている写真をそのまま出し直せる（使用量は数え直さない）。
//   再調査の再提出は2つ目の調査を作らない。case_summaries の phases[].estimates / reports に reedit_mark / reedit_at / reedit_by_name / reedit_count
// migration 086（Task 70）: memberships.survey_end_mins（既定 120・本人だけ・30〜360 の30分きざみ）・orgs.routes_api_key（管理者だけ・形の check）・
//   routes.googleapis.com への fetch の横取り（window.__fake.routes / routesFail / routeCalls）
// migration 078（Task 56）: purge_files（管理者だけ読む・書けない）・rpc purge_files_done（管理者だけ・まだの行だけ「消した」にして使用量を減らす）。
//   window.__fakeFailRemove = パス で storage.remove を失敗させる
(() => {
  if (window.__fakeClock) return;
  const RealDate = Date;
  let offset = 0;
  class FakeDate extends RealDate {
    constructor(...a) { if (a.length === 0) super(RealDate.now() + offset); else super(...a); }
    static now() { return RealDate.now() + offset; }
  }
  window.Date = FakeDate;
  window.__fakeClock = {
    set(v) { offset = v == null ? 0 : (typeof v === 'number' ? v : RealDate.parse(v)) - RealDate.now(); },
    get offset() { return offset; }
  };
  if (window.__fakeNow != null) window.__fakeClock.set(window.__fakeNow);
})();
const sb = (() => {
  const uuid = () => crypto.randomUUID();
  const pad = n => String(n).padStart(2, '0');
  const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const plusDays = n => { const d = new Date(); d.setDate(d.getDate() + n); return ymd(d); };

  // 単調増加の時計（同じミリ秒に作られた行でも created_at の順序が崩れない）
  let lastMs = 0;
  const nowIso = () => { lastMs = Math.max(Date.now(), lastMs + 1); return new Date(lastMs).toISOString(); };

  const ORG_ID = '11111111-1111-4111-8111-111111111111';
  const U_ME = '22222222-2222-4222-8222-222222222222';    // ログイン中のオーナー
  const U_STAFF = '33333333-3333-4333-8333-333333333333'; // メンバー
  let user = window.__fakeUser && typeof window.__fakeUser === 'object' // 070 のテスト: 3人目のメンバー
    ? { id: window.__fakeUser.id, email: window.__fakeUser.email, aud: 'authenticated', role: 'authenticated' }
    : window.__fakeUser === 'staff'
    ? { id: U_STAFF, email: 'staff@e2e.invalid', aud: 'authenticated', role: 'authenticated' }
    : { id: U_ME, email: 'owner@e2e.invalid', aud: 'authenticated', role: 'authenticated' };
  // window.__fakeAnon = true で読み込むと「ログインしていない端末」（お客様が p.html を開いた状態）で起動する
  let signedIn = !window.__fakeAnon || !!window.__fakeRecovery;

  const db = {
    orgs: [{ id: ORG_ID, name: 'テスト工業A', plan: 'free', logo_path: null, address: '東京都新宿区1-1',
      tel: '03-0000-0000', email: null, registration_number: null, default_margin_pct: null, routes_api_key: null, created_at: nowIso() }],
    memberships: [
      { user_id: U_ME, org_id: ORG_ID, display_name: '田中', role: 'owner', created_at: nowIso(), email: 'owner@e2e.invalid', phone: null, survey_end_mins: 120 },
      { user_id: U_STAFF, org_id: ORG_ID, display_name: '佐藤', role: 'member', created_at: nowIso(), email: 'staff@e2e.invalid', phone: null, survey_end_mins: 120 }
    ],
    org_usage: [{ org_id: ORG_ID, storage_bytes: 0, record_count: 0, updated_at: nowIso() }],
    invites: [],
    cases: [], case_actions: [], case_works: [], timeline_entries: [],
    reports: [], mail_drafts: [], report_shares: [], notices: [], estimates: [], estimate_counters: [],
    case_portals: [], clients: [], case_phases: [],
    estimate_presets: [], // migration 029
    case_rooms: [], // migration 030
    case_edits: [], // migration 031
    staff_messages: [], // migration 041
    talk_reads: [], // migration 065: トークを最後に読んだ時刻（読むだけ。書くのは rpc talk_mark_read）
    phase_task_flags: [], // migration 063: 読むだけ（書くのは rpc field_task_dismiss / field_task_sendback / task_flag_close と返事）
    calendar_feeds: [], // migration 077: Google カレンダーの購読トークン（本物は画面から読めない。rpc cal_feed_token / cal_feed_events だけが使う）
    phase_schedules: [], // migration 069: 日程調整（読むだけ。書くのは rpc phase_sched_* と case_phases の日時のトリガー）
    open_call_apps: [], // migration 070: 一斉配信の「行けます」の記録（読むだけ。書くのは rpc phase_open_call_accept）
    purge_files: [] // migration 078: 完全に消した案件のファイルの一覧（管理者だけ読める。書くのは DB の毎日の削除と rpc purge_files_done）
  };

  // ---- シード ----
  const C1 = uuid(), C2 = uuid(), K1 = uuid();
  const PARTY_NULL = { client_id: null, owner_name: null, owner_email: null, owner_tel: null,
    resident_name: null, resident_email: null, resident_tel: null, room: null, // room: migration 025
    deleted_at: null, deleted_by: null, // migration 031: ゴミ箱
    request: {} }; // migration 052: 依頼内容
  // 020 のデータ移行と同じ: client_name「大京管理」から元請マスタを1件作って紐付ける（メールは無し・単発）
  db.clients.push({ id: K1, org_id: ORG_ID, name: '大京管理', contact_name: null, email: null, tel: null,
    billing_mode: 'single', memo: null, created_by: null, created_at: nowIso(), updated_at: nowIso() });
  db.cases.push(
    { id: C1, org_id: ORG_ID, name: 'サンプルハイツ 101', address: '東京都渋谷区1-2-3', client_name: '大京管理',
      client_email: null, assignee_id: U_ME, due_date: plusDays(2), status: 'open', created_by: U_ME,
      created_at: nowIso(), updated_at: nowIso(), ...PARTY_NULL, client_id: K1 },
    { id: C2, org_id: ORG_ID, name: '旧案件 完了済みマンション', address: null, client_name: null,
      client_email: null, assignee_id: null, due_date: plusDays(-20), status: 'done', created_by: U_ME,
      created_at: nowIso(), updated_at: nowIso(), ...PARTY_NULL }
  );
  db.case_actions.push({ id: uuid(), org_id: ORG_ID, case_id: C1, kind: 'estimate', ball: 'us',
    title: '見積を作成する', due_date: plusDays(1), started_on: null, assignee_id: U_STAFF, done_at: null,
    created_by: U_ME, created_at: nowIso() });
  db.org_usage[0].record_count = db.cases.length;
  // migration 039: 初期の候補（seed_estimate_presets と同じ）
  [['養生対応', '式', 3000], ['排水作業', '式', 5000], ['調査人工', '人工', 10000], ['交通費', '式', 3000, 500]].forEach(([label, unit, amount, step], i) => {
    const line = { description: label, quantity: 1, unit, amount, postTax: false };
    if (step) line.step = step;
    db.estimate_presets.push({ id: uuid(), org_id: ORG_ID, kind: 'common', label, line, sort: i, owner_user_id: null, created_by: null, created_at: nowIso(), updated_at: nowIso() });
  });

  const files = new Map(); // path -> Blob（files バケット）
  const pubFiles = new Map(); // path -> Blob（public-pdfs バケット。migration 012）

  // ---- エラー ----
  const pgErr = (message, code, details) => ({ message, code: code || null, details: details || null, hint: null });
  const P0001 = m => pgErr(m, 'P0001');
  const E = {
    denied: t => pgErr(`permission denied for table ${t}`, '42501'),
    rls: t => pgErr(`new row violates row-level security policy for table "${t}"`, '42501'),
    fk: (t, c) => pgErr(`insert or update on table "${t}" violates foreign key constraint "${c}"`, '23503'),
    check: (t, c) => pgErr(`new row for relation "${t}" violates check constraint "${c}"`, '23514'),
    notnull: (t, col) => pgErr(`null value in column "${col}" of relation "${t}" violates not-null constraint`, '23502'),
    single: n => pgErr('JSON object requested, multiple (or no) rows returned', 'PGRST116',
      `The result contains ${n} rows`)
  };

  const memberOf = id => db.memberships.find(m => m.user_id === id && m.org_id === ORG_ID);
  const caseOf = id => db.cases.find(c => c.id === id);
  const blank = s => s == null || String(s).trim().length === 0;

  // ---- 列権限（migration 007 / 008。ここに無い列を PATCH すると403） ----
  const UPDATE_COLS = {
    orgs: ['name', 'address', 'tel', 'email', 'logo_path', 'registration_number', 'default_margin_pct', 'routes_api_key'], // migration 015: 会社情報の列だけ（RLS は owner のみ）・036: 利益率の既定値・086: Routes API のキー
    cases: ['name', 'address', 'client_name', 'assignee_id', 'due_date', 'status', 'client_email',
      // migration 020
      'client_id', 'owner_name', 'owner_email', 'owner_tel', 'resident_name', 'resident_email', 'resident_tel',
      'room', // migration 025: 号室
      'deleted_at', 'deleted_by', // migration 031: ゴミ箱（変えられるのは管理者だけ。restrictive policy は update の中で判定）
      'request'], // migration 052: 依頼内容 // migration 031: ゴミ箱（変えられるのは管理者だけ。restrictive policy は update の中で判定）
    case_edits: [], // migration 031: 読むだけ
    // migration 020: 元請マスタ（update も列単位）
    clients: ['name', 'contact_name', 'email', 'tel', 'billing_mode', 'memo'],
    case_actions: [], case_works: [], // migration 027: update の権限なし
    timeline_entries: ['resolved_at'],
    // migration 009: reports / mail_drafts の列権限
    reports: ['status', 'work_type', 'room', 'work_date', 'time_start', 'time_end', 'worker_id', 'worker_name',
      'data', 'photos', 'submitted_at', 'submitted_by', 'submitted_via', 'confirmed_at', 'confirmed_by', 'sent_at', 'phase_id'],
    mail_drafts: ['to_email', 'cc', 'subject', 'body', 'status', 'pdf_path', 'sent_at', 'sent_by', 'recipients', 'skipped_at'],
    report_shares: ['revoked_at'],
    // migration 013: 工事掲示は一覧用の列と data だけ更新できる（org_id / case_id / created_* は変更不可）
    notices: ['room', 'work_name', 'work_date', 'work_date_end', 'work_date_tbd', 'data', 'phase_id'],
    // migration 014: number・series_id・version・所属は更新不可（number は issue_estimate だけが付ける）
    estimates: ['status', 'data', 'lines', 'subtotal', 'tax', 'total', 'linked_request_ids', 'issued_at', 'sent_at', 'accepted_at', 'phase_id',
      'margin_pct', 'source_pdf_path'], // migration 036: 利益率・読み込んだ業者PDF
    // migration 020: 対応フェーズ（kind・case_id・schedule_set_at は更新不可）
    case_phases: ['scheduled_at', 'scheduled_end', 'done_at', 'bill_to_type', 'bill_to_name', 'billing_mode',
      'billing_month', 'billed_at', 'paid_at', 'amount_override', 'note',
      'result', // migration 023: 調査結果（update だけ。insert は既定値 {}）
      'payment_due', // migration 024: 入金期限（update だけ）
      'plan', // migration 025・028: 現場担当への指示（update だけ。insert は既定値 {}）
      'worker_id', 'notified_at', 'ack_at', // migration 026: 作業担当者・知らせた・確認した（by はトリガー相当）
      'estimate_due'], // migration 037: 見積書提案期日
    case_portals: [], // migration 027: update の権限なし（018 の宛名と取り消しも外した）
    estimate_presets: ['kind', 'label', 'line', 'sort'], // migration 029: 列 grant
    case_rooms: ['role', 'room', 'resident_name', 'email', 'tel', 'note', 'sort'], // migration 030: 列 grant（case_id は変えられない）
    staff_messages: ['read_at'], // migration 041: 既読だけ
    memberships: ['display_name', 'phone', 'survey_end_mins'] // migration 056: 本人の担当者名・電話番号・086: 調査の終了予定の既定
  };

  // ---- テーブル定義: 挿入時の既定値と検証 ----
  const T = {
    orgs: {
      insert: false, del: false,
      // migration 014: registration_number は null か 'T' + 13桁
      validateUpdate(row) {
        if (row.registration_number != null && !/^T[0-9]{13}$/.test(row.registration_number)) throw E.check('orgs', 'orgs_registration_number_check');
        // migration 036: 利益率の既定値は null か 0〜999（numeric(5,2)）
        if (row.default_margin_pct != null && !(typeof row.default_margin_pct === 'number' && row.default_margin_pct >= 0 && row.default_margin_pct <= 999)) throw E.check('orgs', 'orgs_default_margin_pct_check');
        // migration 086: Routes API のキーは null か 英数字と - _ の 20〜100字
        if (row.routes_api_key != null && !/^[A-Za-z0-9_-]{20,100}$/.test(row.routes_api_key)) throw E.check('orgs', 'orgs_routes_api_key_check');
      }
    },
    // migration 056: 本人だけ display_name・phone を直せる（列 grant・policy mem_update_self・前後の空白を落とすトリガー）
    memberships: {
      insert: false, del: false,
      update: true,
      canUpdate: r => r.user_id === user.id && r.org_id === ORG_ID,
      validateUpdate(next, old) {
        if (next.display_name !== old.display_name) {
          next.display_name = String(next.display_name == null ? '' : next.display_name).trim();
          if (!next.display_name) throw pgErr('担当者名を入れてください', '23514');
          if (Array.from(next.display_name).length > 40) throw pgErr('担当者名は40文字までです', '23514');
        }
        if (next.phone !== old.phone) next.phone = String(next.phone == null ? '' : next.phone).trim() || null;
        if (next.phone != null && !(next.phone.length <= 30 && /^[0-9+()\- ]+$/.test(next.phone))) throw E.check('memberships', 'memberships_phone_check');
        // migration 086: 調査の終了予定の既定は 30〜360 の30分きざみ（not null）
        if (next.survey_end_mins !== old.survey_end_mins && !(Number.isInteger(next.survey_end_mins) && next.survey_end_mins >= 30 && next.survey_end_mins <= 360 && next.survey_end_mins % 30 === 0))
          throw E.check('memberships', 'memberships_survey_end_mins_check');
      }
    },
    org_usage: { insert: false, update: false, del: false },
    invites: {
      insert(r) { return { id: uuid(), used: false, created_at: nowIso(), ...r, org_id: r.org_id || ORG_ID }; },
      del: true
    },
    cases: {
      insert() { throw E.denied('cases'); }, // migration 059: 直接の insert は無い（rpc admin_create_case / field_create_case だけ）
      validateUpdate(row) { caseChecks(row); },
      touch: true,
      del: false // 案件の削除はDB側で禁止
    },
    case_edits: { insert() { throw E.denied('case_edits'); }, del: false }, // migration 031: 書くのはトリガーと undo_case_edit だけ
    // migration 027: 旧い次やること（case_actions）・対応履歴と精算（case_works）は読むだけ（insert / update / delete の権限なし）。
    //   テストは window.__fake.db に直接入れて「画面に出ないこと」を確かめる
    case_actions: { insert() { throw E.denied('case_actions'); }, del: false },
    case_works: { insert() { throw E.denied('case_works'); }, del: false },
    timeline_entries: {
      insert(r) {
        const row = { id: uuid(), org_id: ORG_ID, body: '', attachments: [], audiences: [], resolved_at: null,
          created_by: user.id, created_at: nowIso(), ...r };
        if (!caseOf(row.case_id)) throw E.fk('timeline_entries', 'timeline_entries_case_id_org_id_fkey');
        if (!['memo', 'request', 'decision', 'system', 'customer'].includes(row.type)) throw E.check('timeline_entries', 'timeline_entries_type_check');
        if (!Array.isArray(row.attachments)) throw E.check('timeline_entries', 'timeline_entries_attachments_check');
        // migration 018: customer は見せる相手1つ以上・既知の種類のみ・添付なし。それ以外は audiences 空
        if (!Array.isArray(row.audiences)) throw pgErr('malformed array literal', '22P02');
        // migration 020 のトリガー timeline_audiences_norm: pm は gc に読み替え、重複は最初の出現順で1つに（check より先）
        if (row.audiences.includes('pm')) row.audiences = Array.from(new Set(row.audiences.map(a => (a === 'pm' ? 'gc' : a))));
        if (row.type === 'customer' && (row.audiences.length === 0 || row.audiences.some(a => !['gc', 'owner', 'resident'].includes(a)))) throw E.check('timeline_entries', 'timeline_entries_audiences_check');
        if (row.type !== 'customer' && row.audiences.length > 0) throw E.check('timeline_entries', 'timeline_entries_audiences_only_customer_check');
        if (row.type === 'customer' && row.attachments.length > 0) throw E.check('timeline_entries', 'timeline_entries_customer_no_attachments_check');
        if (blank(row.body) && row.attachments.length === 0) throw E.check('timeline_entries', 'timeline_entries_check');
        if (row.created_by !== user.id) throw E.rls('timeline_entries'); // tl_insert: created_by = auth.uid()
        return row;
      },
      // tl_delete: 自分の投稿 or オーナー
      canDelete(row) { return row.created_by === user.id || myRole() === 'owner'; },
      del: true
    },
    // migration 009: 報告書（status・work_type・data/photos の check、複合FK、delete は下書きのみ）
    reports: {
      insert(r) {
        const row = { id: uuid(), org_id: ORG_ID, status: 'draft', work_type: 'investigate', room: null,
          work_date: null, time_start: null, time_end: null, worker_id: null, worker_name: null,
          data: {}, photos: [], created_by: user.id, created_at: nowIso(), updated_at: nowIso(),
          submitted_at: null, submitted_by: null, submitted_via: null, confirmed_at: null, confirmed_by: null,
          sent_at: null, phase_id: null, ...r,
          reedit_count: 0, reedit_at: null, reedit_by: null, reedit_by_name: null, reedit_mark: false }; // 057: 画面から入れても既定値
        reportChecks(row);
        if (!caseOf(row.case_id)) throw E.fk('reports', 'reports_case_id_org_id_fkey');
        phaseFk('reports', row);
        return row;
      },
      validateUpdate(row, old) {
        // migration 044: 入力中ロック（011 reports_share_lock）は廃止。URL が使えても社内は更新できる（あとから保存した内容が残る）
        reportChecks(row);
        // migration 057 reports_status_guard: 提出済み以降 → 下書きは再編集の関数だけ。確認・送付で印を消す
        if (old && old.status !== 'draft' && row.status === 'draft') throw pgErr('提出済みの報告書は「再編集」からだけ下書きに戻せます', '42501');
        if (old && row.status !== old.status && ['confirmed', 'sent'].includes(row.status)) row.reedit_mark = false;
        // migration 037 reports_next_action: 調査の提出は data を検査（だめなら提出させない）
        if (old && old.status === 'draft' && row.status === 'submitted' && row.work_type === 'investigate') {
          const err = reportDataCheck(row.data, row.work_type);
          if (err) throw P0001(err);
        }
        if (row.worker_id && !memberOf(row.worker_id)) throw E.fk('reports', 'reports_worker_id_org_id_fkey');
        phaseFk('reports', row);
      },
      touch: true,
      afterUpdate(row, old) {
        if (old.status === 'draft' && row.status === 'submitted') { reportNextAction(row); reportPhaseDone(row); reportReeditAfter(row); reportSiteCheckSent(row); } // migration 037・034・057・083（トリガーの名前順）
      },
      canDelete(row) { return row.status === 'draft' && !row.reedit_count; }, // reports_delete: status = 'draft'（057: 再編集で戻した下書きは不可）
      del: true
    },
    // migration 009: 送付メールの下書き（subject/body は not null、delete は status='draft' のみ）
    mail_drafts: {
      insert(r) {
        const row = { id: uuid(), org_id: ORG_ID, report_id: null, to_email: null, cc: null, subject: '',
          body: '', status: 'draft', pdf_path: null, created_by: user.id, created_at: nowIso(),
          updated_at: nowIso(), sent_at: null, sent_by: null, phase_id: null, purpose: null, remind_slot: null,
          remind_for: null, skipped_at: null, recipients: [], ...r };
        if (!caseOf(row.case_id)) throw E.fk('mail_drafts', 'mail_drafts_case_id_org_id_fkey');
        phaseFk('mail_drafts', row);
        // migration 027 のトリガー mail_drafts_worker: staff_notice はフェーズの今の作業担当者（送った値は使わない）・それ以外は null
        const wp = row.purpose === 'staff_notice' && row.phase_id ? db.case_phases.find(x => x.id === row.phase_id) : null;
        row.worker_id = wp ? wp.worker_id || null : null;
        mailPhaseChecks(row);
        if (row.report_id && !db.reports.some(x => x.id === row.report_id)) throw E.fk('mail_drafts', 'mail_drafts_report_id_org_id_fkey');
        if (row.estimate_id && !db.estimates.some(x => x.id === row.estimate_id)) throw E.fk('mail_drafts', 'mail_drafts_estimate_fk');
        if (row.subject == null) throw E.notnull('mail_drafts', 'subject');
        if (row.body == null) throw E.notnull('mail_drafts', 'body');
        if (!['draft', 'sent'].includes(row.status)) throw E.check('mail_drafts', 'mail_drafts_status_check');
        return row;
      },
      validateUpdate(row) {
        if (row.subject == null) throw E.notnull('mail_drafts', 'subject');
        if (row.body == null) throw E.notnull('mail_drafts', 'body');
        if (!['draft', 'sent'].includes(row.status)) throw E.check('mail_drafts', 'mail_drafts_status_check');
        mailPhaseChecks(row);
      },
      touch: true,
      canDelete(row) { return row.status === 'draft'; },
      del: true
    }
  };
  // migration 013: 工事掲示（案件の子。複合FK、data は object、RLS = 自社のみ。delete は自社なら可）
  const NOTICE_COLS_ALL = ['id', 'org_id', 'case_id', 'room', 'work_name', 'work_date', 'work_date_end', 'work_date_tbd',
    'data', 'created_by', 'created_at', 'updated_at', 'phase_id'];
  const isDateStr = v => v === null || (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(v)));
  function noticeChecks(row) {
    if (!row.data || typeof row.data !== 'object' || Array.isArray(row.data)) throw E.check('notices', 'notices_data_check');
    if (!isDateStr(row.work_date)) throw pgErr('invalid input syntax for type date: "' + row.work_date + '"', '22007');
    if (!isDateStr(row.work_date_end)) throw pgErr('invalid input syntax for type date: "' + row.work_date_end + '"', '22007');
    if (typeof row.work_date_tbd !== 'boolean') throw E.notnull('notices', 'work_date_tbd');
    // migration 015: room / work_name は80字まで、work_date_end >= work_date
    if (row.room != null && Array.from(String(row.room)).length > 80) throw E.check('notices', 'notices_room_len');
    if (row.work_name != null && Array.from(String(row.work_name)).length > 80) throw E.check('notices', 'notices_work_name_len');
    if (row.work_date && row.work_date_end && row.work_date_end < row.work_date) throw E.check('notices', 'notices_work_date_order');
  }
  T.notices = {
    insert(r) {
      const bad = Object.keys(r).filter(k => !NOTICE_COLS_ALL.includes(k));
      if (bad.length) throw pgErr(`Could not find the '${bad[0]}' column of 'notices' in the schema cache`, 'PGRST204');
      if (r.org_id && r.org_id !== ORG_ID) throw E.rls('notices'); // notices_insert: org_id = my_org_id()
      const row = { id: uuid(), org_id: ORG_ID, room: null, work_name: null, work_date: null, work_date_end: null,
        work_date_tbd: false, data: {}, created_by: user.id, created_at: nowIso(), updated_at: nowIso(), phase_id: null, ...r };
      if (!caseOf(row.case_id)) throw E.fk('notices', 'notices_case_id_org_id_fkey');
      noticeChecks(row);
      phaseFk('notices', row);
      return row;
    },
    validateUpdate(row) { noticeChecks(row); phaseFk('notices', row); },
    touch: true,
    del: true
  };
  // migration 014/015: 見積書（estimate_totals / estimates_guard / estimates_links_guard / RLS delete は draft のみ）
  const P = m => P0001(m);
  function estimateTotals(lines) {
    if (!Array.isArray(lines)) throw P('明細の形式が正しくありません');
    if (lines.length > 1000) throw P('明細が多すぎます（1000行まで）');
    let s = 0, pt = 0;
    for (const l of lines) {
      if (!l || typeof l !== 'object' || Array.isArray(l)) throw P('明細の形式が正しくありません');
      const a = l.amount;
      let amt = 0;
      if (a === undefined || a === null) amt = 0;
      else if (typeof a === 'number') {
        if (!Number.isInteger(a)) throw P('金額は整数の円で入力してください');
        if (Math.abs(a) > 100000000000) throw P('金額が大きすぎます');
        amt = a;
      } else throw P('金額は数値で保存してください');
      // migration 036: 原価 cost（0以上の整数）・個別の印 priceOverride（boolean）
      const c = l.cost;
      if (c !== undefined && c !== null) {
        if (typeof c !== 'number') throw P('原価は数値で保存してください');
        if (!Number.isInteger(c) || c < 0) throw P('原価は0以上の整数の円で入力してください');
        if (c > 100000000000) throw P('原価が大きすぎます');
      }
      if (l.priceOverride !== undefined && l.priceOverride !== null && typeof l.priceOverride !== 'boolean') throw P('priceOverride は true/false で保存してください');
      const p = l.postTax;
      if (p === undefined || p === null || p === false) s += amt;
      else if (p === true) pt += amt;
      else throw P('postTax は true/false で保存してください');
    }
    if (s < 0) throw P('小計がマイナスです（値引きは税対象外の行で入力してください）');
    const tax = Math.floor((s + 5) / 10); // (subtotal + 5) / 10 の整数除算
    return { subtotal: s, tax, total: s + tax + pt };
  }
  const EST_STATUS = ['draft', 'issued', 'sent', 'accepted', 'superseded'];
  function estimateChecks(row, old) {
    if (!EST_STATUS.includes(row.status)) throw E.check('estimates', 'estimates_status_check');
    if (!row.data || typeof row.data !== 'object' || Array.isArray(row.data)) throw E.check('estimates', 'estimates_data_check');
    if (!Array.isArray(row.lines)) throw E.check('estimates', 'estimates_lines_check');
    if (['issued', 'sent', 'accepted'].includes(row.status) && !row.number) throw E.check('estimates', 'estimates_check');
    const t = estimateTotals(row.lines);
    if (row.subtotal !== t.subtotal || row.tax !== t.tax || row.total !== t.total) {
      throw P(`見積の合計が明細と一致しません（小計 ${t.subtotal}・消費税 ${t.tax}・合計 ${t.total}）`);
    }
    if (!Array.isArray(row.linked_request_ids)) throw E.check('estimates', 'estimates_linked_request_ids');
    // migration 036: 利益率は null か 0〜999、業者PDFは {org}/cases/{case}/estimates/{uuid}/src-*.pdf
    if (row.margin_pct != null && !(typeof row.margin_pct === 'number' && row.margin_pct >= 0 && row.margin_pct <= 999)) throw E.check('estimates', 'estimates_margin_pct_check');
    if (row.source_pdf_path != null && !new RegExp('^' + row.org_id + '/cases/' + row.case_id + '/estimates/[0-9a-f-]{36}/src-[A-Za-z0-9_-]{1,64}\\.(pdf|xlsx|xls|csv)$').test(row.source_pdf_path)) throw E.check('estimates', 'estimates_source_pdf_path_check'); // 075
    for (const rid of row.linked_request_ids) {
      if (!db.timeline_entries.some(x => x.id === rid && x.case_id === row.case_id && x.type === 'request')) throw P('紐付ける依頼が正しくありません');
    }
    if (!old) {
      if (row.status !== 'draft' || row.number != null || row.issued_at != null || row.sent_at != null || row.accepted_at != null) throw P('見積書は下書きとして作成してください');
      if (db.estimates.some(e => e.series_id === row.series_id && (e.org_id !== row.org_id || e.case_id !== row.case_id))) throw P('別の案件の見積書の版は作れません');
      if (db.estimates.some(e => e.series_id === row.series_id && e.version === row.version)) throw pgErr('duplicate key value violates unique constraint "estimates_series_id_version_key"', '23505');
    } else if (old.status !== 'draft') {
      if (row.status === 'draft') throw P('提出済みの見積書は下書きに戻せません');
      const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
      if (!same(row.lines, old.lines) || !same(row.data, old.data) || row.subtotal !== old.subtotal || row.tax !== old.tax || row.total !== old.total ||
          (row.margin_pct ?? null) !== (old.margin_pct ?? null) || (row.source_pdf_path ?? null) !== (old.source_pdf_path ?? null)) {
        throw P('提出済みの見積書は編集できません。新しい版を作ってください');
      }
    }
  }
  T.estimates = {
    insert(r) {
      if (r.org_id && r.org_id !== ORG_ID) throw E.rls('estimates');
      const row = { id: uuid(), org_id: ORG_ID, series_id: uuid(), version: 1, status: 'draft', number: null, data: {}, lines: [],
        subtotal: 0, tax: 0, total: 0, linked_request_ids: [], created_by: user.id, created_at: nowIso(), updated_at: nowIso(),
        issued_at: null, sent_at: null, accepted_at: null, phase_id: null, margin_pct: null, source_pdf_path: null, ...r,
        reedit_count: 0, reedit_at: null, reedit_by: null, reedit_by_name: null, reedit_mark: false, prev_status: null }; // 057: 画面から入れても既定値
      if (!caseOf(row.case_id)) throw E.fk('estimates', 'estimates_case_id_org_id_fkey');
      estimateChecks(row, null);
      phaseFk('estimates', row);
      return row;
    },
    validateUpdate(row, old) {
      estimateChecks(row, old || row); phaseFk('estimates', row);
      if (old && row.status !== old.status && ['sent', 'accepted'].includes(row.status)) row.reedit_mark = false; // 057: 送付・承諾で印を消す
    },
    touch: true,
    canDelete(row) { return row.status === 'draft' && !row.number; }, // 057: 番号のある下書き（再編集で戻したもの）は削除できない
    del: true
  };
  // issue_estimate(p_id): 自社の下書きのみ。系列で未採番なら会社ごとの連番 EST-+10桁、v2 以降は同系列の番号を引き継ぐ
  function issueEstimate(args) {
    const e = db.estimates.find(x => x.id === (args && args.p_id) && x.org_id === ORG_ID);
    if (!e) throw P('見積書が見つかりません');
    if (e.status !== 'draft') throw P('下書きの見積書だけ提出できます');
    const prev = db.estimates.filter(x => x.series_id === e.series_id && x.number).sort((a, b) => a.version - b.version)[0];
    let num = prev ? prev.number : null;
    if (!num) {
      let c = db.estimate_counters.find(x => x.org_id === ORG_ID);
      if (!c) { c = { org_id: ORG_ID, last: 0 }; db.estimate_counters.push(c); }
      c.last += 1;
      num = 'EST-' + String(c.last).padStart(10, '0');
    }
    Object.assign(e, { status: 'issued', number: num, issued_at: nowIso(), updated_at: nowIso() });
    if (e.reedit_mark) estimateReeditAfter(e); // 057
    return clone(e);
  }
  // migration 016: new_estimate_version(p_id, p_linked) — 自社の issued/sent の系列最新版から次版の下書きを作り、前版を superseded（1回の呼び出しで）。
  // 端数調整行（isAdjust かつ postTax）を除く・空なら空行1つ・諸経費の自動行を再計算（Math.round）・見積日=今日・有効期限+14日・
  // number null・linked は重複除去して estimates_links_guard（estimateChecks）で検査。新しい id を返す
  function newEstimateVersion(args) {
    const a = args || {};
    const e = db.estimates.find(x => x.id === a.p_id && x.org_id === ORG_ID);
    if (!e) throw P('見積書が見つかりません');
    const maxV = Math.max(...db.estimates.filter(x => x.series_id === e.series_id && x.org_id === ORG_ID).map(x => x.version));
    if (maxV > e.version) throw P(`第${e.version + 1}版はすでに作られています（別の画面や別の人がほぼ同時に作成しました）。見積書一覧を開き直してください`);
    if (!['issued', 'sent'].includes(e.status)) throw P('見積書の状態が変わっていたため（未提出・承諾済み・差し替え済みなど）、新しい版を作れませんでした。画面を開き直してください');
    let lines = clone(e.lines).filter(l => !(l && l.isAdjust === true && l.postTax === true));
    if (!lines.length) lines = [{ id: 'l' + uuid().replace(/-/g, ''), description: '', detail: '', quantity: 1, unit: '式', amount: 0 }];
    const num = v => (typeof v === 'number' ? v : (typeof v === 'string' && /^-?[0-9]+(\.[0-9]+)?$/.test(v.trim()) ? Number(v) : 0));
    const base = lines.filter(l => l.isAutoShokehi !== true && l.postTax !== true).reduce((s, l) => s + (typeof l.amount === 'number' ? l.amount : 0), 0);
    lines = lines.map(l => (l.isAutoShokehi === true ? Object.assign({}, l, { amount: Math.floor(base * num(l.shokehiPct) / 100 + 0.5) }) : l));
    const today = ymd(new Date());
    const data = Object.assign({}, clone(e.data || {}), { issueDate: today, validUntil: plusDays(14) });
    const linked = [];
    for (const x of (a.p_linked || [])) if (!linked.includes(x)) linked.push(x);
    if (linked.some(x => x == null)) throw P('紐付ける依頼の指定が正しくありません');
    const t = estimateTotals(lines);
    const row = T.estimates.insert({ case_id: e.case_id, series_id: e.series_id, version: e.version + 1, status: 'draft', number: null,
      data, lines, subtotal: t.subtotal, tax: t.tax, total: t.total, linked_request_ids: linked, phase_id: e.phase_id || null,
      margin_pct: e.margin_pct ?? null, source_pdf_path: e.source_pdf_path ?? null }); // 036: 利益率・業者PDFを引き継ぐ
    db.estimates.push(row);
    Object.assign(e, { status: 'superseded', prev_status: e.status, updated_at: nowIso() }); // 057: 旧版にする前の状態
    return row.id;
  }
  // migration 009/010: 担当者URL（期限は null=期限なし、ありなら発行から90日以内: migration 012）
  // migration 044: token（平文・43文字の base64url・一意）を保存して自社だけ読める。token の行の token_hash は DB が token から作る
  //   （偽では token_hash を持たせず、share_open / share_submit が token か token_hash のどちらかで照合する＝同じ結果）。
  //   token の無い行（044 より前の URL）は token_hash だけ。名前（vendor_name）は任意（既定 ''）。
  //   発行したら同じ報告書の使える（無効化・提出のどちらでもない）古い URL を revoked にする（report_shares_issue）
  T.report_shares = {
    insert(r) {
      const row = { id: uuid(), org_id: ORG_ID, token: null, vendor_name: '', revoked_at: null, submitted_at: null, created_by: user.id,
        created_at: nowIso(), ...r };
      if (row.token != null) {
        if (!/^[A-Za-z0-9_-]{43}$/.test(String(row.token))) throw E.check('report_shares', 'report_shares_token_check');
        if (db.report_shares.some(x => x.token === row.token)) throw pgErr('duplicate key value violates unique constraint "report_shares_token_key"', '23505');
        row.token_hash = null;
      } else {
        if (!/^[0-9a-f]{64}$/.test(String(row.token_hash || ''))) throw E.check('report_shares', 'report_shares_token_hash_check');
        if (db.report_shares.some(x => x.token_hash === row.token_hash)) throw pgErr('duplicate key value violates unique constraint "report_shares_token_hash_key"', '23505');
      }
      if (row.vendor_name == null) throw pgErr('null value in column "vendor_name" violates not-null constraint', '23502');
      if (Array.from(String(row.vendor_name)).length > 60) throw E.check('report_shares', 'report_shares_vendor_len');
      // migration 012: expires_at は null 可（期限なし）。期限ありは発行から90日以内
      if (row.expires_at === undefined) row.expires_at = null;
      if (row.expires_at != null && Date.parse(row.expires_at) > Date.parse(row.created_at) + 90 * 86400000) throw E.check('report_shares', 'report_shares_expiry_max');
      if (!db.reports.some(x => x.id === row.report_id)) throw E.fk('report_shares', 'report_shares_report_id_org_id_fkey');
      // migration 044 report_shares_issue: 同じ報告書の古い URL を無効にする（提出済みの記録はそのまま）
      const at = nowIso();
      db.report_shares.forEach(x => { if (x.report_id === row.report_id && !x.revoked_at && !x.submitted_at) x.revoked_at = at; });
      return row;
    },
    del: false
  };
  // migration 027: お客様ページURL（case_portals）は読むだけ（insert / update / delete の権限なし）
  T.case_portals = { insert() { throw E.denied('case_portals'); }, del: false };
  function reportChecks(row) {
    if (!['draft', 'submitted', 'confirmed', 'sent'].includes(row.status)) throw E.check('reports', 'reports_status_check');
    if (!['investigate', 'repair', 'restore', 'site_check'].includes(row.work_type)) throw E.check('reports', 'reports_work_type_check'); // 083: 現地確認の記録
    if (!row.data || typeof row.data !== 'object' || Array.isArray(row.data)) throw E.check('reports', 'reports_data_check');
    if (!Array.isArray(row.photos)) throw E.check('reports', 'reports_photos_check');
    if (row.submitted_via != null && !['member', 'share'].includes(row.submitted_via)) throw E.check('reports', 'reports_submitted_via_check');
  }
  const myRole = () => (memberOf(user.id) || {}).role;

  // cases の check と FK（006 + migration 020: 元請マスタの複合FK・関係者の文字数）
  const tooLong = (v, n) => v != null && Array.from(String(v)).length > n;
  function caseChecks(row) {
    if (blank(row.name)) throw E.check('cases', 'cases_name_check');
    if (!['open', 'done'].includes(row.status)) throw E.check('cases', 'cases_status_check');
    if (row.assignee_id && !memberOf(row.assignee_id)) throw E.fk('cases', 'cases_assignee_id_org_id_fkey');
    if (row.client_id && !db.clients.some(k => k.id === row.client_id && k.org_id === row.org_id)) throw E.fk('cases', 'cases_client_fk');
    for (const [col, n] of [['owner_name', 100], ['owner_email', 254], ['owner_tel', 40],
      ['resident_name', 100], ['resident_email', 254], ['resident_tel', 40]]) {
      if (tooLong(row[col], n)) throw E.check('cases', 'cases_' + col + '_check');
    }
    if (tooLong(row.room, 40)) throw E.check('cases', 'cases_room_check'); // migration 025
    if (row.request === undefined) row.request = {}; // テストが直接入れた古い形の行（列の既定値 {}）
    if (!caseRequestOk(row.request, row.org_id, row.id)) throw E.check('cases', 'cases_request_check'); // migration 052
  }
  // migration 052 の _case_request_ok と同じ判定
  function caseRequestOk(p, org, caseId) {
    if (!p || typeof p !== 'object' || Array.isArray(p)) return false;
    if (new TextEncoder().encode(JSON.stringify(p)).length > 60000) return false;
    for (const k of ['text', 'symptomOther', 'damage', 'suspect']) {
      if (k in p && (typeof p[k] !== 'string' || Array.from(p[k]).length > (k === 'text' ? 2000 : 1000))) return false;
    }
    if ('symptoms' in p && (!Array.isArray(p.symptoms) || p.symptoms.length > 20 || p.symptoms.some(x => typeof x !== 'string' || x.length > 40))) return false;
    if ('items' in p) { // migration 084: 調査依頼項目
      if (!Array.isArray(p.items) || p.items.length > 10) return false;
      for (const x of p.items) {
        if (!x || typeof x !== 'object' || Array.isArray(x) || !['visual', 'drain', 'ps', 'pressure', 'curing', 'curing_tenant', 'other'].includes(x.key)) return false;
        if ('places' in x && (!Array.isArray(x.places) || x.places.length > 10 || x.places.some(y => typeof y !== 'string' || Array.from(y).length > 40))) return false;
        if ('placeOther' in x && (typeof x.placeOther !== 'string' || Array.from(x.placeOther).length > 100)) return false;
        if ('text' in x && (typeof x.text !== 'string' || Array.from(x.text).length > 200)) return false;
      }
    }
    if ('photos' in p) {
      if (!Array.isArray(p.photos) || p.photos.length > 30) return false;
      const prefix = org + '/cases/' + caseId + '/request/';
      for (const x of p.photos) {
        if (!x || typeof x !== 'object' || Array.isArray(x) || typeof x.path !== 'string') return false;
        if (x.path.slice(0, prefix.length) !== prefix || !/^[A-Za-z0-9_-][A-Za-z0-9._-]{0,159}$/.test(x.path.slice(prefix.length)) || !/\.jpe?g$/i.test(x.path)) return false;
        if ('caption' in x && (typeof x.caption !== 'string' || Array.from(x.caption).length > 200)) return false;
        if ('name' in x && typeof x.name !== 'string') return false;
        if ('type' in x && typeof x.type !== 'string') return false;
        if ('size' in x && typeof x.size !== 'number') return false;
      }
      if (new Set(p.photos.map(x => x.path)).size !== p.photos.length) return false;
    }
    return true;
  }

  // migration 020: 元請マスタ（insert / update とも列 grant の6列だけ。delete は権限なし）
  const CLIENT_COLS = ['name', 'contact_name', 'email', 'tel', 'billing_mode', 'memo'];
  function clientChecks(row) {
    const n = Array.from(String(row.name == null ? '' : row.name).trim()).length;
    if (n < 1 || n > 100) throw E.check('clients', 'clients_name_check');
    if (!['single', 'monthly'].includes(row.billing_mode)) throw E.check('clients', 'clients_billing_mode_check');
    if (tooLong(row.contact_name, 100)) throw E.check('clients', 'clients_contact_name_check');
    if (tooLong(row.email, 254)) throw E.check('clients', 'clients_email_check');
    if (tooLong(row.tel, 40)) throw E.check('clients', 'clients_tel_check');
    if (tooLong(row.memo, 2000)) throw E.check('clients', 'clients_memo_check');
  }
  T.clients = {
    insert(r) {
      if (Object.keys(r).some(k => !CLIENT_COLS.includes(k))) throw E.denied('clients');
      const row = { id: uuid(), org_id: ORG_ID, contact_name: null, email: null, tel: null, billing_mode: 'single',
        memo: null, created_by: user.id, created_at: nowIso(), updated_at: nowIso(), ...r };
      clientChecks(row);
      return row;
    },
    validateUpdate(row) { clientChecks(row); },
    // migration 022 clients_sync_cases: name / email を変えたら紐付く案件の互換の列も同じ値に
    afterUpdate(row, old) {
      if (row.name === old.name && row.email === old.email) return;
      db.cases.filter(c => c.client_id === row.id && c.org_id === row.org_id &&
        (c.client_name !== row.name || c.client_email !== row.email)).forEach(c => {
        c.client_name = row.name; c.client_email = row.email; c.updated_at = nowIso();
      });
    },
    canUpdate: () => myRole() === 'owner', // migration 042: 元請マスタの編集は管理者だけ（スタッフは 0 行）
    touch: true,
    del: false
  };

  // migration 020: phase_id は同じ会社・同じ案件のフェーズだけ（複合FK）
  function phaseFk(t, row) {
    if (row.phase_id == null) return;
    if (!db.case_phases.some(p => p.id === row.phase_id && p.case_id === row.case_id && p.org_id === row.org_id)) {
      throw E.fk(t, t + '_phase_fk');
    }
  }
  // migration 020: メール下書きの用途・リマインドの check と一意
  function mailPhaseChecks(row) {
    // migration 023: survey_result（調査結果のご報告）を追加。日程連絡・リマインドと同じくフェーズに付く
    // migration 026: staff_notice（担当者への確認依頼・担当者向けの前日のお知らせ。remind_slot は d1 だけ）
    if (row.purpose != null && !['report', 'estimate', 'schedule', 'reminder', 'survey_result', 'staff_notice'].includes(row.purpose)) throw E.check('mail_drafts', 'mail_drafts_purpose_check');
    if (['schedule', 'reminder', 'survey_result', 'staff_notice'].includes(row.purpose) && !row.phase_id) throw E.check('mail_drafts', 'mail_drafts_phase_purpose_check');
    if ((row.purpose === 'reminder' && row.remind_slot == null) || (row.remind_slot != null && !['reminder', 'staff_notice'].includes(row.purpose)) ||
      (row.purpose === 'staff_notice' && row.remind_slot != null && row.remind_slot !== 'd1')) throw E.check('mail_drafts', 'mail_drafts_reminder_slot_check');
    if ((row.remind_slot == null) !== (row.remind_for == null)) throw E.check('mail_drafts', 'mail_drafts_reminder_for_check');
    if (row.skipped_at != null && row.status !== 'draft') throw E.check('mail_drafts', 'mail_drafts_skipped_check');
    // migration 030: 関係する部屋の居住者 room:{uuid}（mail_recipients_ok。30 個まで・null 不可）
    const ROOM_RE = /^room:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    if (!Array.isArray(row.recipients) || row.recipients.length > 30 ||
      row.recipients.some(x => !(['client', 'owner', 'resident', 'worker'].includes(x) || (typeof x === 'string' && ROOM_RE.test(x))))) throw E.check('mail_drafts', 'mail_drafts_recipients_check');
    // migration 027: staff_notice 以外に worker_id は付かない
    if (row.worker_id != null && row.purpose !== 'staff_notice') throw E.check('mail_drafts', 'mail_drafts_worker_check');
    // 一意: (phase_id, purpose, remind_slot, remind_for, worker_id) nulls not distinct（027。reminder は worker_id が null 同士で重複）
    if (row.remind_slot != null && db.mail_drafts.some(d => d.id !== row.id && d.phase_id === row.phase_id && d.purpose === row.purpose &&
      d.remind_slot === row.remind_slot && d.remind_for === row.remind_for && (d.worker_id || null) === (row.worker_id || null))) {
      throw pgErr('duplicate key value violates unique constraint "mail_drafts_reminder_key"', '23505');
    }
  }
  // migration 020/022: 対応フェーズ
  const PHASE_INSERT_COLS = ['case_id', 'kind', 'scheduled_at', 'scheduled_end', 'done_at', 'bill_to_type', 'bill_to_name',
    'billing_mode', 'billing_month', 'billed_at', 'paid_at', 'amount_override', 'note', 'estimate_due', 'label']; // estimate_due: migration 037・label: 058
  function phaseChecks(row) {
    if (!['site_check', 'survey', 'cause', 'repair', 'other'].includes(row.kind)) throw E.check('case_phases', 'case_phases_kind_check'); // 083: site_check
    // migration 058: その他は名前が必須（前後の空白なし・1〜40字）・ほかの種類は空
    if (row.kind === 'other' ? (typeof row.label !== 'string' || row.label !== row.label.trim() || Array.from(row.label).length < 1 || Array.from(row.label).length > 40)
      : row.label != null) throw E.check('case_phases', 'case_phases_label_check');
    if (!['client', 'owner', 'resident', 'other'].includes(row.bill_to_type)) throw E.check('case_phases', 'case_phases_bill_to_type_check');
    if (!['single', 'monthly'].includes(row.billing_mode)) throw E.check('case_phases', 'case_phases_billing_mode_check');
    if (row.scheduled_end != null && (row.scheduled_at == null || Date.parse(row.scheduled_end) < Date.parse(row.scheduled_at))) throw E.check('case_phases', 'case_phases_schedule_order_check');
    if (row.bill_to_type === 'other' && blank(row.bill_to_name)) throw E.check('case_phases', 'case_phases_other_name_check');
    if (row.bill_to_type !== 'client' && row.billing_mode !== 'single') throw E.check('case_phases', 'case_phases_monthly_client_check');
    if (row.billing_month != null && (row.billing_mode !== 'monthly' || !/^\d{4}-\d{2}-01$/.test(row.billing_month))) throw E.check('case_phases', 'case_phases_billing_month_check');
    if (tooLong(row.note, 2000)) throw E.check('case_phases', 'case_phases_note_check');
    // migration 020: amount_override は bigint・0〜1兆
    if (row.amount_override != null) {
      const a = row.amount_override;
      if (typeof a === 'boolean' || !Number.isInteger(Number(a)) || (typeof a === 'string' && !/^\s*[+-]?\d+\s*$/.test(a))) throw pgErr('invalid input syntax for type bigint', '22P02');
      if (Number(a) < 0 || Number(a) > 1000000000000) throw E.check('case_phases', 'case_phases_amount_override_check');
    }
    // migration 026: 確認は知らせた後だけ（case_phases_ack_check）
    if (row.ack_at != null && row.notified_at == null) throw E.check('case_phases', 'case_phases_ack_check');
    // migration 024: 入金期限は請求済みのときだけ
    if (row.payment_due != null && row.billed_at == null) throw E.check('case_phases', 'case_phases_payment_due_check');
    if (row.payment_due != null && !/^\d{4}-\d{2}-\d{2}$/.test(row.payment_due)) throw pgErr('invalid input syntax for type date', '22007');
    // migration 037: 見積書提案期日（date）
    if (row.estimate_due != null && !/^\d{4}-\d{2}-\d{2}$/.test(row.estimate_due)) throw pgErr('invalid input syntax for type date', '22007');
    // migration 023: result は object・cautions は配列・全体で 20000 バイトまで
    const r = row.result;
    if (r == null) throw E.notnull('case_phases', 'result');
    // migration 045（Task 25）: rooms（号室ごとの区画）は配列・20まで・要素は object・room / role / cause / damage は文字列
    const isObj = x => !!x && typeof x === 'object' && !Array.isArray(x);
    const roomsOk = (v, strKeys, arrKeys) => v === undefined || v === null || (Array.isArray(v) && v.length <= 20 && v.every(x => isObj(x)
      && strKeys.every(k => !(k in x) || typeof x[k] === 'string')
      && arrKeys.every(k => !(k in x) || (Array.isArray(x[k]) && x[k].every(y => typeof y === 'string')))));
    if (typeof r !== 'object' || Array.isArray(r) || ('cautions' in r && !Array.isArray(r.cautions)) ||
      !roomsOk(r.rooms, ['room', 'role', 'cause', 'damage'], []) ||
      new TextEncoder().encode(JSON.stringify(r)).length > 20000) throw E.check('case_phases', 'case_phases_result_check');
    // migration 054: visitRooms は無いか、20部屋までの [{ room（1〜40字）, role（''・cause・damage・other） }]・同じ号室なし
    const visitOk = v => v === undefined || v === null || (Array.isArray(v) && v.length <= 20 &&
      v.every(x => x && typeof x === 'object' && !Array.isArray(x) && typeof x.room === 'string' && Array.from(x.room).length >= 1 &&
        Array.from(x.room).length <= 40 && (!('role' in x) || ['', 'cause', 'damage', 'other'].includes(x.role))) &&
      new Set(v.map(x => x.room)).size === v.length);
    // migration 028（025 の check を作り直し）: plan（現場担当への指示）は object・suspects / priority は文字列の配列・
    // note / visitNote は文字列・全体で 10000 バイトまで
    const pl = row.plan;
    if (pl == null) throw E.notnull('case_phases', 'plan');
    const strArr = v => Array.isArray(v) && v.every(x => typeof x === 'string');
    if (typeof pl !== 'object' || Array.isArray(pl) || ('suspects' in pl && !strArr(pl.suspects)) || ('priority' in pl && !strArr(pl.priority)) ||
      ('note' in pl && typeof pl.note !== 'string') || ('visitNote' in pl && typeof pl.visitNote !== 'string') ||
      !roomsOk(pl.rooms, ['room', 'role', 'suspectOther', 'taskOther', 'note'], ['suspects', 'tasks']) || // 045: 号室ごとの指示
      !visitOk(pl.visitRooms) || // 054: 今回行く部屋
      new TextEncoder().encode(JSON.stringify(pl)).length > 10000) throw E.check('case_phases', 'case_phases_plan_check');
  }
  // migration 026 のトリガー case_phases_worker と同じ
  function workerTrigger(row, old) {
    const v = x => (x === undefined ? null : x);
    if (row.worker_id != null && !memberOf(row.worker_id)) throw E.fk('case_phases', 'case_phases_worker_fk');
    if (v(row.ack_at) !== v(old.ack_at)) {
      if (user.id !== row.worker_id) throw pgErr('担当者本人だけが「確認した」にできます', '42501');
      if (row.ack_at != null) {
        if (row.notified_at == null) throw pgErr('まだ担当者に知らせていません', '23514');
        row.ack_at = nowIso();
        row.ack_by = user.id;
      } else row.ack_by = null;
    } else row.ack_by = v(old.ack_by);
    if (v(row.notified_at) !== v(old.notified_at)) {
      if (row.notified_at != null) {
        if (!row.worker_id) throw pgErr('作業担当者が決まっていません', '23514');
        row.notified_at = nowIso();
        row.notified_by = user.id;
      } else row.notified_by = null;
      row.ack_at = null;
      row.ack_by = null;
    } else {
      row.notified_by = v(old.notified_by);
      if (v(row.worker_id) !== v(old.worker_id)) Object.assign(row, { notified_at: null, notified_by: null, ack_at: null, ack_by: null });
    }
  }
  // migration 046 のトリガー case_phases_sync_report_worker と同じ: 作業担当者が変わったら、そのフェーズの未提出の報告書の作業者を同じ人に（名前は空）
  function syncReportWorker(phase, old) {
    const v = x => (x === undefined ? null : x);
    if (v(phase.worker_id) === v(old.worker_id)) return;
    db.reports.filter(x => x.phase_id === phase.id && x.org_id === phase.org_id && x.status === 'draft'
      && (v(x.worker_id) !== v(phase.worker_id) || x.worker_name != null)).forEach(x => {
      x.worker_id = v(phase.worker_id); x.worker_name = null; x.updated_at = nowIso();
    });
  }
  T.case_phases = {
    insert(r) {
      if (Object.keys(r).some(k => !PHASE_INSERT_COLS.includes(k))) throw E.denied('case_phases');
      if (myRole() !== 'owner') throw pgErr('対応（フェーズ）を追加できるのは管理者だけです', '42501'); // migration 071
      const row = { id: uuid(), org_id: ORG_ID, scheduled_at: null, scheduled_end: null, done_at: null, bill_to_type: 'client',
        bill_to_name: null, billing_mode: 'single', billing_month: null, billed_at: null, paid_at: null, amount_override: null,
        note: null, legacy_work_id: null, created_by: user.id, created_at: nowIso(), updated_at: nowIso(), result: {}, payment_due: null, plan: {},
        worker_id: null, notified_at: null, notified_by: null, ack_at: null, ack_by: null, estimate_due: null, label: null, source_phase_id: null,
        open_call_at: null, open_call_by: null, open_call_kind: null, open_call_from: null, open_call_to: null, open_call_expired_at: null, ...r }; // 070・076
      if (!caseOf(row.case_id)) throw E.fk('case_phases', 'case_phases_case_id_org_id_fkey');
      if (!row.worker_id) row.worker_id = caseOf(row.case_id).assignee_id || null; // 026: 初期値は案件の担当者
      phaseChecks(row);
      noDouble(row, null); // 072
      row.schedule_set_at = row.scheduled_at != null ? nowIso() : null; // 022 のトリガー
      return row;
    },
    validateUpdate(row, old) {
      if (row.worker_id && row.open_call_at) { row.open_call_at = null; row.open_call_by = null; } // 070: 担当者が入ったら募集を閉じる
      noDouble(row, old); // 072（BEFORE トリガー）
      workerTrigger(row, old); // BEFORE トリガーが先、check 制約は後（本物と同じ順）
      phaseChecks(row);
      const t = v => (v == null ? null : Date.parse(v));
      row.schedule_set_at = t(row.scheduled_at) !== t(old.scheduled_at)
        ? (row.scheduled_at != null ? nowIso() : null) : (old.schedule_set_at === undefined ? null : old.schedule_set_at);
    },
    afterUpdate(row, old) { // 046・069・072
      syncReportWorker(row, old); schedSync(row, old);
      const t = v => (v == null ? null : Date.parse(v));
      if (row.worker_id && (row.worker_id !== old.worker_id || t(row.scheduled_at) !== t(old.scheduled_at) || t(row.scheduled_end) !== t(old.scheduled_end))) blockedScan(row.worker_id);
    },
    // case_phases_delete_guard: 中身があれば拒否、未送信の下書きは一緒に消す
    beforeDelete(row) {
      if (db.estimates.some(e => e.phase_id === row.id) || db.reports.some(x => x.phase_id === row.id) ||
        db.notices.some(n => n.phase_id === row.id) || db.mail_drafts.some(d => d.phase_id === row.id && d.status !== 'draft')) {
        throw P0001('見積書・報告書・工事掲示・送ったメールがあるフェーズは削除できません');
      }
      db.mail_drafts = db.mail_drafts.filter(d => !(d.phase_id === row.id && d.status === 'draft'));
      db.phase_schedules = db.phase_schedules.filter(x => x.phase_id !== row.id); // 069: on delete cascade
    },
    touch: true,
    del: true
  };

  // migration 029: 見積のよく使う明細（定型）。068（Task 49）: owner_user_id（null = 会社共通・自分の id = 自分専用。insert だけ列 grant）
  const PRESET_COLS = ['kind', 'label', 'line', 'sort', 'owner_user_id'];
  const presetMine = r => !!r.owner_user_id && r.owner_user_id === user.id;
  const presetWritable = r => presetMine(r) || (!r.owner_user_id && myRole() === 'owner'); // 068: 自分専用は本人・会社共通は管理者
  function presetChecks(row) {
    const ck = c => E.check('estimate_presets', 'estimate_presets_' + c + '_check');
    if (!['common', 'site_check', 'survey', 'cause', 'repair'].includes(row.kind)) throw ck('kind'); // 083: site_check
    const label = String(row.label == null ? '' : row.label);
    if (Array.from(label).length > 40 || !label.trim()) throw ck('label');
    if (!Number.isInteger(row.sort) || row.sort < 0 || row.sort > 1000000) throw ck('sort');
    const l = row.line;
    if (l == null) throw E.notnull('estimate_presets', 'line');
    const isNum = v => typeof v === 'number' && Number.isFinite(v);
    const len = v => Array.from(String(v)).length;
    const ok = typeof l === 'object' && !Array.isArray(l) &&
      new TextEncoder().encode(JSON.stringify(l)).length <= 2000 &&
      Object.keys(l).every(k => ['description', 'detail', 'quantity', 'unit', 'amount', 'unitPrice', 'postTax', 'step'].includes(k)) &&
      typeof l.description === 'string' && len(l.description.trim()) >= 1 && len(l.description.trim()) <= 200 &&
      (!('detail' in l) || (typeof l.detail === 'string' && len(l.detail) <= 500)) &&
      typeof l.unit === 'string' && len(l.unit) <= 10 &&
      isNum(l.quantity) && l.quantity >= 0 && l.quantity <= 1000000 &&
      isNum(l.amount) && Number.isInteger(l.amount) && Math.abs(l.amount) <= 1e12 &&
      (!('unitPrice' in l) || (isNum(l.unitPrice) && Math.abs(l.unitPrice) <= 1e12)) &&
      (!('postTax' in l) || l.postTax === false) &&
      (l.step == null || (Number.isInteger(l.step) && l.step >= 1 && l.step <= 1000000)); // migration 039
    if (!ok) throw ck('line');
  }
  T.estimate_presets = {
    insert(r) {
      if (Object.keys(r).some(k => !PRESET_COLS.includes(k))) throw E.denied('estimate_presets');
      const row = { id: uuid(), org_id: ORG_ID, kind: 'common', sort: 0, owner_user_id: null, created_by: user.id, created_at: nowIso(), updated_at: nowIso(), ...clone(r) };
      if (!presetWritable(row)) throw E.rls('estimate_presets'); // 068: presets_insert の with check
      presetChecks(row);
      return row;
    },
    validateUpdate(row) { presetChecks(row); },
    canSelect: r => !r.owner_user_id || presetMine(r), // 068: 自分専用は本人だけ
    canUpdate: presetWritable, // 042 / 068: 見えない・書けない行は 0 行
    canDelete: presetWritable,
    touch: true,
    del: true
  };

  // migration 030: 関係する部屋（insert は列 grant の case_id / role / room / resident_name / email / tel / note / sort・
  //   org_id / created_by は既定値・複合FK・check の文字数。update は case_id 以外・delete 可。案件ごと消えると消える＝案件は消せないので無し）
  const ROOM_INSERT_COLS = ['case_id', 'role', 'room', 'resident_name', 'email', 'tel', 'note', 'sort'];
  function roomChecks(row) {
    const ck = c => E.check('case_rooms', 'case_rooms_' + c + '_check');
    const len = v => Array.from(String(v)).length;
    if (!['cause', 'damage', 'other'].includes(row.role)) throw ck('role');
    if (row.room == null) throw E.notnull('case_rooms', 'room');
    if (len(row.room) > 40 || !String(row.room).trim()) throw ck('room');
    if (row.resident_name != null && len(row.resident_name) > 100) throw ck('resident_name');
    if (row.email != null && len(row.email) > 254) throw ck('email');
    if (row.tel != null && len(row.tel) > 40) throw ck('tel');
    if (row.note != null && len(row.note) > 500) throw ck('note');
    if (!Number.isInteger(row.sort) || row.sort < 0 || row.sort > 1000000) throw ck('sort');
  }
  T.case_rooms = {
    insert(r) {
      if (Object.keys(r).some(k => !ROOM_INSERT_COLS.includes(k))) throw E.denied('case_rooms');
      const row = { id: uuid(), org_id: ORG_ID, role: 'cause', resident_name: null, email: null, tel: null, note: null, sort: 0,
        created_by: user.id, created_at: nowIso(), updated_at: nowIso(), ...clone(r) };
      if (!caseOf(row.case_id)) throw E.fk('case_rooms', 'case_rooms_case_id_org_id_fkey');
      roomChecks(row);
      return row;
    },
    validateUpdate(row) { roomChecks(row); },
    touch: true,
    del: true,
    // migration 054: 関係する部屋を消したら、その案件のフェーズの plan.visitRooms からその号室を外す（同じ号室が残っていれば外さない。
    //   トリガーの中の更新なので case_edits には記録しない・updated_at は touch で進む）
    afterDelete(old) {
      const room = String(old.room || '').trim();
      if (!room) return;
      const c = db.cases.find(x => x.id === old.case_id);
      if (!c) return;
      if (String(c.room || '').trim() === room || db.case_rooms.some(r => r.case_id === old.case_id && String(r.room).trim() === room)) return;
      db.case_phases.forEach(p => {
        const v = p.plan && Array.isArray(p.plan.visitRooms) ? p.plan.visitRooms : null;
        if (!v || !v.some(x => String((x && x.room) || '').trim() === room)) return;
        p.plan = { ...p.plan, visitRooms: v.filter(x => String((x && x.room) || '').trim() !== room) };
        p.updated_at = nowIso();
      });
    }
  };
  // migration 041: 現場からの連絡
  const MSG_INSERT_COLS = ['case_id', 'phase_id', 'to_user', 'subject', 'body', 'attachments', 'reply_to', 'as_client']; // 065: as_client（元請から）
  // 065: talk_visible（管理者は全部。スタッフは自分が送った／自分あて／担当の案件（案件の担当者かフェーズの作業担当者）／案件なしで宛先なしの管理者の書き込み）
  const talkVisible = (caseId, from, to) => {
    if (myRole() === 'owner' || (from && from === user.id) || (to && to === user.id)) return true;
    if (caseId) { const c = caseOf(caseId); return !!c && (c.assignee_id === user.id || db.case_phases.some(p => p.case_id === c.id && p.worker_id === user.id)); }
    const fm = from && memberOf(from);
    return !to && !!fm && fm.role === 'owner';
  };
  // 079・080（Task 57）: can_see_case — 管理者は自社の全部。作業担当者は 案件の担当者／対応の作業担当者／現場用で自分が登録した案件
  //   （created_by が本人で case_create の連絡がある）だけ。案件にぶら下がる表の行・case_summaries・files の {org}/cases/{case}/ もこれで絞る
  const caseVisible = id => {
    const c = caseOf(id);
    if (!c || c.org_id !== ORG_ID) return false;
    if (myRole() === 'owner') return true;
    return c.assignee_id === user.id || db.case_phases.some(p => p.case_id === c.id && p.worker_id === user.id)
      || (c.created_by === user.id && db.staff_messages.some(m => m.case_id === c.id && m.source === 'case_create'));
  };
  const phaseCase = id => (db.case_phases.find(p => p.id === id) || {}).case_id;
  const CASE_OF_ROW = {
    cases: r => r.id, case_phases: r => r.case_id, reports: r => r.case_id, estimates: r => r.case_id, notices: r => r.case_id,
    mail_drafts: r => r.case_id, timeline_entries: r => r.case_id, case_rooms: r => r.case_id, case_edits: r => r.case_id,
    case_portals: r => r.case_id, case_actions: r => r.case_id, case_works: r => r.case_id, phase_task_flags: r => r.case_id,
    phase_schedules: r => phaseCase(r.phase_id), open_call_apps: r => phaseCase(r.phase_id),
    report_shares: r => (db.reports.find(x => x.id === r.report_id) || {}).case_id
  };
  const rowVisible = (t, r) => !CASE_OF_ROW[t] || caseVisible(CASE_OF_ROW[t](r));
  // files バケットの {org}/cases/{case}/... は見える案件だけ（storage_case_ok）。ほか（日報・ロゴ）は今まで通り
  //   管理者は案件の行が無くても通す（078 で完全に消した案件のファイルの片付け）
  const fileCaseOk = path => { const seg = String(path).split('/'); return myRole() === 'owner' || seg[1] !== 'cases' || seg.length < 4 ? true : caseVisible(seg[2]); };
  // 051: 自分が送った連絡は数えない（画面の PhaseLogic.messageForMe と同じ）
  const msgForMe = m => !m.read_at && m.from_user !== user.id && (m.to_user ? m.to_user === user.id : myRole() === 'owner');
  T.staff_messages = {
    insert(r) {
      if (Object.keys(r).some(k => !MSG_INSERT_COLS.includes(k))) throw E.denied('staff_messages');
      const row = { id: uuid(), org_id: ORG_ID, phase_id: null, to_user: null, body: '', attachments: [], reply_to: null, ...clone(r),
        from_user: user.id, read_at: null, created_at: nowIso(), source: 'staff', daily_date: null, as_client: r.as_client === true };
      const ck = c => E.check('staff_messages', 'staff_messages_' + c + '_check');
      // 065: 元請からは管理者だけ・案件のあるときだけ。案件の無い手動の連絡（全体のトーク）は作れる
      if (row.as_client && myRole() !== 'owner') throw pgErr('「元請から」として書き込めるのは管理者だけです', '42501');
      if (row.as_client && row.case_id == null) throw ck('as_client');
      if (row.case_id != null && !caseOf(row.case_id)) throw E.fk('staff_messages', 'staff_messages_case_id_org_id_fkey');
      if (row.subject == null) throw E.notnull('staff_messages', 'subject');
      const sl = Array.from(String(row.subject).trim()).length;
      if (sl < 1 || sl > 100) throw ck('subject');
      if (Array.from(String(row.body)).length > 4000) throw ck('body');
      if (!Array.isArray(row.attachments) || row.attachments.length > 10) throw ck('attachments');
      if (row.to_user && !memberOf(row.to_user)) throw E.fk('staff_messages', 'staff_messages_to_user_org_id_fkey');
      if (row.phase_id && (row.case_id == null || !db.case_phases.some(p => p.id === row.phase_id && p.case_id === row.case_id))) throw pgErr('対応（調査・工事）がこの案件のものではありません', '23514');
      if (row.reply_to && !db.staff_messages.some(m => m.id === row.reply_to && (m.case_id || null) === (row.case_id || null))) throw pgErr('返事のもとの連絡が見つかりません', '23514');
      const prefix = row.case_id == null ? ORG_ID + '/daily/' + user.id + '/' : ORG_ID + '/cases/' + row.case_id + '/messages/';
      if (row.attachments.some(a => !a || typeof a.path !== 'string' || a.path.slice(0, prefix.length) !== prefix || a.path.includes('..'))) throw pgErr('添付の形が不正です', '23514');
      return row;
    },
    afterInsert(row) {
      // migration 063: 管理者が差し戻しのやり取りに返事 → 済み（返事の元をたどる）
      if (row.reply_to && memberOf(row.from_user) && memberOf(row.from_user).role === 'owner') {
        const chain = [];
        for (let id = row.reply_to, n = 0; id && n < 50; n++) { chain.push(id); const m = db.staff_messages.find(x => x.id === id); id = m ? m.reply_to : null; }
        db.phase_task_flags.filter(f => f.action === 'sendback' && !f.closed_at && chain.includes(f.message_id))
          .forEach(f => { f.closed_at = nowIso(); f.closed_by = row.from_user; });
      }
      if (row.source !== 'staff') return; // 047: 自動の連絡は reports_next_action が記録する
      if (row.case_id == null) return; // 053: 日報への返事は書かない
      const m = memberOf(row.from_user);
      const nm = (m && m.display_name) || '不明', sj = String(row.subject).trim();
      db.timeline_entries.push({ id: uuid(), org_id: row.org_id, case_id: row.case_id, type: 'system', attachments: [], audiences: [], resolved_at: null,
        body: row.as_client ? '元請からのメッセージ: ' + sj + '（' + nm + 'が入力）' // 065
          : !row.reply_to && m && m.role === 'owner' ? '管理者からのメッセージ: ' + sj + '（' + nm + '）'
          : (row.reply_to ? '現場からの連絡に返事: ' : '現場からの連絡: ') + sj + '（' + nm + '）',
        created_by: null, created_at: nowIso() });
    },
    canUpdate: m => (m.to_user ? m.to_user === user.id : myRole() === 'owner'), // staff_messages_read: 宛先の人だけ（それ以外は 0 行）
    canSelect: m => talkVisible(m.case_id, m.from_user, m.to_user) || (m.source === 'open_call' && !m.case_id), // 065・070: 募集のカードは全員
    del: false
  };
  T.talk_reads = { canSelect: r => r.user_id === user.id, del: false }; // 065: 自分の分だけ読める（insert / update は無い）
  T.phase_schedules = { insert() { throw E.denied('phase_schedules'); }, update: false, del: false }; // 069: 読むだけ
  T.open_call_apps = { insert() { throw E.denied('open_call_apps'); }, update: false, del: false }; // 070: 読むだけ
  T.purge_files = { insert() { throw E.denied('purge_files'); }, update: false, del: false, canSelect: () => myRole() === 'owner' }; // 078: 管理者だけ読む
  // migration 069: 日時の欄で直接入れた → 確定、消した → 未定（case_phases_sched_sync）
  function schedSync(row, old) {
    const t = v => (v == null ? null : Date.parse(v));
    const sc = db.phase_schedules.find(x => x.phase_id === row.id);
    if (!sc || t(row.scheduled_at) === t(old.scheduled_at)) return;
    if (row.scheduled_at != null && sc.state !== 'confirmed') Object.assign(sc, { state: 'confirmed', confirmed_by: sc.confirmed_by || user.id, confirmed_at: sc.confirmed_at || nowIso(), updated_at: nowIso() });
    else if (row.scheduled_at == null && sc.state === 'confirmed') Object.assign(sc, { state: 'none', updated_at: nowIso() });
  }
  function roomsSummary(c) {
    return db.case_rooms.filter(r => r.case_id === c.id && r.org_id === c.org_id)
      .sort((a, b) => a.sort - b.sort || (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : 1))
      .map(r => ({ id: r.id, role: r.role, room: r.room, resident_name: r.resident_name, email: r.email, tel: r.tel, note: r.note, sort: r.sort }));
  }

  // migration 037 の _report_data_check と同じ: エラー文 or null
  const CAUSE_KEYS = ['tenant', 'hot_pipe', 'water_pipe', 'washer', 'toilet', 'kitchen', 'washroom', 'bath', 'balcony', 'other', 'unknown']; // 064: 不明
  function reportDataCheck(p, workType) {
    const bad = '送信内容が不正です';
    const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
    const len = v => Array.from(v == null ? '' : String(v)).length;
    const strOrNull = v => v == null || typeof v === 'string';
    if (!isObj(p)) return bad;
    for (const k of ['workItemOther', 'causeTenantReason', 'causeOther', 'leakActionOther', 'keyReturn', 'tenantNote']) if (!strOrNull(p[k]) || len(p[k]) > 1000) return bad; // 074: tenantNote
    for (const k of ['keyBorrowed', 'keyReturned']) if (p[k] != null && typeof p[k] !== 'boolean') return bad; // 038
    if (p.keyStatus != null && !['', 'returned', 'none'].includes(p.keyStatus)) return bad; // 074: 鍵（返却した／借りていない）
    if (p.roomStatus != null) { // 038: お部屋の状況
      const r = p.roomStatus;
      if (!isObj(r)) return bad;
      if (r.luggage != null && !['many', 'few'].includes(r.luggage)) return bad;
      if (r.pet != null && typeof r.pet !== 'boolean') return bad;
      if (r.residents != null && !(Number.isInteger(r.residents) && r.residents >= 0 && r.residents <= 20)) return bad;
    }
    if (p.workItems != null) {
      if (!Array.isArray(p.workItems) || p.workItems.length > 20) return bad;
      if (p.workItems.some(x => typeof x !== 'string' || len(x) > 100)) return bad;
    }
    if (p.causes != null) {
      if (!Array.isArray(p.causes) || p.causes.length > 20) return bad;
      if (p.causes.some(x => !isObj(x) || !CAUSE_KEYS.includes(x.key) || !strOrNull(x.detail) || len(x.detail) > 200)) return bad;
    }
    // migration 064 → 074: 原因が「不明」なら次の対応方針は「再調査」か「その他」（その他は内容が必須。調査のとき）
    if (workType === 'investigate' && Array.isArray(p.causes) && p.causes.some(x => x.key === 'unknown')) {
      const nt = isObj(p.nextAction) ? p.nextAction.type : '';
      if (nt !== 'resurvey' && nt !== 'other') return '原因が「不明」のときは、次の対応方針を「再調査」か「その他」にしてください';
      if (nt === 'other' && blank(p.nextAction.other)) return '「その他」の内容を入れてください';
    }
    const n = p.nextAction;
    if (n == null) return null;
    if (!isObj(n)) return bad;
    for (const k of ['type', 'estimateDue', 'reason', 'detail', 'other', 'estimateDueReason', 'estimateDueBy']) if (!strOrNull(n[k]) || len(n[k]) > 1000) return bad;
    if (n.estimateDueBy) { // 053: いつまでに提出できるか（入れるなら実在する日付）
      const mb = /^(\d{4})-(\d{2})-(\d{2})$/.exec(n.estimateDueBy);
      const db0 = mb ? new Date(Date.UTC(+mb[1], +mb[2] - 1, +mb[3])) : null;
      if (!mb || db0.getUTCMonth() !== +mb[2] - 1 || db0.getUTCDate() !== +mb[3]) return '「いつまでに提出できるか」の日付が正しくありません';
    }
    const t = n.type || '';
    if (!['', 'cause', 'resurvey', 'other'].includes(t)) return bad;
    if (workType !== 'investigate') return null;
    if (t === 'cause' || t === 'resurvey') { // 038: 再調査にも期日
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(n.estimateDue || '');
      const dt = m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
      if (!m || dt.getUTCMonth() !== +m[2] - 1 || dt.getUTCDate() !== +m[3]) return '「' + (t === 'cause' ? '原因元工事' : '再調査') + '」の見積書提案期日を入れてください';
    }
    if (t === 'resurvey') {
      if (blank(n.reason) || blank(n.detail)) return '「再調査」の理由と内容を入れてください';
    }
    return null;
  }
  // migration 037 reports_next_action: 調査の提出の「次の対応方針」→ 原因元工事の estimate_due（無ければ作る）・タイムライン
  function reportNextAction(r) {
    if (r.work_type !== 'investigate') return;
    // migration 040: 再調査の期限（A）。この報告書の調査フェーズまで（フェーズが無ければ全部）の調査の estimate_due を消す
    {
      const p0 = r.phase_id ? db.case_phases.find(x => x.id === r.phase_id && x.org_id === r.org_id) : null;
      const le = (a, b) => a.created_at < b.created_at || (a.created_at === b.created_at && a.id <= b.id);
      db.case_phases.filter(x => x.case_id === r.case_id && x.org_id === r.org_id && x.kind === 'survey' && x.estimate_due != null && (!p0 || le(x, p0)))
        .forEach(x => { x.estimate_due = null; x.estimate_due_reason = null; x.estimate_due_by = null; x.updated_at = nowIso(); });
    }
    const n = r.data && r.data.nextAction;
    if (!n || typeof n !== 'object' || !['cause', 'resurvey'].includes(n.type)) return;
    const name = v => (v == null || !String(v).trim() ? null : String(v).trim());
    const who = name(r.worker_name) || (r.worker_id && memberOf(r.worker_id) ? name(memberOf(r.worker_id).display_name) : null)
      || (r.submitted_by && memberOf(r.submitted_by) ? name(memberOf(r.submitted_by).display_name) : null) || '作業担当者'; // 040: 名前が無いときの呼び名
    const tl = body => db.timeline_entries.push({ id: uuid(), org_id: r.org_id, case_id: r.case_id, type: 'system', attachments: [], audiences: [],
      resolved_at: null, body, created_by: null, created_at: nowIso() });
    const worker = r.worker_id && memberOf(r.worker_id) && memberOf(r.worker_id).org_id === r.org_id ? r.worker_id : null; // 038
    const c = caseOf(r.case_id);
    const k = c && c.client_id ? db.clients.find(x => x.id === c.client_id && x.org_id === c.org_id) : null;
    // migration 058: 作った元の調査（この報告書の調査フェーズ）
    const srcPhase = r.phase_id ? db.case_phases.find(x => x.id === r.phase_id && x.org_id === r.org_id) : null;
    const src = srcPhase && srcPhase.kind === 'survey' ? srcPhase.id : null;
    const newPhase = kind => {
      const row = { id: uuid(), org_id: r.org_id, case_id: r.case_id, kind, scheduled_at: null, scheduled_end: null, done_at: null,
        bill_to_type: 'client', bill_to_name: null, billing_mode: k && k.billing_mode === 'monthly' ? 'monthly' : 'single', billing_month: null,
        billed_at: null, paid_at: null, amount_override: null, note: null, legacy_work_id: null, created_by: signedIn ? user.id : null,
        created_at: nowIso(), updated_at: nowIso(), result: {}, payment_due: null, plan: {}, schedule_set_at: null,
        worker_id: worker, notified_at: null, notified_by: null, ack_at: null, ack_by: null, estimate_due: n.estimateDue,
        label: null, source_phase_id: src }; // 058: 作った元の調査
      db.case_phases.push(row);
      return row;
    };
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(n.estimateDue);
    const md = Number(m[2]) + '/' + Number(m[3]);
    // 053: 期日が提出日（日本時間）＋2日より先なら理由・提出できる日を写す（2日以内なら空）
    const subYmd = new Date(Date.parse(r.submitted_at || nowIso()) + 9 * 3600000).toISOString().slice(0, 10);
    const lim = new Date(Date.UTC(+subYmd.slice(0, 4), +subYmd.slice(5, 7) - 1, +subYmd.slice(8, 10) + 2)).toISOString().slice(0, 10);
    let reason = n.estimateDue > lim ? String(n.estimateDueReason || '').trim().slice(0, 500) || null : null;
    const by = reason && n.estimateDueBy ? n.estimateDueBy : null;
    const why = reason ? '（理由: ' + reason + (by ? '・提出 ' + Number(by.slice(5, 7)) + '/' + Number(by.slice(8, 10)) + ' まで' : '') + '）' : '';
    let target = null;
    if (n.type === 'cause') {
      const open = db.case_phases.filter(x => x.case_id === r.case_id && x.org_id === r.org_id && x.kind === 'cause' && !x.done_at && !x.paid_at)
        .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : a.id < b.id ? 1 : -1));
      if (open.length) {
        target = open[0];
        open[0].estimate_due = n.estimateDue;
        if (src) open[0].source_phase_id = src; // 058
        // migration 040: 作業担当者は上書きしない（空のときだけ入れる）
        if (worker && !open[0].worker_id) {
          const old0 = { ...open[0] };
          open[0].worker_id = worker; open[0].notified_at = null; open[0].notified_by = null; open[0].ack_at = null; open[0].ack_by = null;
          syncReportWorker(open[0], old0); // 046
        }
        open[0].updated_at = nowIso();
      } else {
        target = newPhase('cause');
        tl('原因元工事を追加した（調査報告から）');
      }
      tl((who + 'が調査報告で『原因元工事・見積書 ' + md + ' までに提案』と報告した' + why).slice(0, 2000));
    } else {
      // 057: 再編集のあとの再提出は、この報告書の調査より後の調査（最初の提出で作ったもの）を使う
      const p0 = r.phase_id ? db.case_phases.find(x => x.id === r.phase_id) : null;
      const later = r.reedit_count > 0 && p0 ? db.case_phases.filter(x => x.case_id === r.case_id && x.kind === 'survey'
        && (x.created_at > p0.created_at || (x.created_at === p0.created_at && x.id > p0.id))).sort((a, b) => (a.created_at < b.created_at ? -1 : 1))[0] : null;
      if (later) { target = later; later.estimate_due = n.estimateDue; if (!later.worker_id && worker) later.worker_id = worker; if (src) later.source_phase_id = src; later.updated_at = nowIso(); }
      else {
      target = newPhase('survey');
      const seq = db.case_phases.filter(x => x.case_id === r.case_id && x.org_id === r.org_id && x.kind === 'survey').length;
      tl('調査 ' + seq + '回目を追加した（調査報告から・再調査）');
      }
      tl((who + 'が調査報告で『再調査・見積書 ' + md + ' までに提案』と報告した（理由: ' + String(n.reason).trim() + '／内容: ' + String(n.detail).trim() + '）' + why).slice(0, 2000));
    }
    target.estimate_due_reason = reason;
    target.estimate_due_by = by;
    // migration 047: 管理者への自動の連絡
    const rooms = reportRoomCauses(r);
    const body = ['次の対応方針: ' + (n.type === 'cause' ? '原因元工事' : '再調査'), '見積書提案期日: ' + mdW(n.estimateDue) + why,
      '提出: ' + who + (r.submitted_via === 'share' ? '（担当者URL）' : '')]
      .concat(n.type === 'resurvey' ? ['再調査の理由: ' + String(n.reason || '').trim(), '再調査の内容: ' + String(n.detail || '').trim()] : [])
      .join('\n') + (rooms ? '\n\n■ 号室ごとの原因\n' + rooms : '');
    db.staff_messages.push({ id: uuid(), org_id: r.org_id, case_id: r.case_id, phase_id: r.phase_id || null, from_user: signedIn ? user.id : null,
      to_user: null, subject: '調査報告を' + (r.reedit_count > 0 ? '再提出' : '提出') + 'しました（見積書提案期日 ' + md + '）', body: Array.from(body).slice(0, 4000).join(''), attachments: [],
      read_at: null, reply_to: null, created_at: nowIso(), source: r.reedit_count > 0 ? 'reedit' : 'report_submit' }); // 057: 再提出
  }
  // migration 047 の補助関数と同じ文
  const CAUSE_DEFS = [['tenant', '入居者やらかし', 'tenant'], ['hot_pipe', '給湯管', ''], ['water_pipe', '給水管', ''], ['washer', '洗濯機', 'detail'],
    ['toilet', 'トイレ', 'detail'], ['kitchen', 'キッチン', 'detail'], ['washroom', '洗面所', 'detail'], ['bath', '浴室', 'detail'],
    ['balcony', 'ベランダ', 'detail'], ['other', 'その他', 'other'], ['unknown', '不明', '']]; // 064: 不明
  function causeTextOf(d) {
    const p = d && typeof d === 'object' ? d : {};
    const cs = Array.isArray(p.causes) ? p.causes.filter(x => x && typeof x === 'object') : [];
    const t = v => String(v == null ? '' : v).trim();
    const parts = CAUSE_DEFS.filter(([k]) => cs.some(x => x.key === k)).map(([k, label, input]) => {
      const det = t((cs.find(x => x.key === k) || {}).detail);
      if (input === 'other') return t(p.causeOther) || label;
      if (input === 'tenant' && t(p.causeTenantReason)) return label + '（' + t(p.causeTenantReason) + '）';
      if (input === 'detail' && det) return label + '（' + det + '）';
      return label;
    });
    return [parts.join('、'), t(p.f2).replace(/\s*\n\s*/g, ' ')].filter(Boolean).join('／');
  }
  function mdW(ymd) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return (d.getUTCMonth() + 1) + '/' + d.getUTCDate() + '（' + '日月火水木金土'[d.getUTCDay()] + '）';
  }
  function roomHead(room, role) {
    const r = String(room || '').trim();
    return (!r ? '号室未設定' : /[0-9０-９A-Za-zＡ-Ｚａ-ｚ]$/.test(r) ? r + '号室' : r)
      + ({ cause: '（加害部屋）', damage: '（被害部屋）', other: '（その他）' }[role] || '');
  }
  function reportRoomCauses(r) {
    const key = v => String(v || '').trim().toLowerCase();
    const reps = db.reports.filter(x => x.org_id === r.org_id && x.case_id === r.case_id && x.work_type === 'investigate'
      && (x.id === r.id || (r.phase_id && x.phase_id === r.phase_id && x.status !== 'draft')))
      .sort((a, b) => (a.id === r.id ? -1 : b.id === r.id ? 1 : String(b.submitted_at || '').localeCompare(String(a.submitted_at || ''))));
    const rows = [];
    reps.forEach(x => { if (!rows.some(y => key(y.room) === key(x.room))) rows.push({ room: String(x.room || '').trim(), cause: causeTextOf(x.data) }); });
    const ph = r.phase_id ? db.case_phases.find(p => p.id === r.phase_id && p.org_id === r.org_id) : null;
    const res = ph && ph.result && Array.isArray(ph.result.rooms) ? ph.result.rooms : [];
    res.filter(b => b && String(b.cause || '').trim() && !rows.some(y => key(y.room) === key(b.room)))
      .forEach(b => rows.push({ room: String(b.room || '').trim(), cause: String(b.cause).trim() }));
    const roleOf = room => {
      if (!room) return null;
      const cr = db.case_rooms.filter(x => x.case_id === r.case_id && x.org_id === r.org_id && key(x.room) === key(room))
        .sort((a, b) => a.sort - b.sort || (a.created_at < b.created_at ? -1 : 1))[0];
      return cr ? cr.role : null;
    };
    return rows.sort((a, b) => (a.room === '' ? 1 : 0) - (b.room === '' ? 1 : 0) || (a.room < b.room ? -1 : a.room > b.room ? 1 : 0))
      .map(x => '・' + roomHead(x.room, roleOf(x.room)) + ': ' + (x.cause || '（原因の記入なし）')).join('\n');
  }

  // migration 034: 報告書の提出 → フェーズの done_at（空のときだけ）とタイムライン（トリガーの中の更新なので case_edits には記録しない）
  function reportPhaseDone(r) {
    if (!r.phase_id) return;
    const p = db.case_phases.find(x => x.id === r.phase_id && x.org_id === r.org_id);
    if (!p || p.done_at) return;
    p.done_at = r.submitted_at || nowIso();
    p.updated_at = nowIso();
    if (p.kind === 'site_check') return; // 083: 現地確認は done_at だけ（タイムラインは送った側）
    db.timeline_entries.push({ id: uuid(), org_id: p.org_id, case_id: p.case_id, type: 'system', attachments: [], audiences: [], resolved_at: null,
      body: phaseTitleOf(p.id) + (p.kind === 'survey' ? 'を実施済みにした' : 'を完了にした') + '（報告書の提出）', created_by: null, created_at: nowIso() }); // 082: 実施済み
  }

  // migration 021: case_summaries の末尾5列（元請マスタ・フェーズの配列・未送信の日程連絡/リマインド数）
  function phaseSummary(c) {
    const k = c.client_id ? db.clients.find(x => x.id === c.client_id && x.org_id === c.org_id) : null;
    const byCreated = (a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    const seqOf = {};
    const phases = db.case_phases.filter(p => p.case_id === c.id).sort(byCreated).map(p => {
      seqOf[p.kind] = (seqOf[p.kind] || 0) + 1;
      const mine = db.estimates.filter(e => e.phase_id === p.id);
      const estimates = Array.from(new Set(mine.map(e => e.series_id))).map(sid => {
        const vs = mine.filter(e => e.series_id === sid).sort((a, b) => b.version - a.version);
        const e = vs[0], sent = vs.find(x => x.sent_at) || null;
        return { id: e.id, series_id: e.series_id, version: e.version, status: e.status, total: e.total,
          accepted: e.status === 'accepted', sent_at: e.sent_at || null, accepted_at: e.accepted_at || null,
          sent_version: sent ? sent.version : null, sent_total: sent ? sent.total : null,
          issued_at: e.issued_at || null, created_by: e.created_by || null, // 053: 日報
          reedit_mark: !!e.reedit_mark, reedit_at: e.reedit_at || null, reedit_by_name: e.reedit_by_name || null, reedit_count: e.reedit_count || 0, // 057
          notes: e.data && e.data.notes !== undefined ? e.data.notes : null, // 066: 工事の条件
          line_texts: (Array.isArray(e.lines) ? e.lines : []).filter(l => l && typeof l === 'object')
            .map(l => [String(l.description || '').trim(), String(l.detail || '').trim()].filter(Boolean).join(' ').slice(0, 200)),
          _c: e.created_at, _id: e.id };
      }).sort((a, b) => byCreated({ created_at: a._c, id: a._id }, { created_at: b._c, id: b._id }))
        .map(({ _c, _id, ...rest }) => rest);
      const reports = db.reports.filter(r => r.phase_id === p.id).sort(byCreated)
        .map(r => ({ id: r.id, work_type: r.work_type, status: r.status, sent: r.status === 'sent', sent_at: r.sent_at || null,
          submitted_at: r.submitted_at || null, submitted_via: r.submitted_via || null, // 034・035
          submitted_by: r.submitted_by || null, // 045: 提出した人
          work_date: r.work_date || null, time_end: r.time_end || null, // 053: 報告書の期限
          reedit_mark: !!r.reedit_mark, reedit_at: r.reedit_at || null, reedit_by_name: r.reedit_by_name || null, reedit_count: r.reedit_count || 0, // 057
          share_active: db.report_shares.some(sh => sh.report_id === r.id && shareLive(sh)) }));
      const v = n => (n === undefined ? null : n);
      return { id: p.id, kind: p.kind, seq: seqOf[p.kind], label: v(p.label), source_phase_id: v(p.source_phase_id), // 058
        scheduled_at: v(p.scheduled_at), scheduled_end: v(p.scheduled_end),
        done_at: v(p.done_at), bill_to_type: p.bill_to_type || 'client', bill_to_name: v(p.bill_to_name),
        billing_mode: p.billing_mode || 'single', billing_month: v(p.billing_month), billed_at: v(p.billed_at),
        paid_at: v(p.paid_at), amount_override: v(p.amount_override), schedule_set_at: v(p.schedule_set_at),
        result: p.result && typeof p.result === 'object' ? p.result : {}, payment_due: v(p.payment_due),
        plan: p.plan && typeof p.plan === 'object' ? p.plan : {}, estimates, reports, // result: 023・payment_due: 024・plan: 025
        estimate_due: v(p.estimate_due), // 037
        // 026: 作業担当者
        worker_id: v(p.worker_id), worker_name: p.worker_id && memberOf(p.worker_id) ? memberOf(p.worker_id).display_name : null,
        notified_at: v(p.notified_at), notified_by_name: p.notified_by && memberOf(p.notified_by) ? memberOf(p.notified_by).display_name : null,
        ack_at: v(p.ack_at), ack_by_name: p.ack_by && memberOf(p.ack_by) ? memberOf(p.ack_by).display_name : null,
        // 052: 到着が遅れそうの報告
        late_at: v(p.late_at), late_by_name: p.late_by && memberOf(p.late_by) ? memberOf(p.late_by).display_name : null,
        nudged_at: v(p.nudged_at), nudge_count: Number(p.nudge_count) || 0, // 052: 催促
        // 053: 見積書提案期日の理由・提出できる日・報告書の期限超過の連絡・遅れを報告した人
        estimate_due_reason: v(p.estimate_due_reason), estimate_due_by: v(p.estimate_due_by), report_overdue_at: v(p.report_overdue_at), late_by: v(p.late_by),
        lost_at: v(p.lost_at), bill_requested_at: v(p.bill_requested_at), completed_at: v(p.completed_at), // 066・067
        open_call_at: v(p.open_call_at), open_call_by: v(p.open_call_by), // 070
        open_call_kind: v(p.open_call_kind), open_call_from: v(p.open_call_from), open_call_to: v(p.open_call_to), open_call_expired_at: v(p.open_call_expired_at), // 076
        schedule: (sc => (sc ? (({ org_id, ...rest }) => clone(rest))(sc) : null))(db.phase_schedules.find(x => x.phase_id === p.id)) }; // 069
    });
    const pending = purpose => db.mail_drafts.filter(d => d.case_id === c.id && d.status === 'draft' && !d.skipped_at && d.purpose === purpose).length;
    return {
      client_master_name: k ? k.name : null, client_billing_mode: k ? k.billing_mode : null, phases,
      schedule_drafts_to_send: pending('schedule'), reminder_drafts_to_send: pending('reminder'),
      // migration 022: 元請マスタの担当者名・メール・電話
      client_contact: k ? k.contact_name : null, client_master_email: k ? k.email : null, client_tel: k ? k.tel : null,
      rooms: roomsSummary(c) // migration 030: 関係する部屋
    };
  }

  // ---- migration 031: ゴミ箱と編集の記録 ----
  function trashCheck(next) {
    if (next.deleted_by != null && next.deleted_at == null) throw E.check('cases', 'cases_deleted_check');
    const trashed = next.deleted_at != null || next.deleted_by != null;
    if (trashed && !(myRole() === 'owner' && next.deleted_by === user.id)) throw E.rls('cases'); // cases_trash_update の with check
  }
  const EDIT_SKIP = {
    cases: ['deleted_at', 'deleted_by', 'request'], // 052: 依頼内容は記録しない
    case_phases: ['case_id', 'kind', 'label', 'source_phase_id', 'legacy_work_id', 'schedule_set_at', 'notified_at', 'notified_by', 'ack_at', 'ack_by', 'late_at', 'late_by', 'nudged_at', 'nudge_count',
      'estimate_due_reason', 'estimate_due_by', 'report_overdue_at'], // 053
    case_rooms: ['case_id']
  };
  let undoing = false;
  function logEdit(t, old, row) {
    if (!EDIT_SKIP[t] || undoing) return;
    const skip = ['id', 'org_id', 'created_by', 'created_at', 'updated_at'].concat(EDIT_SKIP[t]);
    const cols = [], before = {}, after = {};
    for (const k of Object.keys(row)) {
      if (skip.includes(k)) continue;
      const a = old[k] === undefined ? null : old[k], b = row[k] === undefined ? null : row[k];
      if (JSON.stringify(a) === JSON.stringify(b)) continue;
      cols.push(k); before[k] = clone(a); after[k] = clone(b);
    }
    if (!cols.length) return;
    const caseId = t === 'cases' ? row.id : row.case_id;
    db.case_edits.push({ id: uuid(), org_id: ORG_ID, case_id: caseId, table_name: t, row_id: row.id, before, after,
      changed_cols: cols, edited_by: user.id, edited_at: nowIso(), undone_at: null });
    const mine = db.case_edits.filter(e => e.case_id === caseId).sort((a, b) => (a.edited_at < b.edited_at ? 1 : -1));
    const drop = new Set(mine.slice(200).map(e => e.id));
    if (drop.size) db.case_edits = db.case_edits.filter(e => !drop.has(e.id));
  }
  // migration 042: 画面（API）からの更新で管理者だけが変えられる列（スタッフは 42501）
  const OWNER_COLS_PHASE = ['bill_to_type', 'bill_to_name', 'billing_mode', 'billing_month', 'billed_at', 'paid_at', 'amount_override', 'payment_due', 'done_at'];
  const same = (a, b) => JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b);
  const OWNER_GUARD = {
    case_phases(next, old) {
      // migration 071: 作業担当者は管理者か、現場用で自分が登録した案件の本人だけ（募集中は rpc phase_open_call_accept）
      if (!same(next.worker_id, old.worker_id) && !fieldRegistered(db.cases.find(c => c.id === old.case_id) || {})) {
        throw pgErr('作業担当者を変えられるのは、管理者と、現場用でこの案件を登録した人だけです', '42501');
      }
      if (OWNER_COLS_PHASE.some(k => !same(next[k], old[k]))) throw pgErr('請求・入金・完了の記録は管理者だけが変えられます', '42501');
    },
    estimates(next, old) {
      if ((next.status !== old.status && ['sent', 'accepted'].includes(next.status)) || !same(next.sent_at, old.sent_at) || !same(next.accepted_at, old.accepted_at)) {
        throw pgErr('見積書の送付・承諾の記録は管理者だけが付けられます', '42501');
      }
    },
    reports(next, old) {
      if ((next.status !== old.status && ['confirmed', 'sent'].includes(next.status)) || !same(next.confirmed_at, old.confirmed_at)
        || !same(next.confirmed_by, old.confirmed_by) || !same(next.sent_at, old.sent_at)) {
        throw pgErr('報告書の確認・送付の記録は管理者だけが付けられます', '42501');
      }
    }
  };

  // undo_case_edit(p_edit_id, p_label): SECURITY DEFINER（列 grant・RLS を通さない）。042: 管理者だけ
  function undoCaseEdit(args) {
    if (myRole() !== 'owner') throw pgErr('「1つ前に戻す」は管理者だけが使えます', '42501');
    const e = db.case_edits.find(x => x.id === (args && args.p_edit_id) && x.org_id === ORG_ID);
    if (!e) throw pgErr('編集の記録が見つかりません', 'P0002');
    if (e.undone_at) return { ok: false, reason: 'undone' };
    const c = caseOf(e.case_id);
    if (!c) return { ok: false, reason: 'gone' };
    if (c.deleted_at) return { ok: false, reason: 'deleted' };
    const row = (db[e.table_name] || []).find(r => r.id === e.row_id);
    if (!row) return { ok: false, reason: 'gone' };
    for (const k of e.changed_cols) {
      const cur = row[k] === undefined ? null : row[k];
      if (JSON.stringify(cur) !== JSON.stringify(e.after[k] === undefined ? null : e.after[k])) return { ok: false, reason: 'conflict' };
    }
    const next = { ...row, ...clone(e.before) };
    const def = T[e.table_name] || {};
    try { if (def.validateUpdate) def.validateUpdate(next, row); }
    catch (err) { if (err && err.code && /^23/.test(err.code)) return { ok: false, reason: 'invalid' }; throw err; }
    const old = { ...row };
    undoing = true;
    try {
      Object.assign(row, next);
      if (def.touch) row.updated_at = nowIso();
      if (def.afterUpdate) def.afterUpdate(row, old);
    } finally { undoing = false; }
    e.undone_at = nowIso();
    const label = String((args && args.p_label) || '').trim().slice(0, 200)
      || ({ cases: '案件', case_phases: 'フェーズ' }[e.table_name] || '関係する部屋') + 'の ' + e.changed_cols.join('・');
    db.timeline_entries.push({ id: uuid(), org_id: ORG_ID, case_id: e.case_id, type: 'system', body: '編集を取り消した（' + label + '）',
      attachments: [], audiences: [], resolved_at: null, created_by: user.id, created_at: nowIso() });
    return { ok: true, table_name: e.table_name, row_id: e.row_id, case_id: e.case_id, changed_cols: e.changed_cols.slice(),
      before: clone(e.before), after: clone(e.after) };
  }

  // ---- case_summaries ビュー（保持データから計算。staff_unread は現在ユーザー基準） ----
  function summaries() {
    return db.cases.filter(c => !c.deleted_at && caseVisible(c.id)).map(c => { // migration 031: 削除した案件は出さない・079: 見える案件だけ
      const am = c.assignee_id ? memberOf(c.assignee_id) : null;
      return {
        ...c,
        assignee_name: am ? am.display_name : null,
        // migration 043: 旧い次やること・対応履歴の列（next_*・open_us_actions・my_open_actions・unsettled_works）は外した
        open_requests: db.timeline_entries.filter(t => t.case_id === c.id && t.type === 'request' && !t.resolved_at).length,
        timeline_count: db.timeline_entries.filter(t => t.case_id === c.id).length,
        report_count: db.reports.filter(r => r.case_id === c.id).length,
        // migration 043: 確認待ちは協力業者URLから提出されたものだけ
        reports_to_confirm: db.reports.filter(r => r.case_id === c.id && r.status === 'submitted' && r.submitted_via === 'share').length,
        drafts_to_send: db.mail_drafts.filter(d => d.case_id === c.id && d.status === 'draft').length,
        notice_count: db.notices.filter(n => n.case_id === c.id).length,
        // migration 014/015: 系列の数・最新（superseded 以外で updated_at, created_at, version の降順の先頭）の合計
        estimate_count: new Set(db.estimates.filter(e => e.case_id === c.id).map(e => e.series_id)).size,
        latest_estimate_total: (() => {
          const es = db.estimates.filter(e => e.case_id === c.id && e.status !== 'superseded').sort((a, b) =>
            (a.updated_at < b.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : 0)
            || (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0) || (b.version - a.version));
          return es.length ? es[0].total : null;
        })(),
        // migration 021
        ...phaseSummary(c),
        // migration 041: 見ている人あての未読の連絡
        staff_unread: db.staff_messages.filter(m => m.case_id === c.id && msgForMe(m)).length
      };
    });
  }

  // ---- select 列指定 ----
  function splitTop(s) {
    const out = []; let depth = 0, cur = '';
    for (const ch of s) {
      if (ch === '(') depth++;
      if (ch === ')') depth--;
      if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  }
  const clone = v => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
  // 埋め込める関係（多対一）: 親テーブル名 -> 行から親行を引く。アプリが使うのは次の2つだけ
  const RELATIONS = {
    memberships: { orgs: row => db.orgs.find(o => o.id === row.org_id) },
    case_actions: { cases: row => caseOf(row.case_id) }
  };
  // select 文字列に含まれる埋め込み: [{ name, inner, cols }]
  function embedsOf(cols) {
    const out = [];
    for (const c of splitTop(cols || '*')) {
      const m = c.match(/^(\w+)(!inner)?\((.*)\)$/);
      if (m) out.push({ name: m[1], inner: !!m[2], cols: m[3] });
    }
    return out;
  }
  function project(row, cols, table) {
    if (!cols || cols === '*') return clone(row);
    const out = {};
    for (const c of splitTop(cols)) {
      if (c === '*') { Object.assign(out, clone(row)); continue; }
      const m = c.match(/^(\w+)(!inner)?\((.*)\)$/);
      if (m) { // 埋め込み
        const rel = table && RELATIONS[table] && RELATIONS[table][m[1]];
        if (!rel) throw pgErr(`Could not find a relationship between '${table}' and '${m[1]}' in the schema cache`, 'PGRST200');
        const parent = rel(row);
        out[m[1]] = parent ? project(parent, m[3], null) : null;
        continue;
      }
      if (!(c in row)) {
        // 053 で足した列（daily_date）: テストが直接入れた古い形の行は空とみなす
        if (table === 'staff_messages' && c === 'daily_date') { out[c] = null; continue; }
        if (table === 'staff_messages' && c === 'as_client') { out[c] = false; continue; } // 065: rpc やテストが入れた古い形の行は「元請からでない」
        if (table === 'staff_messages' && c === 'meta') { out[c] = null; continue; } // 069: 日程調整のカード以外は空
        if (table === 'memberships' && c === 'survey_end_mins') { out[c] = 120; continue; } // 086: テストが直接足したメンバーは既定（120分）
        if (table === 'orgs' && c === 'routes_api_key') { out[c] = null; continue; } // 086: 古い形の行はキーなし
        throw pgErr(`column ${c} does not exist`, '42703');
      }
      out[c] = clone(row[c]);
    }
    return out;
  }

  // ---- クエリビルダ ----
  class Query {
    constructor(table) {
      this.table = table; this.op = 'select'; this.cols = '*'; this.retCols = null;
      this.filters = []; this.relFilters = []; this.orders = []; this.payload = null; this.mode = null;
    }
    select(cols) { if (this.op === 'select') this.cols = cols || '*'; else this.retCols = cols || '*'; return this; }
    insert(p) { this.op = 'insert'; this.payload = p; return this; }
    update(p) { this.op = 'update'; this.payload = p; return this; }
    delete() { this.op = 'delete'; return this; }
    eq(col, val) {
      const dot = col.indexOf('.');
      if (dot > 0) { // 埋め込み先の列での絞り込み（例: 'cases.status'）。select に同じ埋め込みが必要
        const relName = col.slice(0, dot), sub = col.slice(dot + 1);
        this.relFilters.push(relName);
        this.filters.push(r => {
          const rel = RELATIONS[this.table] && RELATIONS[this.table][relName];
          const parent = rel ? rel(r) : null;
          return !!parent && parent[sub] === val;
        });
        return this;
      }
      this.filters.push(r => r[col] === val); return this;
    }
    in(col, vals) { this.filters.push(r => vals.includes(r[col])); return this; }
    gte(col, val) { this.filters.push(r => r[col] != null && String(r[col]) >= String(val)); return this; } // ISO の文字列どうし（Task 32 日報）
    is(col, val) {
      if (val !== null) throw new Error('fake-sb: is() は null のみ対応');
      this.filters.push(r => r[col] === null || r[col] === undefined); return this;
    }
    not(col, op, val) {
      if (op !== 'is' || val !== null) throw new Error('fake-sb: not() は (col, \'is\', null) のみ対応');
      this.filters.push(r => r[col] !== null && r[col] !== undefined); return this;
    }
    limit(n) { this.lim = n; return this; }
    order(col, o = {}) {
      const asc = o.ascending !== false;
      // Postgres 既定: 昇順は NULL が最後、降順は NULL が最初
      const nullsFirst = o.nullsFirst === undefined ? !asc : !!o.nullsFirst;
      this.orders.push({ col, asc, nullsFirst }); return this;
    }
    single() { this.mode = 'single'; return this; }
    maybeSingle() { this.mode = 'maybe'; return this; }
    then(res, rej) { return this.run().then(res, rej); }

    async run() {
      // ネットワークの非同期性を真似る。テスト用: window.__fake.delay = { case_phases: 1500 } でその表の応答を遅らせる（保存中の入力の確認）
      const slow = window.__fake.delay && Number(window.__fake.delay[this.table]) || 0;
      await new Promise(r => setTimeout(r, 2 + slow));
      window.__fake.calls.push(`${this.op} ${this.table}`);
      try {
        const rows = this.exec();
        return this.finish(rows);
      } catch (e) {
        if (e && e.message !== undefined && !(e instanceof Error)) return { data: null, error: e };
        throw e; // fake 自体のバグは握りつぶさない
      }
    }

    finish(rows) {
      if (this.mode === 'single') {
        if (rows.length !== 1) return { data: null, error: E.single(rows.length) };
        return { data: rows[0], error: null };
      }
      if (this.mode === 'maybe') {
        if (rows.length > 1) return { data: null, error: E.single(rows.length) };
        return { data: rows[0] || null, error: null };
      }
      return { data: rows, error: null };
    }

    sorted(rows) {
      if (this.orders.length === 0) return rows;
      return rows.slice().sort((a, b) => {
        for (const o of this.orders) {
          const x = a[o.col], y = b[o.col];
          const xn = x === null || x === undefined, yn = y === null || y === undefined;
          if (xn && yn) continue;
          if (xn) return o.nullsFirst ? -1 : 1;
          if (yn) return o.nullsFirst ? 1 : -1;
          if (x === y) continue;
          return (x < y ? -1 : 1) * (o.asc ? 1 : -1);
        }
        return 0;
      });
    }

    exec() {
      const t = this.table;
      const isView = t === 'case_summaries';
      if (!isView && !db[t]) throw pgErr(`relation "public.${t}" does not exist`, '42P01');
      if (!signedIn) throw pgErr('permission denied', '42501');
      const def = T[t] || {};
      const base = isView ? summaries() : (def.canSelect ? db[t].filter(def.canSelect) : db[t]).filter(r => rowVisible(t, r)); // 065: 行の RLS（staff_messages・talk_reads）・079/080: 見える案件だけ
      const match = () => base.filter(r => this.filters.every(f => f(r)));

      if (this.op === 'select') {
        const embeds = embedsOf(this.cols);
        for (const rf of this.relFilters) {
          if (!embeds.some(e => e.name === rf)) {
            throw pgErr(`Could not find a relationship between '${t}' and '${rf}' in the schema cache`, 'PGRST200');
          }
        }
        let rows = match();
        // !inner の埋め込み: 親が無い行は外す（親の列で絞った場合も親が無い行は上の filters で外れている）
        for (const e of embeds.filter(x => x.inner)) {
          const rel = RELATIONS[t] && RELATIONS[t][e.name];
          rows = rows.filter(r => rel && rel(r));
        }
        let sortedRows = this.orders.length ? this.sorted(rows) : rows;
        if (this.lim != null) sortedRows = sortedRows.slice(0, this.lim);
        return sortedRows.map(r => project(r, this.cols, t));
      }
      if (isView) throw E.denied(t);

      if (this.op === 'insert') {
        if (def.insert === false || !def.insert) throw E.rls(t);
        // テスト用: window.__fake.failInsert = { mail_drafts: true } でその表への insert を失敗させる
        if (window.__fake.failInsert && window.__fake.failInsert[t]) throw pgErr('fake-sb: insert failed (' + t + ')', 'XX000');
        const list = Array.isArray(this.payload) ? this.payload : [this.payload];
        list.forEach(p => window.__fake.writes.push({ op: 'insert', table: t, keys: Object.keys(p) }));
        const made = list.map(p => def.insert(p));
        // 079・080: 見えない案件の行は入れられない（insert の with check）。cases の新しい行は管理者だけ（まだ表に無いので is_owner で通す）
        if (made.some(r => (t === 'cases' ? myRole() !== 'owner' : !rowVisible(t, r)))) throw E.rls(t);
        made.forEach(r => { db[t].push(r); if (def.afterInsert) def.afterInsert(r); });
        return this.retCols ? made.map(r => project(r, this.retCols, t)) : [];
      }

      if (this.op === 'update') {
        // テスト用: window.__fake.failUpdate = { reports: true } でその表への update を失敗させる
        if (window.__fake.failUpdate && window.__fake.failUpdate[t]) throw pgErr('fake-sb: update failed (' + t + ')', 'XX000');
        if (def.update === false) throw E.rls(t);
        const allowed = UPDATE_COLS[t];
        const keys = Object.keys(this.payload || {});
        window.__fake.writes.push({ op: 'update', table: t, keys });
        if (allowed && keys.some(k => !allowed.includes(k))) throw E.denied(t);
        if (t === 'orgs' && myRole() !== 'owner') return []; // orgs_update: owner のみ（0行更新）
        let hit = match();
        if (def.canUpdate) hit = hit.filter(def.canUpdate); // RLS（update の using）で見えない行は 0 行
        if (t === 'cases' && myRole() !== 'owner') hit = hit.filter(r => !r.deleted_at); // 031: 削除済みは管理者しか変えられない（0行）
        hit.forEach(r => {
          const next = { ...r, ...clone(this.payload) };
          if (t === 'cases') trashCheck(next);
          if (OWNER_GUARD[t] && myRole() !== 'owner') OWNER_GUARD[t](next, r); // migration 042
          if (def.validateUpdate) def.validateUpdate(next, r);
          const old = { ...r };
          Object.assign(r, next);
          if (def.touch) r.updated_at = nowIso();
          if (def.afterUpdate) def.afterUpdate(r, old);
          logEdit(t, old, r); // 031: 編集の記録（BEFORE UPDATE トリガー相当。最後に動く）
        });
        return this.retCols ? hit.map(r => project(r, this.retCols, t)) : [];
      }

      if (this.op === 'delete') {
        if (def.del === false) throw E.denied(t);
        if (!def.del) return [];
        let hit = match();
        if (def.canDelete) hit = hit.filter(def.canDelete); // RLS で見えない行は0件扱い
        if (def.beforeDelete) hit.forEach(r => def.beforeDelete(r)); // 削除トリガー（拒否は P0001）
        db[t] = db[t].filter(r => !hit.includes(r));
        // migration 009: report_shares は報告書の削除で一緒に消える（FK on delete cascade）
        if (t === 'reports' && hit.length) db.report_shares = db.report_shares.filter(sh => !hit.some(r => r.id === sh.report_id));
        if (def.afterDelete) hit.forEach(r => def.afterDelete(r)); // 削除の後のトリガー（054）
        return this.retCols ? hit.map(r => project(r, this.retCols, t)) : [];
      }
      throw new Error('fake-sb: 未対応の操作 ' + this.op);
    }
  }

  // ---- 協力業者用の関数（security definer。anon / authenticated どちらからも呼べる） ----
  async function shareHash(t) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(t == null ? '' : t)));
    return Array.from(new Uint8Array(buf), x => x.toString(16).padStart(2, '0')).join('');
  }
  const shareLive = sh => !sh.revoked_at && !sh.submitted_at && (sh.expires_at == null || Date.parse(sh.expires_at) > Date.now());
  async function findShare(token) {
    const h = await shareHash(token);
    return db.report_shares.find(x => (x.token != null ? x.token === String(token) : x.token_hash === h) && shareLive(x)) || null;
  }
  const sharePrefix = (o, c, r, sh) => `${o.id}/cases/${c.id}/reports/${r.id}/share-${sh.id}/`;
  async function shareOpen(args) {
    const sh = await findShare(args.p_token);
    if (!sh) throw P0001('このURLは無効か期限切れです');
    const r = db.reports.find(x => x.id === sh.report_id);
    if (r.status !== 'draft') throw P0001('この報告書はすでに提出されています');
    const c = caseOf(r.case_id), o = db.orgs.find(x => x.id === r.org_id);
    return {
      share_id: sh.id, vendor_name: sh.vendor_name, expires_at: sh.expires_at,
      report: clone({ id: r.id, work_type: r.work_type, room: r.room, work_date: r.work_date,
        time_start: r.time_start, time_end: r.time_end, data: r.data,
        // 057: 再編集で戻した報告書の写真（パス・名前・キャプション・区分・印）と回数
        photos: (r.photos || []).filter(x => x && typeof x.path === 'string').map(x => Object.assign({ path: x.path, name: x.name || '', caption: x.caption || '', phase: x.phase || '' },
          x.phaseNote ? { phaseNote: x.phaseNote } : {}, Array.isArray(x.marks) ? { marks: x.marks } : {})),
        reedit_count: r.reedit_count || 0 }),
      case: { id: c.id, name: c.name, address: c.address, room: c.room },
      org: { id: o.id, name: o.name },
      ...shareOpen052(r, c),
      // migration 045: フェーズの指示で「被害箇所の写真撮影」を選んだ号室（号室と役割だけ）
      photo_rooms: (() => {
        const ph = r.phase_id ? db.case_phases.find(x => x.id === r.phase_id) : null;
        const rooms = ph && ph.plan && Array.isArray(ph.plan.rooms) ? ph.plan.rooms : [];
        return rooms.filter(x => x && typeof x === 'object' && Array.isArray(x.tasks) && x.tasks.includes('photo'))
          .map(x => ({ room: typeof x.room === 'string' ? x.room : '', role: typeof x.role === 'string' ? x.role : '' }));
      })(),
      upload_prefix: sharePrefix(o, c, r, sh)
    };
  }
  // migration 052: 依頼内容・現場への指示・到着が遅れそう（入居者の電話は報告の後だけ）
  function shareOpen052(r, c) {
    const ph = r.phase_id ? db.case_phases.find(x => x.id === r.phase_id && x.org_id === r.org_id) : null;
    const q = c.request && typeof c.request === 'object' ? c.request : {};
    return clone({
      phase: ph ? { kind: ph.kind, scheduled_at: ph.scheduled_at || null, scheduled_end: ph.scheduled_end || null } : null,
      brief: ph && ph.plan && typeof ph.plan === 'object' ? ph.plan : {},
      request: { text: q.text || '', symptoms: Array.isArray(q.symptoms) ? q.symptoms : [], symptomOther: q.symptomOther || '',
        damage: q.damage || '', suspect: q.suspect || '', items: Array.isArray(q.items) ? q.items : [], // 084
        photos: (Array.isArray(q.photos) ? q.photos : []).filter(x => x && typeof x === 'object').map(x => ({ path: x.path, caption: x.caption || '' })) },
      late_ok: !!ph, late_at: ph ? ph.late_at || null : null,
      residents: ph && ph.late_at ? caseResidents(c) : []
    });
  }
  function caseResidents(c) {
    const t = v => String(v == null ? '' : v).trim();
    const out = [];
    if (t(c.resident_name) || t(c.resident_tel)) out.push({ room: t(c.room), role: 'damage', own: true, name: t(c.resident_name), tel: t(c.resident_tel) });
    db.case_rooms.filter(x => x.case_id === c.id).sort((a, b) => (a.sort || 0) - (b.sort || 0) || (a.created_at < b.created_at ? -1 : 1))
      .forEach(x => { if (t(x.resident_name) || t(x.tel)) out.push({ room: t(x.room), role: x.role, own: false, name: t(x.resident_name), tel: t(x.tel) }); });
    return out;
  }
  const lateLabel = m => '約' + (m < 60 ? m + '分' : m % 60 === 0 ? (m / 60) + '時間' : Math.floor(m / 60) + '時間' + (m % 60) + '分');
  // migration 052 の _phase_late と同じ
  // migration 059: admin_create_case（管理者だけ・送れるのは画面の CASE_COLS だけ・無料は保存件数3件まで）→ 作った cases の行
  //   window.__fake.calls に 'rpc admin_create_case'、window.__fake.writes に { op: 'rpc', table: 'admin_create_case', keys } が残る
  const ADMIN_CASE_COLS = ['name', 'address', 'client_name', 'client_email', 'assignee_id', 'due_date', 'status',
    'client_id', 'owner_name', 'owner_email', 'owner_tel', 'resident_name', 'resident_email', 'resident_tel', 'room'];
  function adminCreateCase(p) {
    const m = memberOf(user.id);
    if (!m || m.role !== 'owner') throw pgErr('案件の作成は管理者だけです', '42501');
    if (!p || typeof p !== 'object' || Array.isArray(p)) throw P0001('案件の内容がありません');
    window.__fake.writes.push({ op: 'rpc', table: 'admin_create_case', keys: Object.keys(p) });
    const bad = Object.keys(p).find(k => !ADMIN_CASE_COLS.includes(k));
    if (bad) throw pgErr('入れられない項目です: ' + bad, '42501');
    const org = db.orgs.find(o => o.id === ORG_ID) || {};
    const u = db.org_usage[0];
    if ((org.plan || 'free') === 'free' && u.record_count + 1 > 3) throw Object.assign(P0001('保存件数の上限（3件）に達しています'), { hint: 'quota' });
    const row = { id: uuid(), org_id: ORG_ID, address: null, client_name: null, client_email: null,
      assignee_id: null, due_date: null, created_at: nowIso(), updated_at: nowIso(), ...PARTY_NULL, ...p,
      status: p.status || 'open', created_by: user.id };
    caseChecks(row);
    db.cases.push(row);
    u.record_count += 1;
    return row;
  }

  // migration 058: field_create_case（案件＋フェーズ1つ＋依頼内容。作業担当者 = 呼んだ人。保存件数の上限。管理者あての自動の連絡・タイムライン）
  //   window.__fake.calls に 'rpc field_create_case' が残る。org の plan が free なら 3件まで（js/quota.js と同じ）
  function fieldCreateCase(a) {
    const t = v => String(v == null ? '' : v).trim();
    const len = v => Array.from(v).length;
    const name = t(a.p_name), room = t(a.p_room), addr = t(a.p_address), res = t(a.p_resident_name), contact = t(a.p_contact);
    const kind = String(a.p_kind || ''), req = t(a.p_request);
    let label = t(a.p_label) || null;
    if (!name) throw P0001('物件名を入れてください');
    if (len(name) > 100) throw P0001('物件名は100文字までです');
    if (!room) throw P0001('号室を入れてください');
    if (len(room) > 40) throw P0001('号室は40文字までです');
    if (!addr) throw P0001('住所を入れてください');
    if (len(addr) > 200) throw P0001('住所は200文字までです');
    if (!res) throw P0001('入居者の名前を入れてください');
    if (len(res) > 100) throw P0001('入居者の名前は100文字までです');
    let tel = null, email = null;
    if (contact.includes('@')) {
      if (contact.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contact)) throw P0001('連絡先のメールアドレスの形が正しくありません');
      email = contact;
    } else if (contact) {
      if (len(contact) > 40) throw P0001('連絡先（電話番号）は40文字までです');
      tel = contact;
    }
    if (a.p_scheduled_at != null && Number.isNaN(Date.parse(a.p_scheduled_at))) throw P0001('訪問日時を入れてください'); // 076: 日時なし（一斉配信の範囲）も受ける
    if (!['site_check', 'survey', 'cause', 'repair', 'other'].includes(kind)) throw P0001('フェーズを選んでください'); // 083
    if (kind === 'other') {
      if (!label) throw P0001('「その他」の名前を入れてください（例: 点検・清掃）');
      if (len(label) > 40) throw P0001('「その他」の名前は40文字までです');
    } else label = null;
    if (len(req) > 2000) throw P0001('依頼内容詳細は2000文字までです');
    // 084: 調査依頼項目（調査・現地確認のときだけ。形は cases_request_check）
    const items = ['survey', 'site_check'].includes(kind) && Array.isArray(a.p_items) && a.p_items.length ? a.p_items : null;
    const org = db.orgs.find(o => o.id === ORG_ID) || {};
    const u = db.org_usage[0];
    if ((org.plan || 'free') === 'free' && u.record_count + 1 > 3) throw Object.assign(P0001('保存件数の上限（3件）に達しています。管理者にご相談ください'), { hint: 'quota' });
    const at = a.p_scheduled_at == null ? null : new Date(Date.parse(a.p_scheduled_at)).toISOString();
    if (at) noDouble({ id: null, worker_id: user.id, scheduled_at: at, scheduled_end: null }, null); // 072
    const c = { id: uuid(), org_id: ORG_ID, address: addr, client_name: null, client_email: null, assignee_id: null, due_date: null, status: 'open',
      created_by: user.id, created_at: nowIso(), updated_at: nowIso(), ...PARTY_NULL, name, room, resident_name: res, resident_tel: tel, resident_email: email,
      request: Object.assign(req ? { text: req } : {}, items ? { items } : {}) };
    if (!caseRequestOk(c.request, c.org_id, c.id)) throw E.check('cases', 'cases_request_check'); // 084
    db.cases.push(c);
    u.record_count += 1;
    const p = { id: uuid(), org_id: ORG_ID, case_id: c.id, kind, label, scheduled_at: at, scheduled_end: null, done_at: null, bill_to_type: 'client',
      bill_to_name: null, billing_mode: 'single', billing_month: null, billed_at: null, paid_at: null, amount_override: null, note: null,
      legacy_work_id: null, created_by: user.id, created_at: nowIso(), updated_at: nowIso(), result: {}, payment_due: null, plan: {},
      worker_id: user.id, notified_at: null, notified_by: null, ack_at: null, ack_by: null, estimate_due: null, source_phase_id: null, schedule_set_at: at ? nowIso() : null,
      open_call_at: null, open_call_by: null, open_call_kind: null, open_call_from: null, open_call_to: null, open_call_expired_at: null }; // 076
    db.case_phases.push(p);
    const title = phaseTitleOf(p.id);
    const who = (memberOf(user.id) && String(memberOf(user.id).display_name || '').trim()) || '作業担当者';
    const j = at ? new Date(Date.parse(at) + 9 * 3600000) : null;
    const when = j ? (j.getUTCMonth() + 1) + '/' + j.getUTCDate() + ' ' + pad(j.getUTCHours()) + ':' + pad(j.getUTCMinutes()) : '日時未定'; // 076
    const roomHead = /[0-9０-９A-Za-zＡ-Ｚａ-ｚ]$/.test(room) ? room + '号室' : room;
    const body = ['案件: ' + name + ' ' + roomHead, '住所: ' + addr, '入居者: ' + res + (contact ? '（' + contact + '）' : ''),
      '対応: ' + title + '（訪問 ' + when + '）'].concat(req ? ['依頼内容: ' + req] : [])
      .concat(['登録: ' + who + '（現場用）', '依頼元（元請など）はまだ入っていません。案件ページで入れてください。']).join('\n');
    db.staff_messages.push({ id: uuid(), org_id: ORG_ID, case_id: c.id, phase_id: p.id, from_user: user.id, to_user: null,
      subject: (who + 'が案件を登録した').slice(0, 100), body: body.slice(0, 4000), attachments: [], read_at: null, reply_to: null, created_at: nowIso(), source: 'case_create' });
    db.timeline_entries.push({ id: uuid(), org_id: ORG_ID, case_id: c.id, type: 'system', attachments: [], audiences: [], resolved_at: null,
      body: (who + 'が案件を登録した（現場用・' + title + ' 訪問 ' + when + '）').slice(0, 2000), created_by: null, created_at: nowIso() });
    return { ok: true, case_id: c.id, phase_id: p.id };
  }
  // migration 062: field_trash_case（現場用で自分が登録した案件だけ。ゴミ箱・管理者あての連絡・タイムライン）
  function fieldTrashCase(id) {
    const c = db.cases.find(x => x.id === id && x.org_id === ORG_ID);
    if (!c) throw P0001('案件が見つかりません');
    if (c.deleted_at) throw P0001('この案件はすでに削除されています');
    if (c.created_by !== user.id || !db.staff_messages.some(m => m.case_id === c.id && m.source === 'case_create')) {
      throw pgErr('削除できるのは、現場用で自分が登録した案件だけです', '42501');
    }
    c.deleted_at = nowIso();
    c.deleted_by = user.id;
    const who = (memberOf(user.id) && String(memberOf(user.id).display_name || '').trim()) || '作業担当者';
    const room = String(c.room || '').trim();
    const roomHead = !room ? '号室未設定' : /[0-9０-９A-Za-zＡ-Ｚａ-ｚ]$/.test(room) ? room + '号室' : room;
    db.staff_messages.push({ id: uuid(), org_id: ORG_ID, case_id: c.id, phase_id: null, from_user: user.id, to_user: null,
      subject: (who + 'が案件を削除した').slice(0, 100),
      body: ['案件: ' + [c.name, roomHead].filter(Boolean).join(' '), '削除: ' + who + '（現場用）', '30日以内なら 設定 → 削除した案件 から戻せます。'].join('\n'),
      attachments: [], read_at: null, reply_to: null, created_at: nowIso(), source: 'case_delete' });
    db.timeline_entries.push({ id: uuid(), org_id: ORG_ID, case_id: c.id, type: 'system', attachments: [], audiences: [], resolved_at: null,
      body: who + 'が案件を削除した（現場用）', created_by: null, created_at: nowIso() });
    return { ok: true, case_id: c.id };
  }
  // migration 063: タスクの削除・差し戻し
  const TASK_JA = { report: '報告書作成', estimate: '見積書作成', notice: '確認依頼', tomorrow: '翌日の予定' };
  function taskPhase(phaseId, task) {
    if (!TASK_JA[task]) throw P0001('タスクの種類が違います');
    const p = db.case_phases.find(x => x.id === phaseId && x.org_id === ORG_ID);
    if (!p) throw P0001('この対応が見つかりません');
    const c = caseOf(p.case_id);
    if (!c || c.deleted_at) throw P0001('この案件は削除されています');
    if (p.worker_id !== user.id) throw pgErr('この対応の作業担当者ではありません', '42501');
    return { p, c, who: (memberOf(user.id) && String(memberOf(user.id).display_name || '').trim()) || '作業担当者',
      place: [String(c.name || '').trim(), String(c.room || '').trim() ? (/[0-9０-９A-Za-zＡ-Ｚａ-ｚ]$/.test(String(c.room).trim()) ? String(c.room).trim() + '号室' : String(c.room).trim()) : ''].filter(Boolean).join(' ') };
  }
  const fieldRegistered = c => c.created_by === user.id && db.staff_messages.some(m => m.case_id === c.id && m.source === 'case_create');
  const openFlag = (phaseId, task, action) => db.phase_task_flags.find(f => f.phase_id === phaseId && f.task === task && f.action === action && !f.closed_at);
  // migration 066（Task 47）: 段階を手で直す
  const STAGE_JA = { lost: '失注', active: '失注を取り消し', wait: '対応待ち', done: '対応済み', complete: '完了', bill_requested: '請求依頼中', billed: '請求済み', paid: '入金済み' };
  function phaseSetStage(a) {
    const label = STAGE_JA[a.p_stage];
    if (!label) throw P0001('段階の指定が正しくありません');
    const p = db.case_phases.find(x => x.id === a.p_phase && x.org_id === ORG_ID);
    if (!p) throw P0001('この対応が見つかりません');
    const c = caseOf(p.case_id);
    if (!c || c.deleted_at) throw P0001('この案件は削除されています');
    if (!(myRole() === 'owner' || fieldRegistered(c))) throw pgErr('段階を直せるのは、管理者と、現場用でこの案件を登録した人だけです', '42501');
    if (a.p_stage === 'lost' && p.lost_at) throw P0001('すでに失注です');
    if (a.p_stage === 'active' && !p.lost_at) throw P0001('失注ではありません');
    const at = nowIso(), k = a.p_stage;
    if (k === 'lost') p.lost_at = at;
    else if (k === 'active') p.lost_at = null;
    else {
      const bill = k === 'billed' || k === 'paid';
      Object.assign(p, { lost_at: null, done_at: k === 'wait' ? null : p.done_at || at,
        completed_at: k === 'complete' ? p.completed_at || at : k === 'wait' ? null : p.completed_at || null, // 067
        bill_requested_at: k === 'bill_requested' ? p.bill_requested_at || at : bill ? p.bill_requested_at || null : null,
        billed_at: bill ? p.billed_at || at : null, paid_at: k === 'paid' ? p.paid_at || at : null, payment_due: bill ? p.payment_due || null : null });
    }
    p.updated_at = at;
    const who = (memberOf(user.id) || {}).display_name || '不明', title = phaseTitleOf(p.id);
    const room = String(c.room || '').trim();
    const place = [String(c.name || '').trim(), room ? (/[0-9０-９A-Za-zＡ-Ｚａ-ｚ]$/.test(room) ? room + '号室' : room) : ''].filter(Boolean).join(' ');
    db.staff_messages.push({ id: uuid(), org_id: ORG_ID, case_id: c.id, phase_id: p.id, from_user: user.id, to_user: null,
      subject: (title + 'を「' + label + '」にした').slice(0, 100), body: '案件: ' + place + '\n対応: ' + title + '\n段階: ' + label + '（' + who + 'が変更）',
      attachments: [], read_at: at, reply_to: null, created_at: at, source: 'stage' });
    db.timeline_entries.push({ id: uuid(), org_id: ORG_ID, case_id: c.id, type: 'system', attachments: [], audiences: [], resolved_at: null,
      body: title + 'の段階を「' + label + '」にした（' + who + '）', created_by: null, created_at: at });
    return { ok: true, stage: k, label, at };
  }
  // migration 067（Task 48）: 入金予定日を入れる（まだなら請求済みにする）
  function phaseSetPaymentDue(a) {
    const p = db.case_phases.find(x => x.id === a.p_phase && x.org_id === ORG_ID);
    if (!p) throw P0001('この対応が見つかりません');
    const c = caseOf(p.case_id);
    if (!c || c.deleted_at) throw P0001('この案件は削除されています');
    if (!(myRole() === 'owner' || fieldRegistered(c))) throw pgErr('入金予定日を入れられるのは、管理者と、現場用でこの案件を登録した人だけです', '42501');
    if (!a.p_due || !/^\d{4}-\d{2}-\d{2}$/.test(a.p_due)) throw P0001('入金予定日を入れてください');
    if (p.lost_at) throw P0001('この対応は失注です');
    if (p.paid_at) throw P0001('すでに入金済みです');
    const at = nowIso();
    Object.assign(p, { done_at: p.done_at || at, billed_at: p.billed_at || at, payment_due: a.p_due, updated_at: at });
    const md = Number(a.p_due.slice(5, 7)) + '/' + Number(a.p_due.slice(8, 10)), label = md + '入金予定';
    const who = (memberOf(user.id) || {}).display_name || '不明', title = phaseTitleOf(p.id);
    db.staff_messages.push({ id: uuid(), org_id: ORG_ID, case_id: c.id, phase_id: p.id, from_user: user.id, to_user: null,
      subject: (title + 'を「' + label + '」にした').slice(0, 100), body: '対応: ' + title + '\n段階: ' + label + '（' + who + 'が変更）',
      attachments: [], read_at: at, reply_to: null, created_at: at, source: 'stage' });
    db.timeline_entries.push({ id: uuid(), org_id: ORG_ID, case_id: c.id, type: 'system', attachments: [], audiences: [], resolved_at: null,
      body: title + 'の入金予定日を ' + md + ' にした（' + who + '）', created_by: null, created_at: at });
    return { ok: true, label, payment_due: a.p_due, at };
  }
  // migration 085（Task 68）: 共有（doc_share_sent）と「送っていない」に戻す（doc_share_undo）。_t68_doc_label と同じ書類の名前
  const T68_KIND = { site_check: '現地確認', survey: '調査', cause: '原因元工事', repair: '復旧工事', other: 'その他' };
  const T68_WT = { investigate: 'survey', repair: 'cause', restore: 'repair' };
  function t68Label(d) {
    if (d.report_id) {
      const r = db.reports.find(x => x.id === d.report_id) || {};
      const p = db.case_phases.find(x => x.id === r.phase_id);
      return (T68_KIND[p ? p.kind : T68_WT[r.work_type]] || '') + '報告書';
    }
    const e = db.estimates.find(x => x.id === d.estimate_id) || {};
    const p = db.case_phases.find(x => x.id === e.phase_id);
    return (p && T68_KIND[p.kind] ? T68_KIND[p.kind] + 'の' : '') + '見積書';
  }
  function t68Room(d, c) {
    const r = d.report_id ? db.reports.find(x => x.id === d.report_id) : null;
    const room = String((r && String(r.room || '').trim()) || c.room || '').trim();
    return room ? (/[0-9０-９A-Za-zＡ-Ｚａ-ｚ]$/.test(room) ? room + '号室' : room) + ' ' : '';
  }
  function docShareSent(a) {
    const via = { share: 'スマホの共有', mail: 'メール', line: 'LINE' }[a.p_via];
    if (!via) throw P0001('共有のしかたの指定が正しくありません');
    const d = db.mail_drafts.find(x => x.id === a.p_draft && x.org_id === ORG_ID);
    if (!d || (!d.report_id && !d.estimate_id)) throw P0001('共有する書類が見つかりません');
    const c = caseOf(d.case_id);
    if (!c || c.deleted_at) throw P0001('この案件は削除されています');
    if (!(myRole() === 'owner' || fieldRegistered(c))) throw pgErr('共有できるのは、管理者と、現場用でこの案件を登録した人だけです', '42501');
    if (d.status !== 'draft') throw P0001('すでに送付済みです。開き直してください');
    const at = nowIso();
    if (d.report_id) {
      const r = db.reports.find(x => x.id === d.report_id);
      if (!r) throw P0001('報告書が見つかりません');
      if (r.work_type === 'site_check') throw P0001('現地確認の記録は共有できません');
      if (r.status === 'draft') throw P0001('報告書を提出してから共有してください');
      if (r.status === 'submitted') Object.assign(r, { confirmed_at: at, confirmed_by: user.id });
      if (r.status === 'submitted' || r.status === 'confirmed') Object.assign(r, { status: 'sent', sent_at: at, updated_at: at });
    } else {
      const e = db.estimates.find(x => x.id === d.estimate_id);
      if (!e) throw P0001('見積書が見つかりません');
      if (e.status === 'superseded') throw P0001('この版より新しい版があります。最新の版で共有してください');
      if (!['issued', 'sent', 'accepted'].includes(e.status)) throw P0001('見積書を提出してから共有してください');
      if (e.status !== 'accepted') Object.assign(e, { status: 'sent', sent_at: at, updated_at: at });
      db.timeline_entries.filter(t => t.case_id === e.case_id && t.type === 'request' && !t.resolved_at && (e.linked_request_ids || []).includes(t.id))
        .forEach(t => { t.resolved_at = at; });
    }
    Object.assign(d, { status: 'sent', sent_at: at, sent_by: user.id, updated_at: at });
    db.timeline_entries.push({ id: uuid(), org_id: ORG_ID, case_id: c.id, type: 'system', attachments: [], audiences: [], resolved_at: null,
      body: t68Room(d, c) + t68Label(d) + 'を共有した（' + via + '）', created_by: null, created_at: nowIso() });
    return { ok: true, sent_at: at, via };
  }
  function docShareUndo(a) {
    if (myRole() !== 'owner') throw pgErr('「送っていない」に戻せるのは管理者だけです', '42501');
    const d = db.mail_drafts.find(x => x.id === a.p_draft && x.org_id === ORG_ID);
    if (!d || (!d.report_id && !d.estimate_id)) throw P0001('共有の記録が見つかりません');
    if (d.status !== 'sent') throw P0001('まだ送付していません');
    const c = caseOf(d.case_id);
    if (!c || c.deleted_at) throw P0001('この案件は削除されています');
    const at = nowIso();
    Object.assign(d, { status: 'draft', sent_at: null, sent_by: null, updated_at: at });
    const other = db.mail_drafts.some(x => x.id !== d.id && x.status === 'sent' && ((d.report_id && x.report_id === d.report_id) || (d.estimate_id && x.estimate_id === d.estimate_id)));
    if (!other && d.report_id) { const r = db.reports.find(x => x.id === d.report_id); if (r && r.status === 'sent') Object.assign(r, { status: 'confirmed', sent_at: null, updated_at: at }); }
    if (!other && d.estimate_id) { const e = db.estimates.find(x => x.id === d.estimate_id); if (e && e.status === 'sent') Object.assign(e, { status: 'issued', sent_at: null, updated_at: at }); }
    db.timeline_entries.push({ id: uuid(), org_id: ORG_ID, case_id: c.id, type: 'system', attachments: [], audiences: [], resolved_at: null,
      body: t68Room(d, c) + t68Label(d) + 'の共有を取り消した（送っていない）', created_by: null, created_at: nowIso() });
    return { ok: true };
  }
  // migration 069（Task 50）: 日程調整。直せる人 = 管理者か現場用で本人が登録した案件の本人、選ぶ・候補を出す = その対応の作業担当者（か直せる人）
  // migration 072: 所要時間の確かめ（_sched_dur と同じ文言）
  function schedDur(d) {
    if (d == null) return null;
    if (typeof d !== 'object' || Array.isArray(d) || !('mins' in d || 'days' in d)) throw P0001('所要時間の形が正しくありません');
    if ('mins' in d) {
      if (!Number.isInteger(d.mins) || d.mins < 30 || d.mins > 1440 || d.mins % 30) throw P0001('所要時間は30分きざみで30分〜24時間です');
      return { mins: d.mins };
    }
    if (!Number.isInteger(d.days) || d.days < 1 || d.days > 31) throw P0001('日数は1〜31日です');
    const hm = v => /^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(v || '');
    if (!hm(d.from) || !hm(d.to) || d.from >= d.to) throw P0001('毎日の時間帯（何時から何時まで）を正しく入れてください');
    return { days: d.days, from: d.from, to: d.to };
  }
  // migration 072: 作業担当者の確定した予定と重なるか（_sched_clash と同じ。失注・done・completed・削除した案件は除く）→ 文か null
  function schedClash(workerId, start, end, exceptId) {
    if (!workerId || !start) return null;
    const s0 = Date.parse(start);
    const e0 = end && Date.parse(end) > s0 ? Date.parse(end) : s0 + 3600000;
    const hit = db.case_phases.filter(x => x.org_id === ORG_ID && x.worker_id === workerId && x.id !== exceptId && x.scheduled_at && !x.lost_at && !x.done_at && !x.completed_at)
      .filter(x => { const c = caseOf(x.case_id); return c && !c.deleted_at; })
      .map(x => ({ x, s: Date.parse(x.scheduled_at), e: x.scheduled_end && Date.parse(x.scheduled_end) > Date.parse(x.scheduled_at) ? Date.parse(x.scheduled_end) : Date.parse(x.scheduled_at) + 3600000 }))
      .filter(b => b.s < e0 && b.e > s0).sort((a, b) => a.s - b.s)[0];
    if (!hit) return null;
    const j = t => new Date(t + 9 * 3600000);
    const md = t => (j(t).getUTCMonth() + 1) + '/' + j(t).getUTCDate();
    const hm = t => j(t).getUTCHours() + ':' + String(j(t).getUTCMinutes()).padStart(2, '0');
    return window.PhaseLogic.placeName(caseOf(hit.x.case_id)) + '（' + md(hit.s) + ' ' + hm(hit.s) + '〜' + (md(hit.e) === md(hit.s) ? '' : md(hit.e) + ' ') + hm(hit.e) + '）';
  }
  const clashErr = v => pgErr('作業担当者のほかの予定 ' + v + 'と重なります（先に決まった予定が優先です）', '23P01');
  // migration 072: case_phases_no_double（作業担当者・日時が入る／変わるとき）
  function noDouble(row, old) {
    if (!row.worker_id || !row.scheduled_at || row.lost_at || row.done_at || row.completed_at) return;
    const t = v => (v == null ? null : Date.parse(v));
    if (old && row.worker_id === old.worker_id && t(row.scheduled_at) === t(old.scheduled_at) && t(row.scheduled_end) === t(old.scheduled_end)) return;
    const v = schedClash(row.worker_id, row.scheduled_at, row.scheduled_end, row.id);
    if (v) throw clashErr(v);
  }
  // migration 072: _sched_blocked_scan（候補・希望が全部埋まった対応に blocked_at と管理者あての知らせ）
  function blockedScan(workerId) {
    if (!workerId) return;
    const PL = window.PhaseLogic;
    for (const sc of db.phase_schedules.filter(x => ['candidates', 'wish'].includes(x.state) && !x.blocked_at)) {
      const p = db.case_phases.find(x => x.id === sc.phase_id);
      const c = p && caseOf(p.case_id);
      if (!p || p.worker_id !== workerId || p.scheduled_at || p.lost_at || !c || c.deleted_at) continue;
      const slots = sc.state === 'candidates' ? sc.cands : sc.wish;
      const free = sl => PL.slotStarts(sl, sc.dur).some(o => !schedClash(workerId, o.start, o.end || PL.durEnd(o.start, sc.dur), p.id));
      if (!slots.length || slots.some(free)) continue;
      const at = nowIso(), title = phaseTitleOf(p.id);
      Object.assign(sc, { blocked_at: at, updated_at: at });
      db.staff_messages.push({ id: uuid(), org_id: ORG_ID, case_id: c.id, phase_id: p.id, from_user: user.id, to_user: null, subject: (title + ' 候補が埋まりました').slice(0, 100),
        body: '案件: ' + PL.placeName(c) + '\n対応: ' + title + '\n出していた日程の候補が、作業担当者のほかの予定ですべて埋まりました。出し直してください', attachments: [], read_at: null, reply_to: null,
        created_at: at, source: 'schedule', meta: { action: 'blocked' }, as_client: false, daily_date: null });
      db.timeline_entries.push({ id: uuid(), org_id: ORG_ID, case_id: c.id, type: 'system', attachments: [], audiences: [], resolved_at: null,
        body: title + 'の日程の候補が、作業担当者のほかの予定ですべて埋まった', created_by: null, created_at: at });
    }
  }
  function schedSlots(v, min, max) {
    if (!Array.isArray(v) || v.length < min || v.length > max) throw P0001('候補の日時は' + min + '〜' + max + '件です');
    return v.map(x => {
      const st = x && typeof x.start === 'string' ? Date.parse(x.start) : NaN;
      const en = x && x.end ? Date.parse(x.end) : null;
      if (!Number.isFinite(st) || (en != null && !Number.isFinite(en))) throw P0001('候補の日時の形が正しくありません');
      if (en != null && en <= st) throw P0001('終わりは開始より後にしてください');
      return { start: new Date(st).toISOString(), end: en == null ? null : new Date(en).toISOString() };
    });
  }
  function schedCond(c) {
    if (!c || typeof c !== 'object' || Array.isArray(c)) throw P0001('入居者の都合の形が正しくありません');
    const any = !!c.any, note = String(c.note || '').trim();
    if (note.length > 200) throw P0001('自由記載は200文字までです');
    const hm = v => v === '' || /^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(v);
    const bands = (Array.isArray(c.bands) ? c.bands : []).map(b => {
      if (!b || !['weekday', 'weekend', 'all', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].includes(b.days) || !hm(b.from || '') || !hm(b.to || '')) throw P0001('曜日と時間帯の形が正しくありません');
      return { days: b.days, from: b.from || '', to: b.to || '' };
    });
    if (bands.length > 5) throw P0001('曜日と時間帯は5つまでです');
    if (!any && !bands.length && !note) throw P0001('入居者の都合を入れてください（いつでもよい・曜日と時間帯・自由記載のどれか）');
    return { any, bands: any ? [] : bands, note };
  }
  function schedAct(phaseId, action, data) {
    const p = db.case_phases.find(x => x.id === phaseId && x.org_id === ORG_ID);
    if (!p) throw P0001('この対応が見つかりません');
    const c = caseOf(p.case_id);
    if (!c || c.deleted_at) throw P0001('この案件は削除されています');
    if (p.lost_at) throw P0001('この対応は失注です');
    const mgr = myRole() === 'owner' || fieldRegistered(c), worker = p.worker_id === user.id;
    const at = nowIso(), title = phaseTitleOf(p.id), who = (memberOf(user.id) || {}).display_name || '不明';
    const fmt = x => window.PhaseLogic.slotText(x).replace(/〜(\d+\/\d+ )/, '〜'); // 069 の _sched_fmt と同じ（10/30（木）10:00〜12:00）
    let sc = db.phase_schedules.find(x => x.phase_id === p.id);
    const upsert = patch => {
      if (!sc) { sc = { id: uuid(), org_id: ORG_ID, phase_id: p.id, state: 'none', cands: [], cond: null, wish: [], set_by: null, set_at: null,
        wish_by: null, wish_at: null, confirmed_by: null, confirmed_at: null, dur: null, blocked_at: null, updated_at: at }; db.phase_schedules.push(sc); }
      Object.assign(sc, patch, { updated_at: at });
    };
    const setTime = (st, en) => {
      const old = { ...p };
      noDouble({ ...p, scheduled_at: st, scheduled_end: st ? en : null }, old); // 072
      Object.assign(p, { scheduled_at: st, scheduled_end: st ? en : null, schedule_set_at: st ? at : null, updated_at: at });
      schedSync(p, old);
      blockedScan(p.worker_id);
    };
    let act = action, slots = null, cond = null, meta, subject, body, tl, to = null, one = null, dur = null;
    const PL = window.PhaseLogic;
    if (action === 'offer' || action === 'propose') { // 072: { cands, dur }
      const obj = data && typeof data === 'object' && !Array.isArray(data);
      dur = schedDur(obj ? data.dur : null);
      if (obj) data = data.cands;
    }
    const windowCheck = () => { if (!dur) return; slots.forEach((x, i) => {
      if (!x.end) throw P0001('候補' + (i + 1) + 'の時間帯の終わりを入れてください');
      if (!PL.slotStarts(x, dur).length) throw P0001('候補' + (i + 1) + 'の時間帯が所要時間より短いです');
    }); };
    if (action === 'offer' || action === 'conditions') {
      if (!mgr) throw pgErr('日程の候補・入居者の都合を出せるのは、管理者と、現場用でこの案件を登録した人だけです', '42501');
      if (action === 'offer') { slots = schedSlots(data, 1, 5); windowCheck(); } else cond = schedCond(data);
      const reset = !!p.scheduled_at;
      if (reset) setTime(null, null);
      upsert({ state: action === 'offer' ? 'candidates' : 'conditions', cands: slots || [], cond, wish: [], set_by: user.id, set_at: at, wish_by: null, wish_at: null, confirmed_by: null, confirmed_at: null, dur, blocked_at: null });
      to = p.worker_id !== user.id ? p.worker_id : null;
      if (action === 'offer') { subject = title + ' 日程候補 ' + slots.length + '件'; body = '候補の日時から選んでください:\n' + slots.map(x => '・' + fmt(x)).join('\n');
        meta = { action, cands: slots, reset, dur }; tl = title + 'の日程候補を出した（' + slots.length + '件・' + who + '）'; }
      else { subject = title + ' 入居者の都合'; body = '入居者の都合を見て、日程の候補を1〜3つ出してください'; meta = { action, cond, reset }; tl = title + 'の入居者の都合を伝えた（' + who + '）'; }
    } else if (action === 'pick' || action === 'propose') {
      if (!(worker || mgr)) throw pgErr('選べる・候補を出せるのは、この対応の作業担当者だけです', '42501');
      if (action === 'pick') {
        if (!sc || sc.state !== 'candidates') throw P0001('選べる日程の候補がありません');
        one = sc.cands.find(x => PL.slotStarts(x, sc.dur).some(o => Date.parse(o.start) === Date.parse(data.start))); // 072: 時間帯の中の始まり
        if (!one) throw P0001('その日時は候補にありません');
        if (sc.dur) one = { start: new Date(Date.parse(data.start)).toISOString(), end: PL.durEnd(data.start, sc.dur) };
        slots = [one];
        if (mgr) act = 'confirm';
      } else {
        if (!sc || !(sc.state === 'conditions' || (sc.state === 'wish' && sc.cond))) throw P0001('候補を出す日程調整がありません（入居者の都合が届いていません）');
        slots = schedSlots(data, 1, 3);
        windowCheck();
      }
      if (act !== 'confirm') {
        if (action === 'pick' && p.worker_id) { const v = schedClash(p.worker_id, one.start, one.end, p.id); if (v) throw clashErr(v); } // 072
        upsert({ state: 'wish', wish: slots, wish_by: user.id, wish_at: at, blocked_at: null, dur: action === 'propose' ? dur : sc.dur });
        if (action === 'pick') { subject = title + ' 希望 ' + fmt(one); body = who + 'が候補から選びました: ' + fmt(one) + '\n確定してください';
          meta = { action: 'wish', cands: slots, dur: sc.dur || null }; tl = title + 'の日程の希望: ' + fmt(one) + '（' + who + '）'; }
        else { subject = title + ' 日程候補 ' + slots.length + '件（' + who + '）'; body = who + 'が入居者の都合を見て候補を出しました:\n' + slots.map(x => '・' + fmt(x)).join('\n') + '\n1つ選んで確定してください';
          meta = { action: 'propose', cands: slots, cond: sc.cond, dur }; tl = title + 'の日程候補を出した（' + slots.length + '件・' + who + '）'; }
      }
    } else if (action === 'confirm') {
      if (!mgr) throw pgErr('日程を確定できるのは、管理者と、現場用でこの案件を登録した人だけです', '42501');
      slots = schedSlots([data], 1, 1);
      one = slots[0];
      if (!one.end && sc && sc.dur) one = { start: one.start, end: PL.durEnd(one.start, sc.dur) }; // 072: 終わりが無ければ 始まり＋所要時間
    } else throw P0001('操作の指定が正しくありません');
    if (act === 'confirm') {
      one = one || slots[0];
      setTime(one.start, one.end || null);
      upsert({ state: 'confirmed', confirmed_by: user.id, confirmed_at: at, set_by: sc ? sc.set_by : user.id, set_at: sc ? sc.set_at : at, blocked_at: null });
      to = p.worker_id !== user.id ? p.worker_id : null;
      subject = title + ' 日程確定 ' + fmt(one); body = '日程が決まりました: ' + fmt(one) + '（' + who + 'が確定）';
      meta = { action: 'confirm', cands: [one] }; tl = title + 'の日程を ' + fmt(one) + ' に確定した（日程調整・' + who + '）';
    }
    const room = String(c.room || '').trim();
    const place = [String(c.name || '').trim(), room ? (/[0-9０-９A-Za-zＡ-Ｚａ-ｚ]$/.test(room) ? room + '号室' : room) : ''].filter(Boolean).join(' ');
    db.staff_messages.push({ id: uuid(), org_id: ORG_ID, case_id: c.id, phase_id: p.id, from_user: user.id, to_user: to || null,
      subject: subject.slice(0, 100), body: '案件: ' + place + '\n対応: ' + title + '\n' + body, attachments: [], read_at: null, reply_to: null,
      created_at: at, source: 'schedule', meta: clone(meta), as_client: false, daily_date: null });
    db.timeline_entries.push({ id: uuid(), org_id: ORG_ID, case_id: c.id, type: 'system', attachments: [], audiences: [], resolved_at: null, body: tl, created_by: null, created_at: at });
    if (action === 'offer' || action === 'propose') blockedScan(p.worker_id); // 072
    return { ok: true, state: sc.state, action: act, scheduled_at: p.scheduled_at || null, blocked: !!sc.blocked_at };
  }
  // migration 070: 一斉配信（_open_call_act と同じ）
  // migration 076: 範囲（_open_call_window）・終わり（_open_call_end）・期限切れ（_open_call_expire_one）・一覧（open_call_list）
  const CALL_WIN = ['today', 'today_after', 'tomorrow', 'tomorrow_after'];
  function callWindowOf(when, hour) {
    const w = window.PhaseLogic.callWindow(when, hour, Date.now());
    if (w.error) throw P0001(w.error);
    return w;
  }
  const callEndOf = p => (p.open_call_to ? Date.parse(p.open_call_to) : p.open_call_kind !== 'none' && p.scheduled_at ? Date.parse(p.scheduled_at) : null);
  const jstMDHM = iso => { const d = new Date(Date.parse(iso) + 9 * 3600000); return (d.getUTCMonth() + 1) + '/' + d.getUTCDate() + ' ' + d.getUTCHours() + ':' + String(d.getUTCMinutes()).padStart(2, '0'); };
  const jstHM2 = iso => jstMDHM(iso).split(' ')[1];
  const placeOf = c => { const room = String(c.room || '').trim(); return [String(c.name || '').trim(), room ? (/[0-9０-９A-Za-zＡ-Ｚａ-ｚ]$/.test(room) ? room + '号室' : room) : ''].filter(Boolean).join(' '); };
  function openCallExpireOne(p) {
    if (!p || !p.open_call_at || p.worker_id || p.lost_at) return false;
    const end = callEndOf(p);
    if (end == null || end > Date.now()) return false;
    const c = caseOf(p.case_id);
    const by = p.open_call_by, callAt = p.open_call_at, at = nowIso();
    Object.assign(p, { open_call_at: null, open_call_by: null, open_call_expired_at: at, updated_at: at });
    if (!c || c.deleted_at) return true;
    const title = phaseTitleOf(p.id), place = placeOf(c), endIso = new Date(end).toISOString();
    db.staff_messages.push({ id: uuid(), org_id: ORG_ID, case_id: c.id, phase_id: p.id, from_user: user.id, to_user: by || null, attachments: [], read_at: null, reply_to: null,
      created_at: at, source: 'open_call', as_client: false, daily_date: null, subject: ('募集が期限切れになりました（' + [place, title].filter(Boolean).join(' ') + '）').slice(0, 100),
      body: '案件: ' + place + '\n対応: ' + title + '\n' + jstMDHM(endIso) + ' までに誰も「行けます」を押しませんでした。出し直すときは、全体のトークの募集のカードか、案件ページの対応の表「担当者」から',
      meta: { action: 'expired', call_at: callAt, end: endIso } });
    db.timeline_entries.push({ id: uuid(), org_id: ORG_ID, case_id: c.id, type: 'system', attachments: [], audiences: [], resolved_at: null,
      body: title + 'の一斉配信が期限切れになった（' + jstMDHM(endIso) + ' までに誰も行けなかった）', created_by: null, created_at: at });
    return true;
  }
  function openCallExpireAll() {
    let n = 0;
    db.case_phases.filter(p => p.org_id === ORG_ID).forEach(p => { if (openCallExpireOne(p)) n++; });
    return n;
  }
  function openCallList() {
    const owner = myRole() === 'owner';
    const latest = new Map();
    db.staff_messages.filter(m => m.source === 'open_call' && !m.case_id && m.meta && m.meta.action === 'call' && Date.parse(m.created_at) > Date.now() - 14 * 86400000)
      .forEach(m => { const k = m.meta.phase_id; const o = latest.get(k); if (!o || Date.parse(m.created_at) > Date.parse(o.created_at)) latest.set(k, m); });
    const out = [];
    for (const m of latest.values()) {
      const p = db.case_phases.find(x => x.id === m.meta.phase_id);
      const c = p && caseOf(p.case_id);
      if (!p || !c || c.deleted_at || !(owner || m.from_user === user.id)) continue;
      const end = callEndOf(p);
      const state = p.lost_at ? 'closed' : p.worker_id ? 'taken' : p.open_call_at && (end == null || end > Date.now()) ? 'open' : p.open_call_at || p.open_call_expired_at ? 'expired' : 'closed';
      const nm = id => (memberOf(id) && String(memberOf(id).display_name || '').trim()) || null;
      const seen = db.talk_reads.filter(r => !r.case_id && Date.parse(r.read_at) >= Date.parse(m.created_at) && r.user_id !== m.from_user)
        .sort((a, b) => Date.parse(a.read_at) - Date.parse(b.read_at)).map(r => nm(r.user_id) || '（名前なし）');
      out.push({ message_id: m.id, phase_id: p.id, case_id: c.id, kind: p.kind, title: phaseTitleOf(p.id), place: placeOf(c), posted_at: m.created_at, posted_by: m.from_user,
        posted_by_name: nm(m.from_user), call_kind: p.open_call_kind || null, from: p.open_call_from || null, to: p.open_call_to || null, scheduled_at: p.scheduled_at || null,
        scheduled_end: p.scheduled_end || null, expired_at: p.open_call_expired_at || null, state, taker_name: p.worker_id ? nm(p.worker_id) : null, seen });
    }
    return out.sort((a, b) => Date.parse(b.posted_at) - Date.parse(a.posted_at));
  }
  function openCallAct(phaseId, action, start, args) {
    const a76 = args || {};
    const p = db.case_phases.find(x => x.id === phaseId && x.org_id === ORG_ID);
    if (!p) throw P0001('この対応が見つかりません');
    const c = caseOf(p.case_id);
    if (!c || c.deleted_at) throw P0001('この案件は削除されています');
    if (p.lost_at) throw P0001('この対応は失注です');
    openCallExpireOne(p); // 076: 終わりを過ぎた募集は先に期限切れに
    const mgr = myRole() === 'owner' || fieldRegistered(c);
    const at = nowIso(), title = phaseTitleOf(p.id), who = (memberOf(user.id) || {}).display_name || '不明';
    const room = String(c.room || '').trim();
    const place = [String(c.name || '').trim(), room ? (/[0-9０-９A-Za-zＡ-Ｚａ-ｚ]$/.test(room) ? room + '号室' : room) : ''].filter(Boolean).join(' ');
    const tl = body => db.timeline_entries.push({ id: uuid(), org_id: ORG_ID, case_id: c.id, type: 'system', attachments: [], audiences: [], resolved_at: null, body, created_by: null, created_at: at });
    const msg = (o) => db.staff_messages.push(Object.assign({ id: uuid(), org_id: ORG_ID, from_user: user.id, to_user: null, attachments: [], read_at: null, reply_to: null,
      created_at: at, source: 'open_call', as_client: false, daily_date: null }, o));
    const pad2 = n => String(n).padStart(2, '0');
    const jstHM = iso => { const d = new Date(Date.parse(iso) + 9 * 3600000); return (d.getUTCMonth() + 1) + '/' + d.getUTCDate() + ' ' + d.getUTCHours() + ':' + pad2(d.getUTCMinutes()); };
    if (action === 'open' || action === 'cancel') {
      if (!mgr) throw pgErr('一斉配信を出す・取り消すのは、管理者と、現場用でこの案件を登録した人だけです', '42501');
      if (action === 'open') {
        if (p.open_call_at) throw P0001('もう募集中です');
        if (p.done_at || p.completed_at) throw P0001('この対応は終わっています');
        const when = a76.p_when || null; // 076
        let w = { from: null, to: null };
        if (CALL_WIN.includes(when)) w = callWindowOf(when, a76.p_hour);
        else if (when === 'fixed') {
          if (!p.scheduled_at) throw P0001('「日時を決める」は、先に日時（開始）を入れてください');
          if (Date.parse(p.scheduled_at) <= Date.now()) throw P0001('日時がもう過ぎています。日時を入れ直すか、ほかの選び方にしてください');
        } else if (when && when !== 'none') throw P0001('いつ来てほしいかの指定が正しくありません');
        const old = { ...p };
        Object.assign(p, { worker_id: null, open_call_at: at, open_call_by: user.id, updated_at: at,
          open_call_kind: when, open_call_from: w.from, open_call_to: w.to, open_call_expired_at: null },
          when && when !== 'fixed' ? { scheduled_at: null, scheduled_end: null } : {});
        workerTrigger(p, old); syncReportWorker(p, old);
        const sc = db.phase_schedules.find(x => x.phase_id === p.id);
        const whenText = p.open_call_from ? window.PhaseLogic.callWhen(p, Date.now()) // 076
          : p.scheduled_at ? jstHM(p.scheduled_at) : sc && sc.state === 'candidates' ? '日程は候補から選ぶ（' + sc.cands.length + '件）'
          : sc && sc.state === 'conditions' ? '日程は入居者の都合を見て決める' : '日時未定';
        msg({ case_id: null, phase_id: null, subject: ('募集: ' + [place, title, whenText].filter(Boolean).join(' ') + ' — 行けますか？').slice(0, 100),
          body: '案件: ' + place + '\n対応: ' + title + '\n' + (p.open_call_from ? '到着: ' + jstMDHM(p.open_call_from) + '〜' + jstHM2(p.open_call_to) + ' の間（押した人が到着の時刻を選びます）\n' : '')
            + '一番早く「行けます」を押した人が担当になります（' + who + 'が募集）', meta: { action: 'call', case_id: c.id, phase_id: p.id } });
        tl(title + 'の作業担当者を一斉配信（早い者順）で募集した（' + who + '）');
        return { ok: true, open_call_at: at, from: p.open_call_from, to: p.open_call_to };
      }
      if (!p.open_call_at || p.worker_id) throw P0001('募集中ではありません');
      Object.assign(p, { open_call_at: null, open_call_by: null, updated_at: at });
      tl(title + 'の一斉配信の募集を取り消した（' + who + '）');
      return { ok: true };
    }
    if (p.worker_id || !p.open_call_at) {
      if (p.worker_id === user.id) return { ok: true, already: true };
      if (p.worker_id) {
        const won = db.open_call_apps.filter(a => a.phase_id === p.id && a.result === 'won').slice(-1)[0];
        db.open_call_apps.push({ id: uuid(), org_id: ORG_ID, phase_id: p.id, call_at: won ? won.call_at : null, user_id: user.id, result: 'late', slot: start || null, created_at: at });
      }
      return { ok: false, reason: p.worker_id ? 'taken' : p.open_call_expired_at ? 'expired' : 'closed', worker_name: p.worker_id && memberOf(p.worker_id) ? memberOf(p.worker_id).display_name : null };
    }
    const sc = db.phase_schedules.find(x => x.phase_id === p.id);
    let slot = null;
    let win = null; // 076: 範囲のある募集 = 到着の時刻と所要時間
    if (p.open_call_from) {
      if (!start) throw P0001('到着の時刻を選んでください');
      const mins = a76.p_mins == null ? (p.kind === 'survey' ? 120 : 60) : Number(a76.p_mins);
      if (!(mins >= 30 && mins <= 720 && mins % 30 === 0)) throw P0001('所要時間は30分きざみで30分〜12時間です');
      const st = Date.parse(start);
      if (st < Date.now()) throw P0001('その時刻はもう過ぎています。ほかの時刻を選んでください');
      const en = st + mins * 60000;
      if (st % 1800000 !== 0 || st < Date.parse(p.open_call_from) || en > Date.parse(p.open_call_to)) {
        throw P0001('その時刻は募集の範囲（' + jstMDHM(p.open_call_from) + '〜' + jstHM2(p.open_call_to) + '。終わりまでに作業が終わる時刻）に入りません');
      }
      win = { start: new Date(st).toISOString(), end: new Date(en).toISOString() };
    } else if (sc && sc.state === 'candidates') {
      if (!start) throw P0001('候補の日時から1つ選んでください');
      const PL = window.PhaseLogic;
      slot = sc.cands.find(x => PL.slotStarts(x, sc.dur).some(o => Date.parse(o.start) === Date.parse(start))); // 072
      if (!slot) throw P0001('その日時は候補にありません');
      if (sc.dur) slot = { start: new Date(Date.parse(start)).toISOString(), end: PL.durEnd(start, sc.dur) };
      const v = schedClash(user.id, slot.start, slot.end, p.id); // 072: 押した人の予定と重なれば何も変えない
      if (v) throw clashErr(v);
    }
    noDouble({ ...p, worker_id: user.id, ...(win ? { scheduled_at: win.start, scheduled_end: win.end } : {}) }, p); // 072: 日時のある募集・076: 到着の時刻
    const callAt = p.open_call_at, by = p.open_call_by;
    const old = { ...p };
    Object.assign(p, { worker_id: user.id, open_call_at: null, open_call_by: null, updated_at: at }, win ? { scheduled_at: win.start, scheduled_end: win.end, schedule_set_at: at } : {});
    workerTrigger(p, old); syncReportWorker(p, old);
    db.open_call_apps.push({ id: uuid(), org_id: ORG_ID, phase_id: p.id, call_at: callAt, user_id: user.id, result: 'won', slot: slot ? slot.start : win ? win.start : null, created_at: at });
    if (slot) schedAct(p.id, 'pick', { start: slot.start });
    else blockedScan(user.id);
    const fmt = x => window.PhaseLogic.slotText(x).replace(/〜(\d+\/\d+ )/, '〜');
    const subj = win ? title + ' ' + who + 'が ' + jstMDHM(win.start) + ' に行きます' : title + ' ' + who + 'が担当になりました（一斉配信）'; // 076
    const body = win ? '案件: ' + place + '\n対応: ' + title + '\n' + who + 'が「行けます」を押して担当になりました\n日時: ' + jstMDHM(win.start) + '〜' + jstHM2(win.end)
      : '案件: ' + place + '\n対応: ' + title + '\n' + who + 'が「行けます」を押して担当になりました' + (slot ? '\n希望の日時: ' + fmt(slot) : '');
    const meta = { action: 'taken', slot: slot || null, at: win ? win.start : null, end: win ? win.end : null };
    msg({ case_id: c.id, phase_id: p.id, subject: subj.slice(0, 100), body, meta });
    const poster = by && memberOf(by);
    if (poster && by !== user.id && poster.role !== 'owner') msg({ case_id: c.id, phase_id: p.id, to_user: by, subject: subj.slice(0, 100), body, meta: { ...meta, to: 'poster' } }); // 076
    tl(title + 'の一斉配信で ' + who + ' が担当になった' + (win ? '（' + jstMDHM(win.start) + '〜' + jstHM2(win.end) + '）' : slot ? '（希望 ' + fmt(slot) + '）' : ''));
    const s2 = db.phase_schedules.find(x => x.phase_id === p.id);
    return { ok: true, worker_id: user.id, state: s2 ? s2.state : null, scheduled_at: win ? win.start : null, scheduled_end: win ? win.end : null };
  }
  function fieldTaskDismiss(a) {
    const { p, c, who, place } = taskPhase(a.p_phase, a.p_task);
    if (!fieldRegistered(c)) throw pgErr('削除できるのは、現場用で自分が登録した案件のタスクだけです（ほかの案件は「差し戻す」）', '42501');
    if (openFlag(p.id, a.p_task, 'dismiss')) throw P0001('このタスクはすでに削除されています');
    const label = TASK_JA[a.p_task], title = phaseTitleOf(p.id);
    const f = { id: uuid(), org_id: ORG_ID, case_id: c.id, phase_id: p.id, task: a.p_task, action: 'dismiss', body: null, message_id: null,
      created_by: user.id, created_at: nowIso(), closed_at: null, closed_by: null };
    db.phase_task_flags.push(f);
    db.staff_messages.push({ id: uuid(), org_id: ORG_ID, case_id: c.id, phase_id: p.id, from_user: user.id, to_user: null,
      subject: (who + 'が「' + label + '」を削除した').slice(0, 100),
      body: ['案件: ' + place, '対応: ' + title, 'タスク: ' + label + '（' + who + 'の一覧から消えました）', '対応そのものは残っています。戻すときは案件ページの対応の表から。'].join('\n'),
      attachments: [], read_at: null, reply_to: null, created_at: nowIso(), source: 'task_delete' });
    db.timeline_entries.push({ id: uuid(), org_id: ORG_ID, case_id: c.id, type: 'system', attachments: [], audiences: [], resolved_at: null,
      body: who + 'が' + title + 'の「' + label + '」のタスクを削除した（現場用）', created_by: null, created_at: nowIso() });
    return { ok: true, id: f.id };
  }
  function fieldTaskSendback(a) {
    const { p, c, who, place } = taskPhase(a.p_phase, a.p_task);
    const body = String(a.p_body == null ? '' : a.p_body).trim();
    if (!body) throw P0001('差し戻す内容を書いてください');
    if (Array.from(body).length > 1000) throw P0001('差し戻す内容は1000文字までです');
    if (fieldRegistered(c)) throw pgErr('自分が登録した案件のタスクは「このタスクを削除」を使ってください', '42501');
    if (openFlag(p.id, a.p_task, 'sendback')) throw P0001('このタスクはすでに差し戻し中です（管理者の返事を待ってください）');
    const label = TASK_JA[a.p_task], title = phaseTitleOf(p.id);
    const msg = { id: uuid(), org_id: ORG_ID, case_id: c.id, phase_id: p.id, from_user: user.id, to_user: null,
      subject: (who + 'が「' + label + '」を差し戻した').slice(0, 100),
      body: body + '\n\n' + ['案件: ' + place, '対応: ' + title, 'タスク: ' + label].join('\n'),
      attachments: [], read_at: null, reply_to: null, created_at: nowIso(), source: 'sendback' };
    db.staff_messages.push(msg);
    const f = { id: uuid(), org_id: ORG_ID, case_id: c.id, phase_id: p.id, task: a.p_task, action: 'sendback', body, message_id: msg.id,
      created_by: user.id, created_at: nowIso(), closed_at: null, closed_by: null };
    db.phase_task_flags.push(f);
    db.timeline_entries.push({ id: uuid(), org_id: ORG_ID, case_id: c.id, type: 'system', attachments: [], audiences: [], resolved_at: null,
      body: who + 'が' + title + 'の「' + label + '」を差し戻した: ' + body, created_by: null, created_at: nowIso() });
    return { ok: true, id: f.id, message_id: msg.id };
  }
  function taskFlagClose(a) {
    if (myRole() !== 'owner') throw pgErr('管理者だけができます', '42501');
    const f = db.phase_task_flags.find(x => x.id === a.p_id && x.org_id === ORG_ID);
    if (!f) throw P0001('記録が見つかりません');
    if (f.closed_at) throw P0001(f.action === 'dismiss' ? 'このタスクはもう戻してあります' : 'この差し戻しはもう済みです');
    f.closed_at = nowIso();
    f.closed_by = user.id;
    const who = (memberOf(user.id) && String(memberOf(user.id).display_name || '').trim()) || '管理者';
    db.timeline_entries.push({ id: uuid(), org_id: ORG_ID, case_id: f.case_id, type: 'system', attachments: [], audiences: [], resolved_at: null,
      body: who + 'が' + phaseTitleOf(f.phase_id) + 'の「' + TASK_JA[f.task] + '」' + (f.action === 'dismiss' ? 'のタスクを戻した' : 'の差し戻しを済みにした'),
      created_by: null, created_at: nowIso() });
    return { ok: true, id: f.id, action: f.action };
  }
  function phaseLate(phaseId, by, who, minutes, note, viaShare) {
    const m = Number(minutes);
    if (!Number.isInteger(m) || m < 1 || m > 600) throw P0001('遅れる見込みは 1〜600 分で入れてください');
    const n = String(note == null ? '' : note).trim();
    if (Array.from(n).length > 200) throw P0001('一言は200文字までです');
    const p = db.case_phases.find(x => x.id === phaseId && x.org_id === ORG_ID);
    if (!p) throw P0001('この対応が見つかりません');
    const c = caseOf(p.case_id);
    if (!c || c.deleted_at) throw P0001('この案件は削除されています');
    if (p.late_at && Date.parse(p.late_at) > Date.now() - 120000) throw P0001('さきほど報告しました。少し待ってからもう一度お試しください');
    const at = nowIso();
    p.late_at = at; p.late_by = by; p.updated_at = at;
    const seq = db.case_phases.filter(x => x.case_id === p.case_id && x.kind === p.kind
      && (x.created_at < p.created_at || (x.created_at === p.created_at && x.id <= p.id))).length;
    const label = lateLabel(m);
    const room = String(c.room || '').trim();
    const roomHead = room ? (/[0-9０-９A-Za-zＡ-Ｚａ-ｚ]$/.test(room) ? room + '号室' : room) : '';
    const jst = p.scheduled_at ? new Date(Date.parse(p.scheduled_at) + 9 * 3600000) : null;
    const when = jst ? '（予定 ' + (jst.getUTCMonth() + 1) + '/' + jst.getUTCDate() + ' ' + pad(jst.getUTCHours()) + ':' + pad(jst.getUTCMinutes()) + '）' : '';
    const body = (n ? '一言: ' + n + '\n' : '') + '案件: ' + [String(c.name || '').trim(), roomHead].filter(Boolean).join(' ') + '\n'
      + '対応: ' + phaseTitleOf(p.id) + when + '\n'
      + '報告: ' + who + (viaShare ? '（担当者URL）' : '');
    db.staff_messages.push({ id: uuid(), org_id: ORG_ID, case_id: c.id, phase_id: p.id, from_user: by, to_user: null,
      subject: '到着が遅れそうです（' + label + '）', body, attachments: [], read_at: null, reply_to: null, created_at: nowIso(), source: 'late' });
    db.timeline_entries.push({ id: uuid(), org_id: ORG_ID, case_id: c.id, type: 'system', attachments: [], audiences: [], resolved_at: null,
      body: who + 'が到着の遅れを報告した（' + label + '）', created_by: null, created_at: nowIso() });
    return { ok: true, late_at: at, label, residents: caseResidents(c) };
  }
  async function shareReportLate(args) {
    const sh = await findShare(args.p_token);
    if (!sh) throw P0001('このURLは無効か期限切れです');
    const r = db.reports.find(x => x.id === sh.report_id);
    if (r.status !== 'draft') throw P0001('この報告書はすでに提出されています');
    if (!r.phase_id) throw P0001('この報告書では到着の遅れを報告できません。依頼元の会社に電話でご連絡ください');
    const v = String(sh.vendor_name || '').trim();
    return phaseLate(r.phase_id, null, v ? '担当者「' + v + '」' : '担当者', args.p_minutes, args.p_note, true);
  }
  // migration 052 の share_request_photo_ok と同じ判定（依頼内容に載っている写真で、その案件に使える担当者URLがある）
  // migration 055: ヘッダ x-share-token のトークンが、その案件の使える担当者URLのものでなければ false
  async function shareRequestPhotoOk(name, tok) {
    const seg = String(name == null ? '' : name).split('/');
    if (typeof tok !== 'string' || !/^[A-Za-z0-9_-]{20,200}$/.test(tok)) return false;
    if (seg.length !== 5 || seg[1] !== 'cases' || seg[3] !== 'request' || !UUID_RE.test(seg[0]) || !UUID_RE.test(seg[2])
      || !/^[A-Za-z0-9_-][A-Za-z0-9._-]{0,159}$/.test(seg[4]) || !/\.jpe?g$/i.test(seg[4])) return false;
    const c = db.cases.find(x => x.id === seg[2] && x.org_id === seg[0] && !x.deleted_at);
    if (!c || !c.request || !Array.isArray(c.request.photos) || !c.request.photos.some(x => x && x.path === name)) return false;
    const h = await shareHash(tok);
    return db.report_shares.some(sh => {
      if (sh.token != null ? sh.token !== tok : sh.token_hash !== h) return false;
      const r = db.reports.find(x => x.id === sh.report_id);
      return r && r.case_id === c.id && r.org_id === c.org_id && r.status === 'draft' && shareLive(sh);
    });
  }
  // migration 010 の share_upload_ok と同じ判定
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  function shareUploadOk(name) {
    const seg = String(name == null ? '' : name).split('/');
    if (seg.length !== 7 || seg[1] !== 'cases' || seg[3] !== 'reports'
      || !UUID_RE.test(seg[0]) || !UUID_RE.test(seg[2]) || !UUID_RE.test(seg[4])
      || seg[5].slice(0, 6) !== 'share-' || !UUID_RE.test(seg[5].slice(6))
      || !/^[A-Za-z0-9_-][A-Za-z0-9._-]{0,119}$/.test(seg[6]) || !/\.jpe?g$/i.test(seg[6])) return false;
    const sid = seg[5].slice(6);
    const ok = db.report_shares.some(sh => {
      const r = db.reports.find(x => x.id === sh.report_id);
      return sh.id === sid && r && r.id === seg[4] && r.case_id === seg[2] && r.org_id === seg[0]
        && shareLive(sh) && r.status === 'draft';
    });
    if (!ok) return false;
    const dir = seg.slice(0, 6).join('/') + '/';
    let n = 0;
    for (const p of files.keys()) if (p.startsWith(dir)) n++;
    return n < 100;
  }
  // migration 032 の _photo_marks_clean と同じ: 無し/null → []、正しければ決まったキーだけで作り直す、不正なら null
  function sharePhotoMarksClean(p) {
    if (p == null) return [];
    if (!Array.isArray(p) || p.length > 20) return null;
    const in01 = (m, keys) => keys.every(k => typeof m[k] === 'number' && m[k] >= 0 && m[k] <= 1);
    const out = [];
    for (const m of p) {
      if (!m || typeof m !== 'object' || Array.isArray(m)) return null;
      if (!['circle', 'arrow', 'text'].includes(m.type)) return null;
      if (m.color != null && m.color !== '#e0001b') return null;
      if (m.type === 'circle') {
        if (!in01(m, ['x', 'y', 'w', 'h']) || m.x + m.w > 1.0001 || m.y + m.h > 1.0001) return null;
        out.push({ type: 'circle', x: m.x, y: m.y, w: m.w, h: m.h, color: '#e0001b' });
      } else if (m.type === 'arrow') {
        if (!in01(m, ['x1', 'y1', 'x2', 'y2'])) return null;
        out.push({ type: 'arrow', x1: m.x1, y1: m.y1, x2: m.x2, y2: m.y2, color: '#e0001b' });
      } else {
        if (!in01(m, ['x', 'y']) || typeof m.text !== 'string') return null;
        const t = m.text.replace(/[\r\n\t]+/g, ' ').trim();
        const n = Array.from(t).length;
        if (n < 1 || n > 40) return null;
        out.push({ type: 'text', x: m.x, y: m.y, text: t, color: '#e0001b' });
      }
    }
    return out;
  }
  async function shareSubmit(args) {
    const sh = await findShare(args.p_token);
    if (!sh) throw P0001('このURLは無効か期限切れです');
    const r = db.reports.find(x => x.id === sh.report_id);
    if (r.status !== 'draft') throw P0001('この報告書はすでに提出されています');
    const c = caseOf(r.case_id), o = db.orgs.find(x => x.id === r.org_id);
    const prefix = sharePrefix(o, c, r, sh);
    const p = args.p_payload == null ? {} : args.p_payload;
    if (JSON.stringify(p).length > 1000000) throw P0001('送信内容が大きすぎます');
    const rec = r.work_type === 'site_check'; // 083: 現地確認の記録は号室・作業日なし（作った時の値のまま）
    if (!rec && (String(p.room == null ? '' : p.room).trim() === '' || p.work_date == null)) throw P0001('号室と作業日は必須です');
    const data = p.data == null ? {} : p.data;
    const photos = p.photos == null ? [] : p.photos;
    if (typeof data !== 'object' || Array.isArray(data) || !Array.isArray(photos) || photos.length > 100) throw P0001('送信内容が不正です');
    { const err = reportDataCheck(data, r.work_type); if (err) throw P0001(err); } // migration 037
    if (!(rec && p.work_date == null) && !/^\d{4}-\d{2}-\d{2}$/.test(String(p.work_date))) throw pgErr(`invalid input syntax for type date: "${p.work_date}"`, '22007');
    const out = [];
    let total = 0;
    for (const ph of photos) {
      const path = ph && ph.path != null ? String(ph.path) : null;
      const had = path != null && (r.photos || []).some(x => x && x.path === path); // 057: 報告書に入っている写真はそのまま出し直せる
      if (path == null || (!had && path.slice(0, prefix.length) !== prefix)) throw P0001('写真の保存先が不正です');
      if (out.some(x => x.path === path)) throw P0001('同じ写真が重複しています');
      const b = files.get(path);
      if (!b) throw P0001('写真のアップロードが完了していません');
      if (b.type !== 'image/jpeg') throw P0001('写真の形式が不正です');
      const marks = sharePhotoMarksClean(ph.marks); // migration 032
      if (marks == null) throw P0001('写真の印が不正です');
      // migration 038: 写真の区分
      if ((ph.phase != null && typeof ph.phase !== 'string') || (ph.phaseNote != null && typeof ph.phaseNote !== 'string')) throw P0001('写真の区分が不正です');
      const rawPh = (ph.phase || '').trim();
      const phase = rawPh === '' ? '' : ['wbefore', 'wduring', 'wafter', 'key', 'free'].includes(rawPh) ? rawPh
        : { before: 'wbefore', yojo: 'wbefore', investigating: 'wduring', done: 'wafter' }[rawPh];
      if (phase == null) throw P0001('写真の区分が不正です');
      if (!had) total += b.size; // 057: 前から入っている写真は数え直さない
      const str = v => (v == null ? '' : String(v));
      const o = { path, name: str(ph.name).slice(0, 120), size: b.size, type: b.type || 'image/jpeg',
        caption: str(ph.caption).slice(0, 200), phase };
      if (phase === 'free' && str(ph.phaseNote).trim()) o.phaseNote = Array.from(str(ph.phaseNote).trim()).slice(0, 30).join('');
      if (marks.length) o.marks = marks;
      out.push(o);
    }
    const u = db.org_usage.find(x => x.org_id === o.id);
    if (!u) throw P0001('容量情報がありません');
    const lim = { free: 1073741824, entry: 107374182400, standard: 536870912000 }[o.plan];
    if (lim != null && u.storage_bytes + total > lim) throw P0001('容量の上限に達しています。会社の管理者に連絡してください');
    const left = (v, n) => (v == null ? null : String(v).slice(0, n));
    const now = nowIso();
    sh.submitted_at = now; // 011: 先に share を提出済みにしてから reports を更新する
    Object.assign(r, {
      room: rec ? (left(p.room, 40) || r.room) : left(p.room, 40), work_date: rec ? (p.work_date != null ? String(p.work_date) : r.work_date || nowIso().slice(0, 10)) : String(p.work_date), time_start: left(p.time_start, 5), time_end: left(p.time_end, 5),
      data: clone(data), photos: out, worker_id: null, worker_name: String(sh.vendor_name || '').trim() === '' ? null : sh.vendor_name,
      status: 'submitted', submitted_at: now, submitted_by: null, submitted_via: 'share', updated_at: now
    });
    { // migration 040 reports_share_worker: 名前がメンバーの表示名と1人だけ一致 → worker_id
      const nm = String(sh.vendor_name || '').trim();
      const hit = db.memberships.filter(m => m.org_id === r.org_id && String(m.display_name || '').trim() !== '' && String(m.display_name).trim() === nm);
      if (hit.length === 1) r.worker_id = hit[0].user_id;
    }
    reportNextAction(r); // migration 037
    reportPhaseDone(r); // migration 034
    reportReeditAfter(r); // migration 057
    reportSiteCheckSent(r); // migration 083
    u.storage_bytes += total;
    u.updated_at = now;
    db.timeline_entries.push({ id: uuid(), org_id: o.id, case_id: c.id, type: 'system', attachments: [], resolved_at: null,
      body: (String(sh.vendor_name || '').trim() === '' ? '担当者' : '担当者「' + sh.vendor_name + '」')
        + (rec ? 'がURLから現地確認の記録を' + (r.reedit_count ? '再' : '') + '送信した' : 'がURLから報告書を提出した'), // migration 044・083
      created_by: null, created_at: nowIso() });
    // migration 021: 次やること（case_actions）への「報告書を確認する」の自動追加はしない（確認待ちは報告書の状態で分かる）
    return { ok: true };
  }
  // ---- migration 057（Task 35）: 提出後の再編集・減額の版の取り消し ----
  const KIND_JA = { site_check: '現地確認', survey: '調査', cause: '原因元工事', repair: '復旧工事' };
  function phaseTitleOf(phaseId) {
    const p = phaseId ? db.case_phases.find(x => x.id === phaseId) : null;
    if (!p) return '';
    if (p.kind === 'other') return 'その他（' + (String(p.label || '').trim() || '名前なし') + '）'; // migration 058（回目なし）
    const seq = db.case_phases.filter(x => x.case_id === p.case_id && x.kind === p.kind
      && (x.created_at < p.created_at || (x.created_at === p.created_at && x.id <= p.id))).length;
    // 083: 1回目は回目なし・Task 64 の工事の表題は括弧
    return KIND_JA[p.kind] + (seq > 1 ? ' ' + seq + '回目' : '') + (['cause', 'repair'].includes(p.kind) && String(p.label || '').trim() ? '（' + String(p.label).trim() + '）' : '');
  }
  function caseLine(caseId) {
    const c = caseOf(caseId) || {};
    const room = String(c.room || '').trim();
    const rh = room ? (/[0-9０-９A-Za-zＡ-Ｚａ-ｚ]$/.test(room) ? room + '号室' : room) : '';
    return '案件: ' + [String(c.name || '').trim(), rh].filter(Boolean).join(' ');
  }
  const reeditMsg = (caseId, phaseId, subject, body, from) => db.staff_messages.push({ id: uuid(), org_id: ORG_ID, case_id: caseId, phase_id: phaseId || null,
    from_user: from, to_user: null, subject: Array.from(subject).slice(0, 100).join(''), body: Array.from(body).slice(0, 4000).join(''), attachments: [],
    read_at: null, reply_to: null, created_at: nowIso(), source: 'reedit' });
  const reeditTl = (caseId, body) => db.timeline_entries.push({ id: uuid(), org_id: ORG_ID, case_id: caseId, type: 'system', attachments: [], audiences: [],
    resolved_at: null, body, created_by: null, created_at: nowIso() });
  const isCaseDeleted = id => { const c = caseOf(id); return !!(c && c.deleted_at); };
  function reportReeditCore(r, uid, name, shareId) {
    if (r.status === 'sent') throw P0001('依頼元へ送付済みのため再編集できません。直したいときは管理者に連絡してください');
    if (!['submitted', 'confirmed'].includes(r.status)) throw P0001('この報告書はまだ提出されていません（そのまま編集できます）');
    if (isCaseDeleted(r.case_id)) throw P0001('この案件は削除されています');
    db.mail_drafts = db.mail_drafts.filter(d => !(d.report_id === r.id && d.status === 'draft' && (d.purpose === 'report' || d.purpose == null) && !d.estimate_id));
    const nm = String(name || '').trim() || '作業担当者';
    Object.assign(r, { status: 'draft', confirmed_at: null, confirmed_by: null, reedit_count: (r.reedit_count || 0) + 1, reedit_at: nowIso(),
      reedit_by: uid, reedit_by_name: nm, reedit_mark: true, updated_at: nowIso() });
    let sh = shareId ? db.report_shares.find(x => x.id === shareId) : null;
    if (!sh && r.submitted_via === 'share') {
      sh = db.report_shares.filter(x => x.report_id === r.id && !x.revoked_at && x.submitted_at)
        .sort((a, b) => (a.submitted_at < b.submitted_at ? 1 : -1))[0] || null;
    }
    if (sh && !db.report_shares.some(x => x.report_id === r.id && x.id !== sh.id && !x.revoked_at && !x.submitted_at)) sh.submitted_at = null;
    const title = phaseTitleOf(r.phase_id);
    const doc = r.work_type === 'site_check' ? (title || '現地確認') + 'の記録' : '報告書' + (title ? '（' + title + '）' : ''); // 083
    reeditMsg(r.case_id, r.phase_id, doc + 'を再編集します', caseLine(r.case_id) + '\n' + (title ? '対応: ' + title + '\n' : '')
      + '再編集した人: ' + nm + '\n提出し直すまで「再編集中」と表示されます。', uid);
    reeditTl(r.case_id, nm + 'が' + doc + 'を再編集にした（提出を取り消して直す）');
    return { ok: true, id: r.id, status: 'draft', reedit_count: r.reedit_count };
  }
  function reportReedit(args) {
    const r = db.reports.find(x => x.id === (args && args.p_id) && x.org_id === ORG_ID);
    if (!r) throw P0001('報告書が見つかりません');
    const ph = r.phase_id ? db.case_phases.find(x => x.id === r.phase_id) : null;
    if (!(myRole() === 'owner' || user.id === r.submitted_by || user.id === r.worker_id || (ph && user.id === ph.worker_id))) {
      throw pgErr('この報告書を再編集にできるのは、作業担当者と管理者だけです', '42501');
    }
    return reportReeditCore(r, user.id, (memberOf(user.id) || {}).display_name || '作業担当者', null);
  }
  async function findShareAny(token) {
    const h = await shareHash(token);
    const sh = db.report_shares.find(x => (x.token != null ? x.token === String(token) : x.token_hash === h) && !x.revoked_at
      && (x.expires_at == null || Date.parse(x.expires_at) > Date.now())) || null;
    if (sh && db.report_shares.some(x => x.report_id === sh.report_id && x.id !== sh.id && !x.revoked_at && x.created_at > sh.created_at)) return null;
    return sh;
  }
  async function shareState(args) {
    const sh = await findShareAny(args.p_token);
    if (!sh) throw P0001('このURLは無効か期限切れです');
    const r = db.reports.find(x => x.id === sh.report_id);
    const o = db.orgs.find(x => x.id === r.org_id);
    return { status: r.status, can_reedit: ['submitted', 'confirmed'].includes(r.status) && !isCaseDeleted(r.case_id), org: { name: o.name }, submitted_at: r.submitted_at || null,
      work_type: r.work_type }; // 083
  }
  async function shareReedit(args) {
    const sh = await findShareAny(args.p_token);
    if (!sh) throw P0001('このURLは無効か期限切れです');
    const r = db.reports.find(x => x.id === sh.report_id);
    const nm = String(sh.vendor_name || '').trim();
    return reportReeditCore(r, null, nm ? nm + '（担当者URL）' : '担当者（URL）', sh.id);
  }
  // migration 083: 現地確認の記録の送信 → 管理者への自動の連絡（1回目 report_submit・再編集のあと reedit「再送信しました」）
  const SITE_CHECK_ITEM = '工事の見積書に記載されている範囲の写真は撮影しているか';
  function reportSiteCheckSent(r) {
    if (r.work_type !== 'site_check') return;
    const title = phaseTitleOf(r.phase_id);
    const nm = v => (v == null || !String(v).trim() ? null : String(v).trim());
    const who = nm(r.worker_name) || (r.worker_id && memberOf(r.worker_id) ? nm(memberOf(r.worker_id).display_name) : null)
      || (r.submitted_by && memberOf(r.submitted_by) ? nm(memberOf(r.submitted_by).display_name) : null) || '作業担当者';
    const d = r.data || {};
    const ok = Array.isArray(d.workChecklist) && d.workChecklist.includes(SITE_CHECK_ITEM);
    const note = String(d.f1 || '').trim();
    const body = caseLine(r.case_id) + '\n' + (title ? '対応: ' + title + '\n' : '') + '送信: ' + who + (r.submitted_via === 'share' ? '（担当者URL）' : '') + '\n'
      + '写真: ' + (Array.isArray(r.photos) ? r.photos.length : 0) + '枚\n見積書の範囲の写真: ' + (ok ? '撮影した' : 'チェックなし') + (note ? '\n申し送り: ' + note : '');
    db.staff_messages.push({ id: uuid(), org_id: ORG_ID, case_id: r.case_id, phase_id: r.phase_id || null,
      from_user: r.submitted_via === 'share' ? null : (signedIn ? user.id : null), to_user: null,
      subject: Array.from('現地確認の記録を' + (r.reedit_count > 0 ? '再送信' : '送信') + 'しました' + (title ? '（' + title + '）' : '')).slice(0, 100).join(''),
      body: Array.from(body).slice(0, 4000).join(''), attachments: [], read_at: null, reply_to: null, created_at: nowIso(),
      source: r.reedit_count > 0 ? 'reedit' : 'report_submit' });
  }
  function reportReeditAfter(r) {
    if (!r.reedit_mark) return;
    if (r.work_type === 'site_check') return; // 083: reportSiteCheckSent が「再送信しました」
    const n = r.data && r.data.nextAction;
    if (r.work_type === 'investigate' && n && typeof n === 'object' && ['cause', 'resurvey'].includes(n.type)) return; // reports_next_action が送る
    const title = phaseTitleOf(r.phase_id);
    const nm = v => (v == null || !String(v).trim() ? null : String(v).trim());
    const who = nm(r.worker_name) || (r.worker_id && memberOf(r.worker_id) ? nm(memberOf(r.worker_id).display_name) : null)
      || (r.submitted_by && memberOf(r.submitted_by) ? nm(memberOf(r.submitted_by).display_name) : null) || '作業担当者';
    reeditMsg(r.case_id, r.phase_id, '報告書を再提出しました' + (title ? '（' + title + '）' : ''),
      caseLine(r.case_id) + '\n' + (title ? '対応: ' + title + '\n' : '') + '提出: ' + who + (r.submitted_via === 'share' ? '（担当者URL）' : '')
      + '\n再編集 ' + r.reedit_count + '回目のあとの提出です。内容を確かめてください。', r.submitted_via === 'share' ? null : (signedIn ? user.id : null));
  }
  const estNo = e => (e.number || '番号なし') + (e.version >= 2 ? '-v' + e.version : '');
  function estimateReeditAfter(e) {
    const title = phaseTitleOf(e.phase_id);
    reeditMsg(e.case_id, e.phase_id, '見積書を再提出しました（' + estNo(e) + '）', caseLine(e.case_id) + '\n' + (title ? '対応: ' + title + '\n' : '')
      + '見積番号: ' + estNo(e) + '・見積金額: ¥' + Number(e.total).toLocaleString('en-US') + '（税込）\n提出: ' + ((memberOf(user.id) || {}).display_name || '作業担当者')
      + '\n再編集 ' + e.reedit_count + '回目のあとの提出です。内容を確かめてから依頼元へ送付してください。', user.id);
  }
  function estimateReedit(args) {
    const e = db.estimates.find(x => x.id === (args && args.p_id) && x.org_id === ORG_ID);
    if (!e) throw P0001('見積書が見つかりません');
    const ph = e.phase_id ? db.case_phases.find(x => x.id === e.phase_id) : null;
    if (!(myRole() === 'owner' || user.id === e.created_by || (ph && user.id === ph.worker_id))) throw pgErr('この見積書を再編集にできるのは、作業担当者と管理者だけです', '42501');
    if (['sent', 'accepted'].includes(e.status)) throw P0001('依頼元へ送付済みのため再編集できません。直したいときは管理者に連絡してください');
    if (e.status === 'superseded' || db.estimates.some(x => x.series_id === e.series_id && x.version > e.version)) throw P0001('これは古い版です。最新の版を開いてください');
    if (e.status !== 'issued') throw P0001('この見積書はまだ提出されていません（そのまま編集できます）');
    if (isCaseDeleted(e.case_id)) throw P0001('この案件は削除されています');
    const nm = (memberOf(user.id) || {}).display_name || '作業担当者';
    db.mail_drafts = db.mail_drafts.filter(d => !(d.estimate_id === e.id && d.status === 'draft'));
    Object.assign(e, { status: 'draft', issued_at: null, reedit_count: (e.reedit_count || 0) + 1, reedit_at: nowIso(), reedit_by: user.id,
      reedit_by_name: nm, reedit_mark: true, updated_at: nowIso() });
    const title = phaseTitleOf(e.phase_id);
    reeditMsg(e.case_id, e.phase_id, '見積書を再編集します（' + estNo(e) + '）', caseLine(e.case_id) + '\n' + (title ? '対応: ' + title + '\n' : '')
      + '見積番号: ' + estNo(e) + '（番号はそのまま・同じ版を直します）\n再編集した人: ' + nm + '\n提出し直すまで「再編集中」と表示されます。', user.id);
    reeditTl(e.case_id, nm + 'が見積書（' + estNo(e) + '）を再編集にした（番号はそのまま）');
    return { ok: true, id: e.id, status: 'draft', reedit_count: e.reedit_count };
  }
  function cancelEstimateVersion(args) {
    if (myRole() !== 'owner') throw pgErr('前の版に戻せるのは管理者だけです', '42501');
    const e = db.estimates.find(x => x.id === (args && args.p_id) && x.org_id === ORG_ID);
    if (!e) throw P0001('見積書が見つかりません');
    if (e.status !== 'draft' || e.version < 2 || e.number) throw P0001('まだ提出していない第2版以降の下書きだけ、やめて前の版に戻せます');
    if (db.estimates.some(x => x.series_id === e.series_id && x.version > e.version)) throw P0001('この版より新しい版があります。見積書一覧を開き直してください');
    const pv = db.estimates.find(x => x.series_id === e.series_id && x.version === e.version - 1);
    if (!pv || pv.status !== 'superseded') throw P0001('前の版の状態が変わっています。見積書一覧を開き直してください');
    const st = pv.prev_status || (pv.sent_at ? 'sent' : 'issued');
    db.estimates = db.estimates.filter(x => x.id !== e.id);
    db.mail_drafts.forEach(d => { if (d.estimate_id === e.id) d.estimate_id = null; });
    Object.assign(pv, { status: st, prev_status: null, updated_at: nowIso() });
    if (st === 'sent') pv.reedit_mark = false;
    reeditTl(e.case_id, '見積書（' + (pv.number || '') + '）の第' + e.version + '版（減額対応の下書き）をやめて、第' + pv.version + '版（' + (st === 'sent' ? '送付済み' : '提出済み') + '）に戻した');
    return pv.id;
  }
  const SHARE_RPC = {
    share_open: shareOpen,
    share_submit: shareSubmit,
    share_state: shareState, // migration 057
    share_reedit: shareReedit, // migration 057
    share_upload_ok: async a => shareUploadOk(a.p_name),
    share_report_late: shareReportLate // migration 052
  };
  async function shareRpc(name, args) {
    try { return { data: await SHARE_RPC[name](args || {}), error: null }; }
    catch (e) {
      if (e && e.message !== undefined && !(e instanceof Error)) return { data: null, error: e };
      throw e;
    }
  }

  // ---- migration 053 ----
  const jstParts = iso => { const d = new Date(Date.parse(iso) + 9 * 3600000); return { ymd: d.toISOString().slice(0, 10), m: d.getUTCMonth() + 1, d: d.getUTCDate(), hm: d.toISOString().slice(11, 16) }; };
  // _report_due_at と同じ（調査: 作業終了（報告書の作業日 + time_end。無ければ調査日時 + 3時間）+ 1時間／工事: 工事日の翌々日 0:00 日本時間）
  function reportDueAt(p) {
    if (!p.scheduled_at) return null;
    if (p.kind === 'site_check') { const y = jstParts(p.scheduled_at).ymd; return Date.UTC(+y.slice(0, 4), +y.slice(5, 7) - 1, +y.slice(8, 10) + 1, -9, 0); } // 083: 訪問日の当日中
    if (p.kind === 'survey') {
      const rs = db.reports.filter(r => r.phase_id === p.id && /^\d{1,2}:\d{2}/.test(String(r.time_end || '')))
        .sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : 1));
      const r = rs[rs.length - 1];
      let end;
      if (r) {
        const ymd = r.work_date || jstParts(p.scheduled_at).ymd;
        const [h, mi] = String(r.time_end).split(':').map(Number);
        end = Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10), h - 9, mi);
      } else end = Date.parse(p.scheduled_at) + 3 * 3600000;
      return end + 3600000;
    }
    const endAt = p.scheduled_end && p.scheduled_end > p.scheduled_at ? p.scheduled_end : p.scheduled_at;
    const ymd = jstParts(endAt).ymd;
    return Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10) + 2, -9, 0);
  }
  function phaseReportOverdue(args) {
    const p = db.case_phases.find(x => x.id === (args && args.p_phase) && x.org_id === ORG_ID);
    if (!p) throw P0001('この対応が見つかりません');
    if (p.report_overdue_at) return { ok: false, reason: 'already', at: p.report_overdue_at };
    if (p.lost_at) return { ok: false, reason: 'lost' }; // 066
    if (!p.worker_id && (p.open_call_at || p.open_call_expired_at)) return { ok: false, reason: 'open_call' }; // 070・076: 期限切れで担当が空も
    if (db.phase_task_flags.some(f => f.phase_id === p.id && f.task === 'report' && f.action === 'dismiss' && !f.closed_at)) return { ok: false, reason: 'dismissed' }; // 063
    const c = caseOf(p.case_id);
    if (!c || c.deleted_at || (c.status || 'open') !== 'open') return { ok: false, reason: 'closed' };
    const now = Date.now();
    if (!p.scheduled_at || Date.parse(p.scheduled_at) > now || p.done_at || p.billed_at || p.paid_at
      || db.reports.some(r => r.phase_id === p.id && r.status !== 'draft')) return { ok: false, reason: 'not_due' };
    const due = reportDueAt(p);
    if (due == null || due >= now) return { ok: false, reason: 'not_due' };
    p.report_overdue_at = nowIso();
    const seq = db.case_phases.filter(x => x.case_id === p.case_id && x.kind === p.kind
      && (x.created_at < p.created_at || (x.created_at === p.created_at && x.id <= p.id))).length;
    const title = phaseTitleOf(p.id); // 058: その他は「その他（点検）」
    const dj = jstParts(new Date(due).toISOString());
    const dueText = p.kind === 'survey' ? dj.m + '/' + dj.d + ' ' + String(Number(dj.hm.slice(0, 2))) + ':' + dj.hm.slice(3)
      : (() => { const x = jstParts(new Date(due - 86400000).toISOString()); return x.m + '/' + x.d; })();
    const room = String(c.room || '').trim();
    const roomHead = room ? (/[0-9０-９A-Za-zＡ-Ｚａ-ｚ]$/.test(room) ? room + '号室' : room) : '';
    const sj = jstParts(p.scheduled_at);
    const wk = p.worker_id && memberOf(p.worker_id) ? memberOf(p.worker_id).display_name : '未設定';
    db.staff_messages.push({ id: uuid(), org_id: ORG_ID, case_id: c.id, phase_id: p.id, from_user: null, to_user: null,
      subject: (p.kind === 'site_check' ? '現地確認の記録' : '報告書') + 'の期限を過ぎています（' + title + '）', // 083
      body: '案件: ' + [String(c.name || '').trim(), roomHead].filter(Boolean).join(' ') + '\n対応: ' + title + '（予定 ' + sj.m + '/' + sj.d + ' ' + sj.hm + '）\n'
        + '作業担当者: ' + wk + '\n' + (p.kind === 'site_check' ? '現地確認の記録の期限: ' : '報告書の期限: ') + dueText
        + (p.kind === 'survey' ? '（作業が終わってから1時間以内）' : p.kind === 'site_check' ? '（訪問日の当日中）' : '（工事日の翌日）'),
      attachments: [], read_at: null, reply_to: null, created_at: nowIso(), source: 'overdue', daily_date: null });
    db.timeline_entries.push({ id: uuid(), org_id: ORG_ID, case_id: c.id, type: 'system', attachments: [], audiences: [], resolved_at: null,
      body: title + (p.kind === 'site_check' ? 'の記録' : 'の報告書') + 'が期限（' + dueText + '）を過ぎた（管理者に自動で連絡）', created_by: null, created_at: nowIso() });
    return { ok: true, due_at: new Date(due).toISOString() };
  }
  function staffDailySend(args) {
    const body = String((args && args.p_body) == null ? '' : args.p_body);
    if (!body.trim()) throw P0001('日報の中身がありません');
    if (Array.from(body).length > 4000) throw P0001('日報は4000文字までです');
    const atts = (args && args.p_attachments) || [];
    if (!Array.isArray(atts) || atts.length > 10) throw P0001('写真は10枚までです');
    const prefix = ORG_ID + '/daily/' + user.id + '/';
    if (atts.some(a => !a || typeof a.path !== 'string' || a.path.slice(0, prefix.length) !== prefix || a.path.includes('..'))) throw pgErr('添付の形が不正です', '23514');
    const today = jstParts(nowIso());
    const name = (memberOf(user.id) && String(memberOf(user.id).display_name || '').trim()) || '名前なし';
    const subject = '日報 ' + today.m + '/' + today.d + '（' + name + '）';
    const old = db.staff_messages.find(m => m.source === 'daily' && m.from_user === user.id && m.daily_date === today.ymd);
    if (old) {
      Object.assign(old, { subject, body, attachments: clone(atts), read_at: null, created_at: nowIso() });
      return { ...clone(old), resent: true };
    }
    const row = { id: uuid(), org_id: ORG_ID, case_id: null, phase_id: null, from_user: user.id, to_user: null, subject, body,
      attachments: clone(atts), read_at: null, reply_to: null, created_at: nowIso(), source: 'daily', daily_date: today.ymd };
    db.staff_messages.push(row);
    return { ...clone(row), resent: false };
  }

  // ---- rpc ----
  // 079: open_call_cases（募集中・期限切れ・全体のトークに募集のカードがある対応。入居者・依頼元・金額・報告書・写真は返さない）
  //   081（Task 63）: 募集中（担当が空・失注でない）の対応がある案件だけ 住所・依頼内容（写真なし）、募集中の対応だけ plan（決まったキーだけ）
  const pickKeys = (o, keys) => { const r = {}; keys.forEach(k => { if (o && o[k] != null) r[k] = o[k]; }); return r; };
  function openCallCases() {
    if (myRole() === 'owner') return [];
    const PICK = ['id', 'kind', 'seq', 'label', 'scheduled_at', 'scheduled_end', 'done_at', 'lost_at', 'completed_at', 'worker_id', 'worker_name',
      'open_call_at', 'open_call_by', 'open_call_kind', 'open_call_from', 'open_call_to', 'open_call_expired_at'];
    const hasCard = id => db.staff_messages.some(m => !m.case_id && m.source === 'open_call' && m.meta && m.meta.phase_id === id);
    return db.cases.filter(c => c.org_id === ORG_ID && !c.deleted_at && !caseVisible(c.id)).map(c => {
      const phases = (phaseSummary(c).phases || []).filter(p => p.open_call_at || p.open_call_expired_at || hasCard(p.id)).map(p => {
        const open = !!p.open_call_at && !p.worker_id;
        const o = { case_id: c.id };
        PICK.forEach(k => { o[k] = p[k] === undefined ? null : p[k]; });
        o.schedule = open ? p.schedule || null : null;
        o.estimates = open ? (p.estimates || []).map(e => ({ id: e.id, status: e.status, issued_at: e.issued_at, notes: e.notes })) : [];
        if (open && !p.lost_at) o.plan = pickKeys(p.plan, ['rooms', 'visitRooms', 'visitNote', 'suspects', 'priority', 'note']);
        return o;
      });
      if (!phases.length) return null;
      const row = { id: c.id, org_id: c.org_id, name: c.name, room: c.room, status: c.status, deleted_at: null, assignee_id: null, call_only: true, phases };
      if (phases.some(p => 'plan' in p)) Object.assign(row, { address: c.address == null ? null : c.address, request: pickKeys(c.request, ['text', 'symptoms', 'symptomOther', 'damage', 'suspect', 'items']) }); // 084: items
      return clone(row);
    }).filter(Boolean);
  }
  async function rpc(name, args) {
    await new Promise(r => setTimeout(r, 2));
    window.__fake.calls.push('rpc ' + name);
    if (SHARE_RPC[name]) return shareRpc(name, args);
    // migration 027: お客様ページの portal_open は廃止（anon / authenticated とも実行権なし）
    if (name === 'portal_open') return { data: null, error: pgErr('permission denied for function portal_open', '42501') };
    // ログインしていない（anon）ときに呼べるのは share_* だけ
    if (!signedIn) return { data: null, error: pgErr(`permission denied for function ${name}`, '42501') };
    if (name === 'talk_mark_read') { // 065: 既読の印（見てよいトークだけ）と、そのトークの自分あての未読を既読に
      const cid = args.p_case || null;
      if (cid && !caseOf(cid)) return { data: null, error: pgErr('案件が見つかりません', 'P0002') };
      if (cid && myRole() !== 'owner' && !talkVisible(cid, null, null)) return { data: null, error: pgErr('この案件のトークは見られません', '42501') };
      const at = nowIso();
      const cur = db.talk_reads.find(r => r.user_id === user.id && (r.case_id || null) === cid);
      if (cur) cur.read_at = at; else db.talk_reads.push({ id: uuid(), org_id: ORG_ID, user_id: user.id, case_id: cid, read_at: at });
      db.staff_messages.filter(m => (m.case_id || null) === cid && !m.read_at && m.from_user !== user.id
        && (m.to_user ? m.to_user === user.id : myRole() === 'owner')).forEach(m => { m.read_at = at; });
      return { data: at, error: null };
    }
    // migration 079（Task 57）: 見えない案件の一斉配信のカード・タスクに要る最小限（管理者は空）
    if (name === 'open_call_cases') return { data: openCallCases(), error: null };
    // migration 077（Task 55）: 購読トークンと確定した予定。本人か管理者だけ。window.__fake.calFail = true で失敗させる（画面の「更新に失敗」の確認）
    if (name === 'cal_feed_token' || name === 'cal_feed_events') {
      const uid = args.p_user;
      if (!memberOf(uid) || (uid !== user.id && myRole() !== 'owner')) return { data: null, error: pgErr('カレンダーの URL を扱えるのは、本人と管理者だけです', '42501') };
      if (window.__fake.calFail) return { data: null, error: pgErr('fake: カレンダーの関数が失敗しました', 'XX000') };
      const cur = db.calendar_feeds.find(f => f.user_id === uid);
      if (name === 'cal_feed_events') {
        if (!cur) return { data: { org_id: ORG_ID, token: null, events: [] }, error: null };
        const events = db.case_phases.filter(p => p.worker_id === uid && p.scheduled_at && !p.lost_at && !p.done_at && !p.completed_at && caseOf(p.case_id) && !isCaseDeleted(p.case_id))
          .sort((x, y) => Date.parse(x.scheduled_at) - Date.parse(y.scheduled_at) || String(x.id).localeCompare(String(y.id)))
          .map(p => { const c = caseOf(p.case_id); const room = String(c.room || '').trim();
            const rh = room ? (/[0-9０-９A-Za-zＡ-Ｚａ-ｚ]$/.test(room) ? room + '号室' : room) : '';
            return { id: p.id, start: p.scheduled_at, end: p.scheduled_end || null, address: c.address || null,
              title: [String(c.name || '').trim(), rh, phaseTitleOf(p.id)].filter(Boolean).join(' ') }; });
        return { data: { org_id: ORG_ID, token: cur.token, events }, error: null };
      }
      const mode = args.p_mode || 'get';
      if (!['get', 'create', 'rotate'].includes(mode)) return { data: null, error: P0001('指定が正しくありません') };
      if (mode === 'get' || (mode === 'create' && cur)) return { data: { org_id: ORG_ID, token: cur ? cur.token : null, old_token: null }, error: null };
      const tok = uuid().replace(/-/g, ''), old = cur ? cur.token : null;
      // 080: 作り直すと前のトークンを prev_token に
      if (cur) Object.assign(cur, { token: tok, prev_token: cur.token, rotated_at: nowIso() }); else db.calendar_feeds.push({ user_id: uid, org_id: ORG_ID, token: tok, created_at: nowIso(), rotated_at: null });
      return { data: { org_id: ORG_ID, token: tok, old_token: old }, error: null };
    }
    if (name === 'issue_estimate') {
      try { return { data: issueEstimate(args), error: null }; }
      catch (e) { if (e && e.message !== undefined && !(e instanceof Error)) return { data: null, error: e }; throw e; }
    }
    if (name === 'new_estimate_version') {
      try { return { data: newEstimateVersion(args), error: null }; }
      catch (e) { if (e && e.message !== undefined && !(e instanceof Error)) return { data: null, error: e }; throw e; }
    }
    // migration 057（Task 35）
    const T35 = { report_reedit: reportReedit, estimate_reedit: estimateReedit, cancel_estimate_version: cancelEstimateVersion };
    if (T35[name]) {
      try { return { data: T35[name](args || {}), error: null }; }
      catch (e) { if (e && e.message !== undefined && !(e instanceof Error)) return { data: null, error: e }; throw e; }
    }
    if (name === 'phase_nudge') { // migration 052: 作業担当者への催促
      try {
        const p = db.case_phases.find(x => x.id === args.p_phase && x.org_id === ORG_ID);
        if (!p) throw P0001('この対応が見つかりません');
        const c = caseOf(p.case_id);
        if (!c || c.deleted_at) throw P0001('この案件は削除されています');
        if (p.lost_at) throw P0001('この対応は失注です（催促できません）'); // 066
        if (!p.worker_id) throw P0001('作業担当者が決まっていません');
        if (p.worker_id === user.id) throw P0001('自分には催促できません');
        const text = String(args.p_text == null ? '' : args.p_text).trim();
        if (!text || Array.from(text).length > 80) throw P0001('催促の内容（今の段階）は1〜80文字です');
        const note = String(args.p_note == null ? '' : args.p_note).trim();
        if (Array.from(note).length > 500) throw P0001('一言は500文字までです');
        const me = (memberOf(user.id) || {}).display_name || '管理者';
        const wk = (memberOf(p.worker_id) || {}).display_name || '作業担当者';
        const seq = db.case_phases.filter(x => x.case_id === p.case_id && x.kind === p.kind
          && (x.created_at < p.created_at || (x.created_at === p.created_at && x.id <= p.id))).length;
        const room = String(c.room || '').trim();
        const roomHead = room ? (/[0-9０-９A-Za-zＡ-Ｚａ-ｚ]$/.test(room) ? room + '号室' : room) : '';
        const at = nowIso();
        p.nudged_at = at; p.nudge_count = (Number(p.nudge_count) || 0) + 1; p.updated_at = at;
        db.staff_messages.push({ id: uuid(), org_id: ORG_ID, case_id: c.id, phase_id: p.id, from_user: user.id, to_user: p.worker_id,
          subject: Array.from('⚠️ 催促: ' + text).slice(0, 100).join(''),
          body: (note ? '一言: ' + note + '\n' : '') + '案件: ' + [String(c.name || '').trim(), roomHead].filter(Boolean).join(' ') + '\n'
            + '対応: ' + phaseTitleOf(p.id) + '\n催促した人: ' + me,
          attachments: [], read_at: null, reply_to: null, created_at: nowIso(), source: 'nudge' });
        db.timeline_entries.push({ id: uuid(), org_id: ORG_ID, case_id: c.id, type: 'system', attachments: [], audiences: [], resolved_at: null,
          body: me + 'が' + wk + 'に催促した', created_by: null, created_at: nowIso() });
        return { data: { ok: true, nudged_at: at, nudge_count: p.nudge_count }, error: null };
      } catch (e) { if (e && e.message !== undefined && !(e instanceof Error)) return { data: null, error: e }; throw e; }
    }
    if (name === 'phase_report_overdue') { // migration 053: 報告書の期限超過（1回だけ・管理者あて）
      try { return { data: phaseReportOverdue(args), error: null }; }
      catch (e) { if (e && e.message !== undefined && !(e instanceof Error)) return { data: null, error: e }; throw e; }
    }
    if (name === 'staff_daily_send') { // migration 053: 日報
      try { return { data: staffDailySend(args), error: null }; }
      catch (e) { if (e && e.message !== undefined && !(e instanceof Error)) return { data: null, error: e }; throw e; }
    }
    if (name === 'admin_create_case') { // migration 059: 管理画面の案件作成
      try { return { data: adminCreateCase((args || {}).p), error: null }; }
      catch (e) { if (e && e.message !== undefined && !(e instanceof Error)) return { data: null, error: e }; throw e; }
    }
    if (name === 'field_trash_case') { // migration 062（Task 42）: 現場用で自分が登録した案件の削除
      try { return { data: fieldTrashCase((args || {}).p_case), error: null }; }
      catch (e) { if (e && e.message !== undefined && !(e instanceof Error)) return { data: null, error: e }; throw e; }
    }
    if (name === 'doc_share_sent' || name === 'doc_share_undo') { // migration 085（Task 68）
      try { return { data: (name === 'doc_share_sent' ? docShareSent : docShareUndo)(args || {}), error: null }; }
      catch (e) { if (e && e.message !== undefined && !(e instanceof Error)) return { data: null, error: e }; throw e; }
    }
    if (name === 'phase_set_stage' || name === 'phase_set_payment_due') { // migration 066（Task 47）・067（Task 48）
      try { return { data: (name === 'phase_set_stage' ? phaseSetStage : phaseSetPaymentDue)(args || {}), error: null }; }
      catch (e) { if (e && e.message !== undefined && !(e instanceof Error)) return { data: null, error: e }; throw e; }
    }
    const SCH = { phase_sched_offer: a => schedAct(a.p_phase, 'offer', { cands: a.p_cands, dur: a.p_dur == null ? null : a.p_dur }), // migration 069・072
      phase_sched_conditions: a => schedAct(a.p_phase, 'conditions', a.p_cond),
      phase_sched_pick: a => schedAct(a.p_phase, 'pick', { start: a.p_start }), phase_sched_propose: a => schedAct(a.p_phase, 'propose', { cands: a.p_cands, dur: a.p_dur == null ? null : a.p_dur }),
      phase_sched_confirm: a => schedAct(a.p_phase, 'confirm', { start: a.p_start, end: a.p_end }) };
    if (SCH[name]) {
      try { return { data: SCH[name](args || {}), error: null }; }
      catch (e) { if (e && e.message !== undefined && !(e instanceof Error)) return { data: null, error: e }; throw e; }
    }
    const T51 = { phase_open_call: a => openCallAct(a.p_phase, 'open', null, a), phase_open_call_cancel: a => openCallAct(a.p_phase, 'cancel'), // migration 070・076
      phase_open_call_accept: a => openCallAct(a.p_phase, 'accept', a.p_start || null, a), open_call_expire: () => openCallExpireAll(), open_call_list: () => openCallList() };
    if (T51[name]) {
      try { return { data: T51[name](args || {}), error: null }; }
      catch (e) { if (e && e.message !== undefined && !(e instanceof Error)) return { data: null, error: e }; throw e; }
    }
    const T43 = { field_task_dismiss: fieldTaskDismiss, field_task_sendback: fieldTaskSendback, task_flag_close: taskFlagClose }; // migration 063
    if (T43[name]) {
      try { return { data: T43[name](args || {}), error: null }; }
      catch (e) { if (e && e.message !== undefined && !(e instanceof Error)) return { data: null, error: e }; throw e; }
    }
    if (name === 'field_create_case') { // migration 058（Task 37）: 現場用の案件登録
      try { return { data: fieldCreateCase(args || {}), error: null }; }
      catch (e) { if (e && e.message !== undefined && !(e instanceof Error)) return { data: null, error: e }; throw e; }
    }
    if (name === 'phase_report_late') { // migration 052（ログインしている人。自社のフェーズ）
      try {
        if (!db.case_phases.some(p => p.id === args.p_phase && p.org_id === ORG_ID)) throw P0001('この対応が見つかりません');
        const m = memberOf(user.id);
        return { data: phaseLate(args.p_phase, user.id, (m && String(m.display_name || '').trim()) || '作業担当者', args.p_minutes, args.p_note, false), error: null };
      } catch (e) { if (e && e.message !== undefined && !(e instanceof Error)) return { data: null, error: e }; throw e; }
    }
    if (name === 'undo_case_edit') { // migration 031
      try { return { data: undoCaseEdit(args), error: null }; }
      catch (e) { if (e && e.message !== undefined && !(e instanceof Error)) return { data: null, error: e }; throw e; }
    }
    // migration 078（Task 56）: 管理者のアプリが消したファイルを「消した」にして使用量を減らす（まだの行だけ・二重に減らさない）
    if (name === 'purge_files_done') {
      if (myRole() !== 'owner') return { data: null, error: pgErr('ファイルの片付けは管理者だけができます', '42501') };
      const ids = args.p_ids || [];
      const rows = db.purge_files.filter(f => ids.includes(f.id) && f.org_id === ORG_ID && !f.done_at);
      const at = nowIso();
      rows.forEach(f => { f.done_at = at; });
      const u = db.org_usage[0];
      u.storage_bytes = Math.max(0, u.storage_bytes - rows.reduce((s, f) => s + Number(f.size || 0), 0));
      return { data: rows.length, error: null };
    }
    if (name === 'add_usage') {
      // migration 015: 1回 ±100MB まで・null は例外
      const b = args && args.p_bytes;
      if (b == null || Math.abs(Number(b)) > 104857600) return { data: null, error: P0001('使用量の更新値が範囲外です（1回 ±100MB まで）') };
      window.__fake.calls.push('add_usage ' + b);
      const u = db.org_usage[0];
      u.storage_bytes += Number(args.p_bytes || 0);
      u.record_count += Number(args.p_records || 0);
      return { data: null, error: null };
    }
    return { data: null, error: pgErr(`Could not find the function public.${name}`, 'PGRST202') };
  }

  // ---- storage ----
  const readAsDataUrl = blob => new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(blob);
  });
  const orgOk = path => path.split('/')[0] === ORG_ID; // files_* / public_pdfs_* ポリシー: 先頭フォルダ = 自社 org_id
  const pubOwner = new Map(); // public-pdfs: path -> 上げた人（storage.objects.owner_id）
  // 080: public_pdf_ok — 管理者・上げた本人、calendar.ics は本人の今か1つ前のトークン、PDF はそのメールの案件が見える人
  const pubOk = path => {
    if (myRole() === 'owner' || pubOwner.get(path) === user.id) return true;
    if (/\/calendar\.ics$/.test(path)) { const tok = path.split('/')[1]; return db.calendar_feeds.some(f => f.user_id === user.id && (f.token === tok || f.prev_token === tok)); }
    return db.mail_drafts.some(d => d.pdf_path === path && caseVisible(d.case_id));
  };
  // 読む・一覧・上書き・削除で見えるか（files は 080 の storage_case_ok）
  const objOk = (isPub, path) => orgOk(path) && (isPub ? pubOk(path) : fileCaseOk(path));
  // migration 012: 公開バケット public-pdfs（application/pdf・20MBまで。077 で text/calendar も）。getPublicUrl は期限なしの公開URL（署名・期限パラメータなし）
  const PUBLIC_PDF_BASE = 'https://files.e2e.invalid/storage/v1/object/public/public-pdfs/';
  const storage = {
    from(bucket) {
      if (bucket !== 'files' && bucket !== 'public-pdfs') throw new Error('fake-sb: bucket は files / public-pdfs のみ');
      const isPub = bucket === 'public-pdfs';
      const store = isPub ? pubFiles : files;
      const lbl = isPub ? ' public-pdfs' : '';
      return {
        // supabase-js 2.49 と同じ: options.download（文字列）→ ?download=<名前>、URL 全体を encodeURI
        getPublicUrl(path, options) {
          window.__fake.calls.push('storage.getPublicUrl ' + bucket);
          const d = options && options.download;
          const q = d ? '?download=' + (d === true ? '' : d) : '';
          return { data: { publicUrl: encodeURI((isPub ? PUBLIC_PDF_BASE : 'https://files.e2e.invalid/storage/v1/object/public/files/') + path + q) } };
        },
        async upload(path, blob, opts = {}) {
          await new Promise(r => setTimeout(r, 2));
          window.__fake.calls.push('storage.upload' + lbl);
          window.__fake.uploadOpts.push({ bucket, path, cacheControl: opts.cacheControl === undefined ? null : opts.cacheControl, upsert: !!opts.upsert });
          if (!orgOk(path) || (!isPub && !fileCaseOk(path))) return { data: null, error: { message: 'new row violates row-level security policy', statusCode: '403' } }; // 080: 見えない案件のフォルダ
          if (isPub && store.has(path) && !pubOk(path)) return { data: null, error: { message: 'new row violates row-level security policy', statusCode: '403' } }; // 080: 見えないファイルは上書きできない
          if (isPub) {
            const t = opts.contentType || blob.type || '';
            if (t !== 'application/pdf' && t !== 'text/calendar') return { data: null, error: { message: `mime type ${t} is not supported`, statusCode: '415' } }; // 077: text/calendar（購読ファイル）も
            if (blob.size > BUCKET_MAX) return { data: null, error: { message: 'The object exceeded the maximum allowed size', statusCode: '413' } };
          }
          if (store.has(path) && !opts.upsert) return { data: null, error: { message: 'The resource already exists', statusCode: '409' } };
          store.set(path, blob);
          if (isPub) pubOwner.set(path, user.id);
          return { data: { path }, error: null };
        },
        async createSignedUrl(path, ttl, o) {
          await new Promise(r => setTimeout(r, 2));
          window.__fake.calls.push('storage.createSignedUrl' + lbl);
          if (isPub) return { data: null, error: { message: 'fake-sb: public-pdfs は署名URLを使わない', statusCode: '400' } };
          const b = objOk(isPub, path) ? store.get(path) : null; // 080: 見えない案件のファイルは無いのと同じ
          if (!b) return { data: null, error: { message: 'Object not found', statusCode: '404' } };
          window.__fake.signed.push({ path, ttl, download: (o && o.download) || null });
          // Task 32: 日報の PDF は短い擬似URL（download があれば ?download=<名前>）
          if (/-nippo\.pdf$/.test(path)) return { data: { signedUrl: 'https://files.e2e.invalid/sign/' + encodeURIComponent(path.split('/').pop()) + '?token=T' + window.__fake.signed.length + (o && o.download ? '&download=' + encodeURIComponent(o.download) : '') }, error: null };
          // 報告書PDF（送付メールのリンク）は mailto に入る URL なので短い擬似URLにする（有効秒数も入れる）。写真・ロゴは data URL
          if (/\/report\.pdf$/.test(path)) return { data: { signedUrl: 'https://files.e2e.invalid/sign/' + encodeURIComponent(path.split('/').pop()) + '?token=T' + window.__fake.signed.length + '&exp=' + ttl }, error: null };
          return { data: { signedUrl: await readAsDataUrl(b) }, error: null };
        },
        async remove(paths) {
          await new Promise(r => setTimeout(r, 2));
          window.__fake.calls.push('storage.remove' + lbl);
          // Task 56: window.__fakeFailRemove（パス）を入れると、そのパスを含む削除は失敗する（消し残しを次回もう一度の確認）
          if (window.__fakeFailRemove && paths.includes(window.__fakeFailRemove)) return { data: null, error: { message: 'fake: remove failed', statusCode: '500' } };
          const gone = [];
          for (const p of paths) if (objOk(isPub, p) && store.delete(p)) { pubOwner.delete(p); gone.push({ name: p }); } // 080: 見えないファイルは消えない（0 件）
          return { data: gone, error: null };
        },
        async list(dir, opts = {}) {
          await new Promise(r => setTimeout(r, 2));
          const search = (opts && opts.search) || '';
          const out = [];
          for (const [p, b] of store) {
            const i = p.lastIndexOf('/');
            if (p.slice(0, i) === dir && p.slice(i + 1).includes(search) && objOk(isPub, p)) { // 080: 見えるものだけ一覧
              out.push({ name: p.slice(i + 1), metadata: { size: b.size, mimetype: b.type } });
            }
          }
          return { data: out, error: null };
        }
      };
    }
  };

  // ---- auth ----
  const listeners = [];
  const session = () => (signedIn ? { access_token: 'fake', user } : null);
  const auth = {
    async getUser() {
      return signedIn ? { data: { user }, error: null }
        : { data: { user: null }, error: pgErr('Auth session missing!') };
    },
    async getSession() { return { data: { session: session() }, error: null }; },
    async signInWithPassword(cred) {
      // 本物の認証はしない。偽クライアントはログイン済みで起動する。
      // Task 42: window.__fake.password があれば、ログイン中の人のメールとそのパスワードの組だけ通す（パスワードは記録しない）
      await new Promise(r => setTimeout(r, 2));
      const email = cred && cred.email;
      window.__fake.signIns.push(email);
      if (window.__fake.password != null && !(email === user.email && cred.password === window.__fake.password)) {
        return { data: { user: null, session: null }, error: { name: 'AuthApiError', message: 'Invalid login credentials', status: 400, code: 'invalid_credentials' } };
      }
      signedIn = true;
      listeners.forEach(cb => cb('SIGNED_IN', session()));
      return { data: { user, session: session() }, error: null };
    },
    async signUp() { return { data: null, error: pgErr('fake-sb: signUp は未対応') }; },
    async signOut() { signedIn = false; listeners.forEach(cb => cb('SIGNED_OUT', null)); return { error: null }; },
    async resetPasswordForEmail(email, opts) {
      await new Promise(r => setTimeout(r, 2));
      window.__fake.resetMails.push({ email, redirectTo: opts && opts.redirectTo });
      const e = window.__fake.authErr.reset;
      return e ? { data: null, error: Object.assign({ name: 'AuthApiError', message: 'fake' }, e) } : { data: {}, error: null };
    },
    async updateUser(attrs) {
      await new Promise(r => setTimeout(r, 2));
      if (!signedIn) return { data: { user: null }, error: { name: 'AuthSessionMissingError', message: 'Auth session missing!', status: 400 } };
      const e = window.__fake.authErr.update;
      if (e) return { data: { user: null }, error: Object.assign({ name: 'AuthApiError', message: 'fake' }, e) };
      window.__fake.pwUpdates.push(Object.assign({}, attrs));
      listeners.forEach(cb => cb('USER_UPDATED', session()));
      return { data: { user }, error: null };
    },
    onAuthStateChange(cb) {
      listeners.push(cb);
      if (window.__fakeRecovery) setTimeout(() => cb('PASSWORD_RECOVERY', session()), 0);
      setTimeout(() => cb('INITIAL_SESSION', session()), 0);
      return { data: { subscription: { unsubscribe() { const i = listeners.indexOf(cb); if (i >= 0) listeners.splice(i, 1); } } } };
    }
  };

  // ---- セッションなし（anon）のクライアント: r.html が window.supabase.createClient で作る ----
  const BUCKET_MAX = 20971520;
  const BUCKET_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf', // 075: Excel・CSV（他社の見積もり）
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel', 'text/csv'];
  const anonDenied = t => ({ data: null, error: E.denied(t) });
  class AnonQuery {
    constructor(t) { this.t = t; }
    then(res, rej) {
      window.__fake.calls.push('anon from ' + this.t);
      return new Promise(r => setTimeout(r, 2)).then(() => anonDenied(this.t)).then(res, rej);
    }
  }
  ['select', 'insert', 'update', 'delete', 'upsert', 'eq', 'in', 'is', 'order', 'single', 'maybeSingle', 'limit']
    .forEach(m => { AnonQuery.prototype[m] = function () { return this; }; });
  function anonClient(url, key, opts) {
    window.__fake.anonClients.push({ url, key, opts: clone(opts || null) });
    const hdrTok = opts && opts.global && opts.global.headers ? opts.global.headers['x-share-token'] : undefined;
    const rls = { message: 'new row violates row-level security policy', statusCode: '403' };
    return {
      from: t => new AnonQuery(t),
      async rpc(name, args) {
        await new Promise(r => setTimeout(r, 2));
        window.__fake.calls.push('anon rpc ' + name);
        if (SHARE_RPC[name]) return shareRpc(name, args);
        return { data: null, error: pgErr(`permission denied for function ${name}`, '42501') };
      },
      storage: {
        from(bucket) {
          if (bucket !== 'files') throw new Error('fake-sb: bucket は files のみ');
          return {
            // files_share_insert: INSERT のみ（upsert は UPDATE 権限が要るので不可）
            async upload(path, blob, o = {}) {
              await new Promise(r => setTimeout(r, 2));
              window.__fake.calls.push('anon storage.upload');
              const type = o.contentType || blob.type || '';
              if (blob.size > BUCKET_MAX) return { data: null, error: { message: 'The object exceeded the maximum allowed size', statusCode: '413' } };
              if (!BUCKET_TYPES.includes(type)) return { data: null, error: { message: `mime type ${type} is not supported`, statusCode: '415' } };
              if (o.upsert || !shareUploadOk(path)) return { data: null, error: rls };
              if (files.has(path)) return { data: null, error: { message: 'The resource already exists', statusCode: '409' } };
              files.set(path, new Blob([blob], { type }));
              return { data: { path }, error: null };
            },
            // migration 052: 依頼内容の写真だけ（share_request_photo_ok）。ほかは見つからない扱い
            async createSignedUrl(path, ttl) {
              window.__fake.calls.push('anon storage.createSignedUrl');
              const b = files.get(path);
              if (!b || !(await shareRequestPhotoOk(path, hdrTok))) return { data: null, error: { message: 'Object not found', statusCode: '404' } };
              window.__fake.signed.push({ path, ttl, anon: true });
              return { data: { signedUrl: await readAsDataUrl(b) }, error: null };
            },
            async createSignedUrls(paths, ttl) {
              window.__fake.calls.push('anon storage.createSignedUrls');
              const out = [];
              for (const path of paths || []) {
                const b = files.get(path);
                if (!b || !(await shareRequestPhotoOk(path, hdrTok))) { out.push({ path, signedUrl: null, error: 'Either the object does not exist or you do not have access to it' }); continue; }
                window.__fake.signed.push({ path, ttl, anon: true });
                out.push({ path, signedUrl: await readAsDataUrl(b), error: null });
              }
              return { data: out, error: null };
            },
            async remove() { window.__fake.calls.push('anon storage.remove'); return { data: [], error: null }; },
            async list() { window.__fake.calls.push('anon storage.list'); return { data: [], error: null }; }
          };
        }
      },
      auth: {
        async getSession() { return { data: { session: null }, error: null }; },
        async getUser() { return { data: { user: null }, error: pgErr('Auth session missing!') }; },
        onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; }
      }
    };
  }
  window.supabase = { createClient: anonClient };

  window.__fake = { db, files, pubFiles, calls: [], resetMails: [], pwUpdates: [], signIns: [], authErr: {}, writes: [], uploadOpts: [], signed: [], failInsert: {}, failUpdate: {}, ids: { ORG_ID, U_ME, U_STAFF, C1, C2, K1 }, summaries,
    anonClients: [], shareUploadOk,
    // 現在時刻を v（ISO・ミリ秒。null で実時刻）にする。作成時刻の単調増加もそこから数え直す
    setNow(v) { window.__fakeClock.set(v); lastMs = 0; return new Date().toISOString(); } };

  // テスト用: リロードをまたいで内容を残す。snapshot() で取り出し、次のページ読み込み前に window.__fakeSnapshot へ入れると復元される
  window.__fake.snapshot = async () => ({
    db: JSON.parse(JSON.stringify(db)),
    files: await Promise.all(Array.from(files, async ([p, b]) => [p, await readAsDataUrl(b)])),
    pub: await Promise.all(Array.from(pubFiles, async ([p, b]) => [p, await readAsDataUrl(b)]))
  });
  if (window.__fakeSnapshot) {
    const snap = window.__fakeSnapshot;
    for (const k of Object.keys(snap.db)) { if (!db[k]) db[k] = []; db[k].length = 0; db[k].push(...snap.db[k]); }
    for (const [store, list] of [[files, snap.files], [pubFiles, snap.pub || []]]) {
      store.clear();
      for (const [p, url] of list) {
        const m = /^data:([^;,]*)(;base64)?,(.*)$/.exec(url);
        const bin = atob(m[3]);
        const arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        store.set(p, new Blob([arr], { type: m[1] }));
      }
    }
  }

  // ---- Edge Function（Task 19: parse-estimate-pdf）----
  // 本物の AI は呼ばない。window.__fake.ai で返し方を切り替える:
  //   'ok'（既定）= 固定の読み取り結果 FAKE_AI ／ 'not_configured' = 503「準備ができていません」／ 'missing' = 404（関数が無い）
  // 呼ばれた記録は window.__fake.aiCalls（バイト数・Content-Type・ログイン中か）
  const FAKE_AI = {
    subject: 'サンプルハイツ 101号室 給水管修理', total: 107800, total_ex: 98000, notes: '',
    items: [
      { description: '給水管交換', detail: '浴室天井内', quantity: 1, unit: '式', unit_price: 45000, amount: 45000 },
      { description: '天井ボード張替え', detail: '', quantity: 6, unit: '㎡', unit_price: 5500, amount: 33000 },
      { description: '養生・清掃', detail: '', quantity: 1, unit: '式', unit_price: 20000, amount: 20000 }
    ]
  };
  const functions = {
    async invoke(name, opts = {}) {
      await new Promise(r => setTimeout(r, 30));
      const body = opts.body;
      const size = body && typeof body.size === 'number' ? body.size : 0;
      window.__fake.aiCalls.push({ name, size, type: (opts.headers || {})['Content-Type'] || '', signedIn });
      const httpErr = (status, j) => ({ data: null, error: { name: 'FunctionsHttpError', message: 'Edge Function returned a non-2xx status code',
        context: new Response(JSON.stringify(j), { status, headers: { 'Content-Type': 'application/json' } }) } });
      if (name !== 'parse-estimate-pdf' || window.__fake.ai === 'missing') return httpErr(404, { message: 'Requested function was not found' });
      if (!signedIn) return httpErr(401, { error: 'ログインしてください', code: 'auth' });
      if (window.__fake.ai === 'not_configured') return httpErr(503, { error: 'AI読み取りの準備ができていません（管理者が Supabase の Secrets に ANTHROPIC_API_KEY を登録すると使えます）', code: 'not_configured' });
      if (size > 20971520) return httpErr(413, { error: 'PDFは20MBまでです', code: 'too_large' });
      return { data: Object.assign(clone(FAKE_AI), { model: 'claude-haiku-5-5' }), error: null };
    }
  };
  window.__fake.aiCalls = [];
  window.__fake.FAKE_AI = FAKE_AI;

  // ---- Task 70: Google Routes API（routes.googleapis.com）は本物につながず横取りする ----
  //   window.__fake.routes = { '出発の住所|着く住所': 秒数 }（無い組み合わせは 1800秒）。window.__fake.routesFail = true で 403
  //   呼ばれた記録は window.__fake.routeCalls（url・headers・body。キーは hasKey / keyTail（末尾4文字）だけ残す）
  window.__fake.routes = {};
  window.__fake.routeCalls = [];
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input && input.url;
    if (!String(url || '').startsWith('https://routes.googleapis.com/')) return realFetch(input, init);
    const h = (init && init.headers) || {};
    const body = JSON.parse((init && init.body) || '{}');
    const k = h['X-Goog-Api-Key'] || '';
    window.__fake.routeCalls.push({ url, method: init && init.method, fieldMask: h['X-Goog-FieldMask'], hasKey: !!k, keyTail: String(k).slice(-4), body });
    await new Promise(r => setTimeout(r, 30));
    if (window.__fake.routesFail) return new Response(JSON.stringify({ error: { code: 403, message: 'denied' } }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    const sec = window.__fake.routes[body.origin.address + '|' + body.destination.address];
    return new Response(JSON.stringify({ routes: [{ duration: (sec == null ? 1800 : sec) + 's', distanceMeters: 12345 }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  return { from: t => new Query(t), rpc, storage, auth, functions };
})();
