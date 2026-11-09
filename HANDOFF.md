# AI／工程師交接指南

最後核對：2026-11-09。這是維護入口；程式與即時部署狀態是最終依據。日後修改功能、設定或部署時，請同步更新相關段落。

## 接手先做這幾件事

1. 讀 [AGENTS.md](AGENTS.md)，確認工作目錄、Git 分支、遠端、尚未提交的變更，不要覆蓋別人的工作。
2. 從 GitHub 取得最新來源；接手不需要先取得真實帳密，可以完全用假資料開發及測試。
3. 讀本文件及 [維護手冊](MAINTENANCE.md)，再看對應來源與測試；不要只依架構圖片或舊聊天推斷現況。
4. 實作前區分：手機顯示名單、原網站出席、彙總報表，是三件不同的事。
5. 交付時記錄提交、測試、Pages／Render 各自狀態及未完成檢查；不附真實名單、帳密或名單簽章。

## 專案與部署現況

| 項目 | 目前位置與行為 |
| --- | --- |
| 原始碼 | [PingChenTW/chlife-attendance-helper](https://github.com/PingChenTW/chlife-attendance-helper)，分支 `main` |
| 手機網頁／PWA | [GitHub Pages](https://pingchentw.github.io/chlife-attendance-helper/)；原首頁自動進第六大組 |
| 八個入口 | `/?group=1`～`/?group=8`；完整連結見 [維護手冊](MAINTENANCE.md#正式入口) |
| 使用者說明 | [help.html](https://pingchentw.github.io/chlife-attendance-helper/help.html)，可分享到 LINE；可帶 `?group=6` 等參數，返回原大組 |
| 獨立使用統計 | [usage.html](https://pingchentw.github.io/chlife-attendance-helper/usage.html)，公開匿名次數、期間／入口與累計；使用者已改選 Upstash 免費持久模式，見 [USAGE.md](USAGE.md) |
| 聚會報表 | [reports.html](https://pingchentw.github.io/chlife-attendance-helper/reports.html)，未帶大組時預設六大組 |
| 後端 | [Render 服務](https://chlife-attendance-helper.onrender.com)，既有 Docker Free 單一服務；也提供同一套靜態手機介面 |
| 部署控制台 | [Render Dashboard](https://dashboard.render.com/web/srv-dbgljttg1s2s73bngdjg)，服務 ID `srv-dbgljttg1s2s73bngdjg`，手動部署 |
| 健康檢查 | [GET /health](https://chlife-attendance-helper.onrender.com/health)；僅代表預設服務的程序狀態與寫入開關，不能證明八個帳號均登入成功 |
| 真正的出席資料 | 原網站 [召會生活人數統計](https://www.chlife-stat.org/login)，沒有另建資料庫 |
| 唯一基數表 | 根目錄 [baselines.csv](baselines.csv)；年度、召會、層級、區域 ID 為鍵，未知基數留空 |

八個入口已依先前授權啟用。每個入口只提供本大組點名；報表在來源權限確認後提供八大組＋全召會共九項，預設自己大組。這是免登入服務：網址可以被推得，網址分流、CORS、簽章均不是使用者身分驗證。既有公開範圍不代表未來可任意擴大資料曝光。

目前召會 ID 為 `49`。入口數字與原網站大組 ID 是不同識別碼：

| 入口 `group` | 原站大組 `groupId` |
| --- | --- |
| 1 | 659 |
| 2 | 660 |
| 3 | 661 |
| 4 | 662 |
| 5 | 663 |
| 6 | 1072 |
| 7 | 2154 |
| 8 | 2813 |

此表是目前部署的對照，設定來源仍是 Render `GROUP_LINKS_JSON`；小區從原站權限與目錄動態取得，不把小區數量或名稱寫死。換召會或組織結構時要重新核對，不直接套用這組 ID。

## 用什麼寫、資料存在哪裡

手機載入 GitHub Pages 的 HTML／CSS／JavaScript，再向 Render 的 Node.js API 取資料；Render 以後端帳號連接原網站。沒有 React、Express、編譯型前端框架或第三方執行套件。Node.js 需求為 24 以上，版本要求見 [package.json](package.json) 與 [Dockerfile](Dockerfile)。

| 資料 | 存放位置 | 保留方式 |
| --- | --- | --- |
| 真實帳密、固定 device token、簽章金鑰 | Render 機密環境設定 | 不送到手機，不提交 Git |
| 原站 access／refresh token | 後端記憶體 | 重啟後重新登入；同來源共用登入流程 |
| 自選名單 | 每個瀏覽環境的 `localStorage` | 一般八項各自保存 ID，兒童另存；沒有雲端、跨手機或跨瀏覽器同步 |
| 手機暫存的點選修改 | 前端記憶體 `drafts` | 尚未送出時可能因關頁而遺失 |
| 姓名與目前出席 | API 回應及畫面記憶體 | 不放進 localStorage 或 Service Worker 快取 |
| 原站正式出席 | 原網站後端 | 送出後回讀確認，該站是正式資料來源 |
| 彙總報表快照 | 後端每個來源共用的記憶體快取 | 約 60 秒、最多本週與上週；不是持久報表資料庫 |
| 工具使用次數 | Upstash Redis 免費資料庫；機密在 Render | 台北日期／入口／固定聚會數值及累計不設應用層過期，已落庫跨重啟保存；無設定時才是三十日記憶體試用，無姓名或歷史補登 |
| 基數 | Git 的 `baselines.csv` | 啟動時載入，更新後須部署後端 |
| 離線介面 | Service Worker 公開檔案允許清單 | 本次介面快取版 `attendance-shell-v20`；不是離線點名佇列，不快取任何統計 API |

## 檔案與修改入口

| 範圍 | 來源 | 主要責任 |
| --- | --- | --- |
| 獨立工具使用統計 | [src/usage.mjs](src/usage.mjs)、[persistent-usage.mjs](src/persistent-usage.mjs)、[usage-store.mjs](src/usage-store.mjs)、[usage.html](public/usage.html)、[usage.js](public/usage.js) | 彙總、持久增量／去重、非阻塞重試、獨立手機頁；詳細接口與限制集中在 [USAGE.md](USAGE.md) |
| 手機點名 | [public/index.html](public/index.html)、[app.js](public/app.js)、[styles.css](public/styles.css) | 範圍選擇、名單編輯、點選草稿、確認送出及回查訊息 |
| 自選名單 | [public/selection.js](public/selection.js) | `selectionKey`、舊首頁承接、`SelectionStore` 首次帶入及保存 |
| 畫面資料規則 | [public/model.js](public/model.js) | 小區篩選、修改差異、部分結果保留 |
| 大組與 PWA 連結 | [public/group-context.js](public/group-context.js) | 預設導向、解析入口、保留連結大組、八份 manifest |
| 使用說明 | [public/help.html](public/help.html)、[help.css](public/help.css)、[help.js](public/help.js) | 四步教學、八入口、複製網址；無名單 API 呼叫 |
| 報表介面 | [public/reports.html](public/reports.html)、[reports.js](public/reports.js)、[report-model.js](public/report-model.js)、[reports.css](public/reports.css) | 週次／範圍、手機摘要、完整表格、CSV |
| 離線介面 | [public/sw.js](public/sw.js) | 只快取公開允許清單，更新 UI 要增版本 |
| 假資料 | [src/demo.mjs](src/demo.mjs)、[public/practice.js](public/practice.js) | Node 假資料 API／獨立靜態練習版；不連原站 |
| HTTP 與啟動設定 | [src/server.mjs](src/server.mjs) | `createApp`、`configuredRuntime`、分流、CORS、限流、靜態檔案 |
| 來源與入口隔離 | [src/group-links.mjs](src/group-links.mjs) | `configuredGroups`、授權小區限縮、入口簽章與點名服務 |
| 點名流程 | [src/service.mjs](src/service.mjs) | `AttendanceService`、簽章、序列佇列、冪等、寫前核對、回讀 |
| 原站轉接 | [src/upstream.mjs](src/upstream.mjs) | `ChlifeAdapter`、登入更新、取名單、寫入、原站錯誤轉換 |
| 範圍與聚會 | [src/scopes.mjs](src/scopes.mjs)、[weeks.mjs](src/weeks.mjs) | 原站權限、聚會精確名稱、台北時區與 ISO 週 |
| 正式報表 | [src/church-reports.mjs](src/church-reports.mjs)、[reports.mjs](src/reports.mjs) | 正式週報口徑、8＋1、同來源快照、彙總與 CSV |
| 全召會完整總表 | [src/church-summary.mjs](src/church-summary.mjs)、[REPORTS.md](REPORTS.md) | 圖片完整欄位、兒童主日分齡、上週比較、同一正式來源的角色彙總 |
| 基數與報表設定 | [src/baselines.mjs](src/baselines.mjs)、[report-profiles.json](src/report-profiles.json) | 唯一 CSV 驗證、完整總表是否由來源支援 |
| 建置與發布 | [scripts/build.mjs](scripts/build.mjs)、[pages.yml](.github/workflows/pages.yml) | 產生 `dist/` 與非機密 `config.js`，Actions 發布 Pages |

## 必須維持的業務規則

### 手機名單不是出席紀錄

`selectionKey(meta,scope,audience,meeting)` 使用 `attendance-selected:v1:` 前綴，依 `mode`、`church`、`scope` 編碼，兒童加 `:children`，大組入口加 `:site:group-N`；一般傳入 meeting 後再加 `:meeting:聚會代碼`。同小區的八項一般聚會因此各自獨立，每項跨本週／上週沿用；兒童維持原有同小區共用名單，不加 meeting 後綴。其中 `church` 使用 API 回傳值，目前為召會名稱，不是設定中的數字 ID，改名需考慮鍵相容。值仍為 `{version:1, ids:[...]}`。

升級的選擇已由使用者確認：`SelectionStore.migrateMeetings` 先讀舊一般共用名單，只複製到原有七項白名單的目的鍵（`LEGACY_SHARED_MEETINGS`），不隨 `meta.meetings` 新增項目而擴大，只補不存在的鍵；非空、空白、損壞的既有目的紀錄均不覆蓋。保留原共用副本，不回寫；各份 Set 分開，之後編輯或清空其中一項不影響其餘項目。舊共用名單為空時也複製七份空名單；沒有舊名單才依各項自己的上週出席初始化。儲存失敗仍保留當次的七份副本並提示，不能假裝已持久保存。

首次帶入先做上述舊資料承接，只在目的鍵不存在且當次工作階段也尚未初始化時發生：以 `meta.weeks[1]`、同小區及當下聚會的出席人員，和目前名單取 ID 交集；只帶入人名，不帶入出席狀態。看上週時重用該週名單，不查更早一週。成功空結果也保存；失敗不標記成功，允許重試。查詢完成後再次檢查是否切換畫面、是否已有名單，避免遲到回應覆蓋選擇。前端切換 meeting 時要呼叫 `loadSelection`，讀寫時都傳入 meeting，避免只有鍵分開、畫面卻沿用上一份名單。

已有名單、刻意清空或損壞的現有紀錄都不自動覆蓋。第六入口先依舊規則承接同瀏覽環境原首頁的對應 ID，再承接成七項；原首頁副本與後來的共用副本都保留，不搬到其他大組。儲存失敗時 `SelectionStore` 當次記憶體保留選擇，並顯示無法保存的提示。

同一台手機的桌面 PWA、LINE、Safari／Chrome 可能不共用儲存空間；私密瀏覽也不能當持久名單保存。排查先回原環境、相同小區及一般／兒童，不叫使用者刪捷徑、清資料或重裝。

### 點名範圍與寫入

- UI 只選到小區，不再讓使用者選排。範圍須符合入口大組及原站權限，不能由傳入 ID 擴大。
- 一般八項：主日、家聚會出訪、家聚會受訪、排聚會、禱告聚會、生命讀經、福音出訪、晨興（`morning`）。晨興精確對應原站啟用且可見的「晨興」；ID 從目錄取得，不寫死。新增晨興不複製歷史共用名單，首次按晨興自己的上週出席初始化，已保存或刻意清空都保留。
- 兒童三項：兒童主日、兒童排、兒童家聚會；依原站「學齡前、國小」身分，含已受浸者。兩個 role 分開查再合併，不能用逗號合併條件。兒童主日對應原站同一份主日紀錄；其餘兩項對應兒童專用欄位。
- 只允許伺服器計算的本週／上週，台北時區、週一開始；不能自行用手機日期推定週次。
- 點姓名只改 `drafts`；送出並確認後才寫入。每筆使用明確 `attended:true/false`，不是 toggle。
- 名單 snapshot 簽章包含入口衍生金鑰、週次、小區、聚會、一般／兒童及人員狀態，有效約 15 分鐘。寫前重新核對目前權限，人員移出或不可寫時整批停止。
- 每個入口一條程序內寫入佇列；每批同狀態最多 50 人，單次送出上限 500 筆。`requestId` 相同且 payload 一致才可取回既有結果，結果快取約 30 分鐘，僅在記憶體。
- 逾時可能已寫入，因此先回讀，不盲目重送。API 整體 `status` 是 `confirmed`、`partial` 或 `unconfirmed`；單筆結果也可能是 `unknown`，不能顯示成已儲存。

### 報表與基數

報表權限由正式週報 API 驗證，不從點名權限推定。一般週報沿用原站預設「全部」口徑，主日拆分兒童；兒童欄位讀取兩個角色，與原站只列部分兒童的欄位可能不同。家聚會合計為受訪＋出訪，同人兩項會計兩次。保留直屬／歷史／其他彙總，僅對原站明確標示的 retired／ended 區域做對應，不把一般缺列任意當零。

基數只修改 [baselines.csv](baselines.csv)。空白是未知，0 也不能計比率；不把缺值當成零。大組基數與小區基數獨立設定，全召會加總大組列，避免重複加小區。資料與欄位規則見 [README 基數管理](README.md#基數管理)。

## API 契約與故障定位

一般入口前綴為 `/api/groups/{n}`，`n=1..8`。未帶大組的 `/api/*` 在現行 `DEFAULT_GROUP=6` 下直接共用第六服務、佇列、簽章及報表，不另建立舊帳號來源。

| 方法與路徑 | 用途／重要欄位 |
| --- | --- |
| `GET /meta` | `weeks`、授權 `scopes`、一般／兒童聚會、`siteKey`、`writesEnabled`；不要用寫死的週與小區代碼 |
| `GET /roster?week=...&scope=...&meeting=...&audience=all` | 回傳所選範圍的 `members`、`snapshot`；兒童用 `audience=children` |
| `POST /attendance` | JSON：`week,scope,meeting,audience,snapshot,requestId,changes`；`changes` 每筆為 `memberId,attended`。需 `Content-Type: application/json` 及 `X-Attendance-Client: 1` |
| `GET /reports/meta` | 可選的來源、大組、週次及完整報表是否由來源支援；實際權限仍須驗證 |
| `GET /reports/weekly?week=...&group=...` | 現有 8＋1 週報；`group` 應取自 report meta，不把入口號碼當原站 node key |
| `GET /reports/summary?week=...&source=primary` | 全召會完整總表，含兒童主日學齡前／小學／合計、前一週小計；不支援來源才為 501，詳見 REPORTS.md |

上述路徑都要接在大組 API 前綴後，例如 `/api/groups/6/meta`。完整錯誤格式為 `{error:{code,message}}`。`SNAPSHOT_EXPIRED` 要重讀；`ROSTER_CHANGED` 核對人員／權限；`GROUP_NOT_CONFIGURED`／`DEFAULT_GROUP` 查機密設定；`AUTH_ACTION_REQUIRED` 由帳號管理者回原站處理，不繞過驗證或改密碼。

使用統計另外使用全域 `GET /api/usage/summary` 與 `POST /api/usage/events`，不接大組前綴，不取原網站資料。回報只接受 group／page 兩欄；統計讀取與回報各有獨立的每分鐘 60／240 次配額，不消耗原有點名額度。精確計數定義、資料邊界、短期去重及 API 見 [USAGE.md](USAGE.md)。

原站主要轉接路徑在 `upstream.mjs`：`/auth/login`、`/auth/refresh`、`/admin/church-tree`、`/meetings`、`/members`、`/attendance`、`/admin/reports/weekly`。原站 `/members` 使用 POST 讀取名單，不能把所有 POST 都當成寫入。本專案依原站實際介面轉接，沒有原站正式承諾的公開 API 相容性保證。

## 設定與權限交接

設定欄位名稱與格式見 [.env.example](.env.example) 及 [維護手冊](MAINTENANCE.md#帳密與預設入口)。現行正式設定使用：

- `APP_MODE=live`、`DEFAULT_GROUP=6`、`HOST=0.0.0.0`；`PORT` 由平台提供。
- `GROUP_LINKS_JSON`：`accounts` 是後端來源、`links` 是入口對照；兩者最多各八筆。來源 key 不等於入口號碼，同一來源可合法供多入口使用，但必須逐一驗證權限。
- `ALLOW_WRITES` 為全域開關，各入口還要 `allowWrites:true` 才可寫；`churchReports:true` 另行啟用已確認的報表範圍。
- `ALLOWED_ORIGINS` 目前需包含 `https://pingchentw.github.io` 這個完整來源；不是包含專案路徑的頁面 URL。
- `SNAPSHOT_SECRET` 為固定機密金鑰；更換後舊 snapshot 失效，需重新讀取。
- GitHub Repository Variable `APP_API_BASE_URL` 是公開後端 HTTPS origin，沒有帳密；建置時映射到 `API_BASE_URL`。兩個名稱不要混淆。

目前已移除原首頁的獨立舊帳密，不要為回退重新填回 `CHLIFE_*`。原始碼仍有未設定 `DEFAULT_GROUP` 時的舊單帳號相容分支與 `REPORT_ACCOUNTS_JSON` 窗口，這些不是現行正式部署的設定方式。新工程師需要的 GitHub／Render 管理權限由擁有者另行提供，公開文件不包含可登入的資訊。

## 本機開發與驗證

在乾淨的新 clone 的儲存庫根目錄，以 Node.js 24 以上執行；沒有第三方依賴，無須先 `npm install`。

```sh
npm test
npm run demo
```

練習網址為 `http://127.0.0.1:4173`，都是假資料。未設定 `API_BASE_URL` 的 `npm run build` 也只產生靜態假資料練習版。

PowerShell 正式前端建置範例（只有公開後端網址）：

```powershell
$env:API_BASE_URL = 'https://chlife-attendance-helper.onrender.com'
npm run build
```

CI 使用 [pages.yml](.github/workflows/pages.yml) 的 Linux 設定，會執行 `node --test`、建置及 Pages 發布。`dist/` 不提交 Git。Docker 直接複製 `src/`、`public/`、`package.json` 與 `baselines.csv`，不依賴 Pages 的 `dist/`。

| 變更類型 | 優先檢查 |
| --- | --- |
| 首次帶入、儲存、舊資料承接 | [selection.test.mjs](test/selection.test.mjs)及 [morning.test.mjs](test/morning.test.mjs)；八項獨立初始化、原七項舊共用複製七份、目的鍵保護，瀏覽器編輯→換聚會→重開→清空→重開，另測兒童與不同入口 |
| 原站登入、欄位或權限 | [upstream.test.mjs](test/upstream.test.mjs)、[scopes.test.mjs](test/scopes.test.mjs)；正式驗證先只讀取，不列印個資 |
| 送出、逾時、部分成功 | [service.test.mjs](test/service.test.mjs)、[model.test.mjs](test/model.test.mjs)；用假的 timeout／readback 測試 |
| 大組或預設入口 | [group-links.test.mjs](test/group-links.test.mjs)、[http.test.mjs](test/http.test.mjs)；原首頁與六入口相容，其他入口不跨範圍 |
| 基數或統計口徑 | [baselines.test.mjs](test/baselines.test.mjs)、[reports.test.mjs](test/reports.test.mjs)、[church-reports.test.mjs](test/church-reports.test.mjs)、[church-summary.test.mjs](test/church-summary.test.mjs) |
| 週次／跨年 | [weeks.test.mjs](test/weeks.test.mjs)；台北週一換週與 ISO 年份 |
| 使用統計 | [usage.test.mjs](test/usage.test.mjs)、[usage-persistence.test.mjs](test/usage-persistence.test.mjs)；台北跨日、還原、累計、增量、承接、去重、配額分離與故障不阻塞點名；手機測試保存狀態、篩選及錯誤 |
| 使用說明或樣式 | 手機寬度 320／390 預覽、展開提示、八入口、原大組返回、複製／手動複製網址；不能等同實體裝置測試 |

改功能後執行完整測試與建置；改介面加瀏覽器操作檢查。正式讀取結果不得另存人名 fixture。真實寫入驗證需本次任務明確指定姓名、週次、聚會及出席目標，否則只用假資料測送出。

## 變更與發布對照

| 改了什麼 | GitHub／Pages | Render |
| --- | --- | --- |
| 根目錄 README、HANDOFF、AGENTS、MAINTENANCE 等 Markdown | 提交後核對文件及連結；既有 Actions 仍會自動跑 | 不需要重啟或重新部署 |
| `public/` 手機介面、使用說明、Service Worker | 等待 Pages 發布成功；介面更新時增 SW 版本 | 若維持 Render 直連介面同步，手動部署同一提交；現行維護兩邊一致 |
| `scripts/build.mjs`、Pages workflow 或 `APP_API_BASE_URL` | 重新建置／發布 Pages，確認不是練習版 | 只影響 Pages 建置時不需重啟；若同時改後端設定則另處理 |
| `src/`、`baselines.csv`、Dockerfile、後端執行需求 | 測試及提交；Actions 成功不代表後端已更新 | 必須手動部署，確認 Live 的提交與預期一致 |
| Render 機密或權限設定 | 真實值絕不提交 Git | 依設定頁儲存並部署，重新核對相關來源與範圍 |

Render 沒有依 GitHub push 自動部署。完整步驟見 [維護手冊](MAINTENANCE.md#修改與部署)。發版後驗證本次影響的功能即可，避免對原站重複查詢全部報表。前端與後端提交不同不一定是錯誤：文件或 Pages 專用建置變更可只更新 Git／Pages，但應記錄差異原因。

## 已知限制與後續工作

- 後端限流目前使用 `req.socket.remoteAddress`：每個被識別的來源每分鐘 120 次讀取／15 次 POST。Render 代理下是否共用來源仍待驗證，不能宣稱等同每位使用者各自配額。修改信任代理前要確認可被信任的標頭與平台行為。
- 同入口寫入排隊，報表快取按來源共用，尚未做正式壓力測試。先前討論的使用人數是估算，不能當成容量保證。
- 只有單一程序的佇列、冪等記錄與登入快取；重啟會遺失。新增多實例前須設計共用佇列／冪等與部署中的請求處理，不能直接水平擴充。
- 無法和原站其他使用者取得跨系統交易鎖；寫前核對與回讀能降低衝突，不能消除同時修改。
- 全召會完整總表以單一已驗證來源的正式週報 `group_by_role=1` 取得全組及角色數值，不拼接八帳號。兒童主日分齡包含普通主日中已受浸兒童及拆分的兒童福朋，不能只取「童」。一般小區表仍使用原契約；來源不完整時拒絕產生全召會成功回應。原站自製 weekly-grid 的權限與 schema 不同，不拿它代替正式週報。詳見 REPORTS.md。
- 沒有手機自選名單的雲端備份、跨瀏覽器同步或離線送出功能。
- 使用統計為公開、匿名、Upstash 持久數值，已落庫跨重啟保留；不是獨立使用人數或防偽稽核。尚未落庫的佇列在程序突停時可能遺失；免費額度、長期閒置封存與資料庫故障仍有影響。沒有自動備份／付費升級，也沒有追蹤使用者識別碼。點名寫入排程及冪等結果仍是原有程序記憶體，不能因統計持久化就直接水平擴充點名服務。
- 八項獨立名單屬手機儲存及畫面邏輯，原有名單／點名 API 契約沒有改變。回退到舊共用版可能只顯示保留的舊副本，不能據此覆寫新的 `:meeting:` 名單；排查或回退時保留兩套 ID 鍵。
- 實體 iPhone／Android、實際 LINE 卡片預覽、尖峰併發仍待專項驗證；既有手機尺寸預覽與功能測試不代表這些已通過。
- Actions 曾顯示部分第三方 action 的 Node runtime 棄用提示；更新 action 版本時另外驗證發布流程，不等同本專案 Node.js 24 執行需求有錯。

## 最近可供比對的驗證紀錄

2026-11-09 新增晨興點名：一般聚會為八項，新增 `morning` 精確對應原站「晨興」，沿用原有讀取、送出及回查流程；匿名統計由共用白名單自動納入。原七項手機名單及歷史共用備份保留；晨興不複製舊共用名單，首次讀取自己的上週出席者，之後保留自選及刻意空名單。新增 `test/morning.test.mjs` 驗證官方欄位、練習版、舊副本隔離、持久空名單、假資料送出與統計。90 項測試與正式建置通過，390 寬瀏覽器已操作晨興編輯、切換禱告、重開保留及假資料送出回查。原站目錄已唯讀確認晨興啟用；未寫入任何真實出席。SW v20。

晨興正式發布：[PR #5](https://github.com/PingChenTW/chlife-attendance-helper/pull/5) 已合併，程式提交 `ba3f710558326fe9eb3ae6e18a552e1b01c7dba4`；[Pages run 73](https://github.com/PingChenTW/chlife-attendance-helper/actions/runs/42562844557) 成功，Render 部署 `dep-dboks5lg1s2s73fh6c40` 為 Live。八個入口皆回八項一般聚會且含晨興；六入口本週／上週晨興名單唯讀成功。Pages／Render 各四個手機檔案均與來源一致；正式 390 寬切換晨興、首次帶入及顯示已核對。Redis 起始時間仍為 `2026-11-02T04:54:12.250Z`，各累計不低於部署前，晨興匿名統計欄位存在；健康檢查通過。此發布紀錄的後續純文件提交不需要重啟 Render，後端維持上述程式提交。

2026-11-04 正式發布完成：[PR #4](https://github.com/PingChenTW/chlife-attendance-helper/pull/4) 合併後的程式提交為 `a799ce374ce7ad132e18571f8042110bb60e16b9`；[Pages run 71](https://github.com/PingChenTW/chlife-attendance-helper/actions/runs/41784386420) 成功，Render 部署 `dep-dblcrjbm8hqs738u3b1g` 為 Live。Pages／Render 各五個報表與 SW 檔案均與來源一致，健康檢查通過。正式 summary 本週 W45／上週 W44 均回八大組及比較週；上週兒童主日學齡前 64＋小學 57＝121，各列分齡加總一致（來源補登後數字可能改變）。正式手機寬度 390 檢查及上週畫面核對完成。Redis 累計各項不低於部署前，起始時間仍為 `2026-11-02T04:54:12.250Z`，沒有歸零；本次未新增真實出席。後續僅補充這段發布紀錄的文件提交不需要重部署 Render，後端保留上述程式提交。

2026-11-04 完整總表更新：本機 87 項測試及正式前端建置通過；唯讀原站驗證本週／上週皆可取得八大組與年度基數合計，兒童分齡各列及總計一致。假資料手機 320／390 寬無頁面橫向溢出，25 張指標卡、兩層表頭、8 組、小計／比較兩列、切換大組卡片及瀏覽器 CSV 實際下載均已檢查；正式發布核對另記於下，不把開發版當成正式服務已更新。沒有修改真實出席。

2026-11-02 持續統計更新：本機 80 項測試及正式前端建置通過。新增假 Redis transport 與假出席 HTTP 測試，涵蓋跨新程序、超過三十日累計、並行增量、已提交但回應遺失的重試、一次承接、不記人員資料及資料庫卡住時點名照常完成。正式部署與重啟前後數字需以此次實際發布紀錄核對，不把假 transport 測試當作雲端災難還原演練。

本次正式程式提交 `e265ba64ef3bee4d82f9eaab78b1f4a7f9eff311`，Pages run 69 成功，Render 部署 `dep-dbk1eo5g1s2s73919f1g` 為 Live。六個前端檔案副本（Pages／Render 各三個）與來源一致，API 回傳 `storage:redis`、健康檢查成功。正常開啟六入口後，統計為點名頁 1、名單查詢 1、送出 0；實際執行 Restart service 後，上述數字、累計與起始時間保持一致，無待同步。這是正式雲端的跨程序檢查，沒有寫入真實出席。切換前舊程序當日統計已歸零，未虛構補回歷史。另以獨立十分鐘到期的測試 namespace 核對 Upstash Lua 原子加總、重複呼叫去重與讀取；假資料 320／390 寬度檢查無橫向溢出。以上不是壓力測試、實體手機測試或災難還原演練。後續文件提交不需要重啟此後端。

2026-11-02 使用統計更新：本機 73 項測試及正式前端建置通過；假資料手機預覽驗證期間／入口篩選、每日與聚會明細、320／390 寬度、重啟歸零及錯誤可重試。開啟假資料點名與報表後，計數分別增加一次頁面開啟，未新增送出批次；查看統計不增加使用次數。正式上線的累計從新後端啟動後才開始，不回填這些測試數據。

2026-11-02 七項獨立名單更新：66 項自動測試及正式前端建置通過。假資料瀏覽器驗證包含：舊共用三人複製成七份、只改禱告項目不影響另外六項、清空後重開仍為空、新小區各聚會分別讀取各自上週出席；均沒有送出真實出席。此更新使用 `attendance-shell-v16`，交付時以實際 Git 提交、Actions 與 Render 狀態為準。

交接整理前、可供歷史比對的功能基線為 Git 提交 `166533583eacfb59996aadcbf9ddfcc262b0f2aa`，當時 Render 部署 `dep-dbjud4ijnfac7392mlv0` 顯示 Live。這是舊共用名單版本，不是本次獨立名單的最新版：

- 當時 61 項自動測試與正式前端建置通過；首次帶入、保留編輯／刻意空名單、一般與兒童隔離已有回歸案例。
- 當時 Pages run 65 顯示 Success；請從 [Actions 清單](https://github.com/PingChenTW/chlife-attendance-helper/actions) 依提交 `1665335` 核對。後續依實際提交查驗，不依賴本機截圖。
- 正式首頁可進六入口，從「說明」返回保留大組；靜態說明在 320／390 寬度預覽無橫向溢出，八入口連結已核對。
- 未為此次 UI 與文件更新新增任何真實出席變更。下一次交接記錄同樣只保留彙總及驗證範圍。
