# 一起點名維護手冊

連線、初始化、逾時與分階段錯誤請依 [DIAGNOSTICS.md](DIAGNOSTICS.md) 查詢。手機有短查詢碼時用它搜尋 Render 應用日誌；沒查詢碼且提示連不上，需看手機回報是否在恢復後補送。只有零計數不能證明服務正常。公開統計是數值彙總，詳細階段日誌僅主機管理者可看。

新接手請先讀 [AI／工程師交接指南](HANDOFF.md)，AI 同時讀 [AGENTS.md](AGENTS.md)。本頁負責日常修改、部署與問題排查；架構、API、測試位置及已知限制集中在交接指南。給使用者的簡短教學仍是 [手機使用說明](https://pingchentw.github.io/chlife-attendance-helper/help.html)。

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

[獨立手機使用統計](https://pingchentw.github.io/chlife-attendance-helper/usage.html) 也可由知道網址的人查看，只提供操作次數。使用者已改選 Upstash 免費資料庫持續保存；已存入資料跨 Render 重啟保留。無資料庫設定時才是重啟歸零的記憶體試用；細節與 API 見 [USAGE.md](USAGE.md)。

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
| 使用統計 | [src/usage.mjs](src/usage.mjs)、[persistent-usage.mjs](src/persistent-usage.mjs)、[usage-store.mjs](src/usage-store.mjs)、[public/usage.html](public/usage.html)；UI／API、機密設定、持久格式與計數口徑見 [USAGE.md](USAGE.md) |
| 可分享的手機使用說明 | [public/help.html](public/help.html)、[public/help.css](public/help.css)、[public/help.js](public/help.js)；公開網址 `/help.html`，可選帶 `?group=1` ～ `8` 保留大組，沒有名單 API 呼叫 |
| 所有年度、大組、小區基數 | 唯一資料表 [baselines.csv](baselines.csv) |
| 群組帳號、點名權限與來源分流 | Render 的 `GROUP_LINKS_JSON`；程式 [src/group-links.mjs](src/group-links.mjs) |
| 後端預設入口與 API 別名 | `DEFAULT_GROUP`；[src/server.mjs](src/server.mjs) 的 `configuredRuntime` |
| 原首頁、報表網址轉向與保留大組參數 | [public/group-context.js](public/group-context.js)；由 `app.js`、`reports.js` 啟動前呼叫 |
| GitHub Pages 的預設大組 | [scripts/build.mjs](scripts/build.mjs) 的正式建置設定，目前為 `6` |
| 手機自選名單與首次帶入 | [public/selection.js](public/selection.js) 的 `SelectionStore`，一般按手機／入口／小區／聚會保存 ID，兒童維持按小區另存；[public/app.js](public/app.js) 切換聚會時切換名單，首次讀該聚會上週出席 |
| 原網站登入及點名介面 | [src/upstream.mjs](src/upstream.mjs) |
| 全召會完整總表與兒童主日分齡 | [REPORTS.md](REPORTS.md)；欄位與 CSV 在 report-model.js，原站計算轉接在 church-summary.mjs，選全召會用 summary API |
| 正式週報的八大組與全召會彙總 | [src/church-reports.mjs](src/church-reports.mjs)、[src/reports.mjs](src/reports.mjs) |
| 手機介面離線快取 | [public/sw.js](public/sw.js)，本次 `attendance-shell-v21`；包含靜態說明及統計介面，不快取 API、名單或帳密 |
| 自動測試與 Pages 發布 | [.github/workflows/pages.yml](.github/workflows/pages.yml) |

若日後更換預設大組，要同時調整 Render 的 `DEFAULT_GROUP` 與 `scripts/build.mjs` 的正式前端預設值；測試也要一併更新。不要只改首頁文字。

基數修改方式見 [README 基數管理](README.md#基數管理)。大組與小區各自設定；全召會只加總大組列，避免重複計算。未提供基數留空，不能填零代替未知。

## 修改與部署

1. 修改對應程式或唯一基數表，使用 Node.js 24 以上執行 `npm test`。
2. 以 `API_BASE_URL=https://chlife-attendance-helper.onrender.com` 執行 `npm run build`；未設定時產生假資料練習版，不會連正式服務。
3. 推送 GitHub，等待 [Actions](https://github.com/PingChenTW/chlife-attendance-helper/actions) 的測試、建置與 Pages 發布成功。
4. 依 [變更與發布對照](HANDOFF.md#變更與發布對照) 決定是否需部署 Render。純根目錄 Markdown 文件不需重啟主機；後端或基數變更必須部署，手機介面則維持 Pages 與 Render 直連介面同步。在 [服務頁](https://dashboard.render.com/web/srv-dbgljttg1s2s73bngdjg) 選 **Manual Deploy → Deploy latest commit**；若需要修改環境變數，完成編輯後使用 **Save, rebuild, and deploy**。確認部署使用的 Git 提交與預期一致。
5. 新部署顯示 Live 後，檢查原首頁會轉到 `?group=6`，報表預設第六大組，其餘七個專屬入口仍維持自己的大組。
6. 讀取本週與上週名單及報表，確認其他大組的小區不能透過本入口點名。除非有明確指定可變更的真實紀錄，驗證只讀取資料；不要用隨機人名測試出席寫入。

更動手機介面檔案時同步更新 `public/sw.js` 的快取版本。練習版不自動轉六大組，仍可在本機使用假資料。

## 問題排查與回復

- 使用統計歸零：先核對相同期間／入口及 API `storage`。正式應是 `redis`；若變成 `memory`，檢查 Render 的 `USAGE_REDIS_REST_URL`／`USAGE_REDIS_REST_TOKEN` 是否遺失或回退舊版。不能把資料庫連不上當零，不能清庫重來。若出現待同步、讀取錯誤，依 [USAGE.md](USAGE.md) 查額度、封存及連線。統計失敗仍可點名，不清手機資料、不重送出席。
- 舊共用名單升級：一般七項各自增加 `:meeting:聚會代碼` 儲存後綴。`SelectionStore.migrateMeetings` 先承接原有共用 ID，再一次複製到原有七項白名單中尚未有名單的聚會鍵；保留舊副本，不覆蓋已有目的鍵，空名單也保留。修改任何新名單都不回寫舊共用鍵，不影響另外六項。晨興（`morning`）是新增第八項，不承接舊共用副本，依上週晨興出席初始化；已有或刻意清空的晨興名單優先保留。兒童沒有新增 meeting 後綴，維持原規則。
- 首次帶入：`SelectionStore.initialize` 先承接舊資料，只在對應儲存鍵與當次工作階段均未初始化時執行。來源為 `meta.weeks[1]`、相同小區／聚會／一般或兒童，與目前名單取 ID 交集；只挑選人名，不修改原站出席。檢視上週重用目前名單，其他情況額外一次名單 API。成功空結果也保存，已有的空／非空／損壞紀錄均不覆蓋。失敗允許重試，遲到回應不能覆蓋選擇。無法保存時僅留當次工作階段並明確提醒，沒有新增雲端資料庫。
- 自選名單像是消失：先確認是否從桌面網頁 App 改為 LINE／Safari／Chrome，這些環境可能不共用本機儲存空間。同一台手機不代表同一份名單；先回原先加入名單的環境、選相同小區及一般／兒童種類核對，不要先刪除捷徑、清除資料或重裝。現在同一瀏覽環境的原首頁與 `?group=6` 會共用六大組儲存鍵。`loadSelected` 只在六大組的新鍵不存在時承接舊首頁對應鍵，保留原副本；已有新鍵，即使名單為空也不覆蓋。此機制不做跨 App 同步。
- 服務閒置或剛部署時可能需要啟動時間；先確認 Render 狀態，再重新讀取。不要因首次連線失敗就更換或公開帳密。
- 「預設大組入口尚未設定」：確認 `DEFAULT_GROUP` 為字串 `6`，且 `links` 有 `group:"6"`，其 `source` 對應有效來源。設定錯誤應停止啟動，不能臨時改用舊帳號。
- 「大組專屬入口尚未啟用」：核對 `GROUP_LINKS_JSON` 的 `links`，不要把錯誤入口轉到另一大組。
- 報表頻率限制：依提示稍候；彙總快照最多共用約一分鐘，畫面會顯示資料時間。
- 完整總表未出現／501：確認 Pages 的 reports.js 與 Render 同版，選全召會時應呼叫 summary；一般大組仍用 weekly。403 是來源沒有完整全召會權限，不改用其他帳號代查；502 先查原站角色／衍生聚會契約，不把缺失資料補零。兒童主日分齡合計與兒童召會生活不同，定義見 REPORTS.md。比較列只供唯讀，不擴大可點名週次。
- 發現部署問題時先停用寫入再調查；回退版本必須支援 `DEFAULT_GROUP`，不能回退到仍要求舊帳密、卻已移除相關設定的版本。不要為回退重新填回已停用的舊帳密。手機若回到舊共用版會讀舊副本，不能拿它覆寫新的 `:meeting:` 名單；保留所有 ID 鍵，不叫使用者清除資料。

維護紀錄僅保存提交編號、測試結果、部署狀態與彙總筆數，不保存人名、帳密、名單簽章或登入憑證。
