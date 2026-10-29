# 一起點名維護手冊

## 正式入口

[原首頁](https://pingchentw.github.io/chlife-attendance-helper/) 自動進入第六大組。未帶 `group` 的 `reports.html` 也進入第六大組；帶有 `group` 的連結保留原指定大組，不會被六大組覆蓋。

| 大組 | 專屬入口 |
| --- | --- |
| 一 | https://pingchentw.github.io/chlife-attendance-helper/?group=1 |
| 二 | https://pingchentw.github.io/chlife-attendance-helper/?group=2 |
| 三 | https://pingchentw.github.io/chlife-attendance-helper/?group=3 |
| 四 | https://pingchentw.github.io/chlife-attendance-helper/?group=4 |
| 五 | https://pingchentw.github.io/chlife-attendance-helper/?group=5 |
| 六 | https://pingchentw.github.io/chlife-attendance-helper/?group=6 |
| 七 | https://pingchentw.github.io/chlife-attendance-helper/?group=7 |
| 八 | https://pingchentw.github.io/chlife-attendance-helper/?group=8 |

每個入口只點名本大組。報表經原站權限確認後提供八大組＋全召會，預設自己的大組。免登入入口可由知道網址的人使用；網址分流不是身分驗證。

## 帳密與預設入口

帳密只存於 [Render 環境設定](https://dashboard.render.com/web/srv-dbgljttg1s2s73bngdjg/env) 的 `GROUP_LINKS_JSON`。禁止把實際帳號、密碼、裝置識別碼或登入憑證放進 Git、GitHub Pages、截圖或維護紀錄。

- `accounts`：各來源的 `key`、`churchId`、`account`、`password`、`deviceToken`，最多八筆。
- `links`：入口的 `group`、來源 `source`、`groupId`、`allowWrites`、`churchReports`，最多八筆。`source` 必須對應既有 `accounts.key`。
- `DEFAULT_GROUP=6`：原首頁 API 直接共用第六入口的服務物件、寫入排程、名單簽章與報表，不建立第二個登入來源。
- `ALLOW_WRITES=true`：允許已設定 `allowWrites:true` 的入口點名；設為 `false` 可停用所有入口寫入。
- `APP_MODE=live`、`HOST=0.0.0.0`、`ALLOWED_ORIGINS` 與 `SNAPSHOT_SECRET` 沿用現行主機設定；`PORT` 由 Render 提供。

目前部署不需要 `CHLIFE_ACCOUNT`、`CHLIFE_PASSWORD`、`CHLIFE_DEVICE_TOKEN` 或 `CHLIFE_CHURCH_ID`。原首頁的獨立帳密已由八大組設定中的第六來源取代。程式保留給其他單帳號部署的相容分支，正式主機以 `DEFAULT_GROUP=6` 明確選定來源。

修改帳密時，先由帳號管理者在原網站完成帳號處理，確認可登入，再只更新 Render 中該來源的機密欄位，保留其他來源與固定的 `deviceToken`。不要另複製一套六大組帳密到其他環境變數。原網站要求驗證或改密碼時，程式會停止，不會繞過。

## 修改位置

| 要修改的內容 | 檔案／設定 |
| --- | --- |
| 所有年度、大組、小區基數 | 唯一資料表 [baselines.csv](baselines.csv) |
| 群組帳號、點名權限與來源分流 | Render 的 `GROUP_LINKS_JSON`；程式 [src/group-links.mjs](src/group-links.mjs) |
| 後端預設入口與 API 別名 | `DEFAULT_GROUP`；[src/server.mjs](src/server.mjs) 的 `configuredRuntime` |
| 原首頁、報表網址轉向與保留大組參數 | [public/group-context.js](public/group-context.js)；由 `app.js`、`reports.js` 啟動前呼叫 |
| GitHub Pages 的預設大組 | [scripts/build.mjs](scripts/build.mjs) 的正式建置設定，目前為 `6` |
| 手機自選名單保存 | [public/selection.js](public/selection.js)，按手機／入口／小區／一般或兒童分開保存人員 ID |
| 原網站登入及點名介面 | [src/upstream.mjs](src/upstream.mjs) |
| 正式週報的八大組與全召會彙總 | [src/church-reports.mjs](src/church-reports.mjs)、[src/reports.mjs](src/reports.mjs) |
| 手機介面離線快取 | [public/sw.js](public/sw.js)，目前 `attendance-shell-v12`；不快取 API、名單或帳密 |
| 自動測試與 Pages 發布 | [.github/workflows/pages.yml](.github/workflows/pages.yml) |

若日後更換預設大組，要同時調整 Render 的 `DEFAULT_GROUP` 與 `scripts/build.mjs` 的正式前端預設值；測試也要一併更新。不要只改首頁文字。

基數修改方式見 [README 基數管理](README.md#基數管理)。大組與小區各自設定；全召會只加總大組列，避免重複計算。未提供基數留空，不能填零代替未知。

## 修改與部署

1. 修改對應程式或唯一基數表，使用 Node.js 24 以上執行 `npm test`。
2. 以 `API_BASE_URL=https://chlife-attendance-helper.onrender.com` 執行 `npm run build`；未設定時產生假資料練習版，不會連正式服務。
3. 推送 GitHub，等待 [Actions](https://github.com/PingChenTW/chlife-attendance-helper/actions) 的測試、建置與 Pages 發布成功。
4. Render 為手動部署。在 [服務頁](https://dashboard.render.com/web/srv-dbgljttg1s2s73bngdjg) 選 **Manual Deploy → Deploy latest commit**；若這次需要修改環境變數，完成編輯後使用 **Save, rebuild, and deploy**。確認部署使用的 Git 提交與預期一致。
5. 新部署顯示 Live 後，檢查原首頁會轉到 `?group=6`，報表預設第六大組，其餘七個專屬入口仍維持自己的大組。
6. 讀取本週與上週名單及報表，確認其他大組的小區不能透過本入口點名。除非有明確指定可變更的真實紀錄，驗證只讀取資料；不要用隨機人名測試出席寫入。

更動手機介面檔案時同步更新 `public/sw.js` 的快取版本。練習版不自動轉六大組，仍可在本機使用假資料。

## 問題排查與回復

- 服務閒置或剛部署時可能需要啟動時間；先確認 Render 狀態，再重新讀取。不要因首次連線失敗就更換或公開帳密。
- 「預設大組入口尚未設定」：確認 `DEFAULT_GROUP` 為字串 `6`，且 `links` 有 `group:"6"`，其 `source` 對應有效來源。設定錯誤應停止啟動，不能臨時改用舊帳號。
- 「大組專屬入口尚未啟用」：核對 `GROUP_LINKS_JSON` 的 `links`，不要把錯誤入口轉到另一大組。
- 報表頻率限制：依提示稍候；彙總快照最多共用約一分鐘，畫面會顯示資料時間。
- 發現部署問題時先停用寫入再調查；回退版本必須支援 `DEFAULT_GROUP`，不能回退到仍要求舊帳密、卻已移除相關設定的版本。不要為回退重新填回已停用的舊帳密。

維護紀錄僅保存提交編號、測試結果、部署狀態與彙總筆數，不保存人名、帳密、名單簽章或登入憑證。
