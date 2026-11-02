# AI／工程師交接指南

最後核對：2026-11-02。這是維護入口；程式與即時部署狀態是最終依據。日後修改功能、設定或部署時，請同步更新相關段落。

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
| 自選名單 | 每個瀏覽環境的 `localStorage` | 只存人員 ID；沒有雲端、跨手機或跨瀏覽器同步 |
| 手機暫存的點選修改 | 前端記憶體 `drafts` | 尚未送出時可能因關頁而遺失 |
| 姓名與目前出席 | API 回應及畫面記憶體 | 不放進 localStorage 或 Service Worker 快取 |
| 原站正式出席 | 原網站後端 | 送出後回讀確認，該站是正式資料來源 |
| 彙總報表快照 | 後端每個來源共用的記憶體快取 | 約 60 秒、最多本週與上週；不是持久報表資料庫 |
| 基數 | Git 的 `baselines.csv` | 啟動時載入，更新後須部署後端 |
| 離線介面 | Service Worker 公開檔案允許清單 | 目前快取版 `attendance-shell-v15`；不是離線點名佇列 |

## 檔案與修改入口

| 範圍 | 來源 | 主要責任 |
| --- | --- | --- |
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
| 基數與進階窗口 | [src/baselines.mjs](src/baselines.mjs)、[report-profiles.json](src/report-profiles.json) | 唯一 CSV 驗證、進階總表欄位預留 |
| 建置與發布 | [scripts/build.mjs](scripts/build.mjs)、[pages.yml](.github/workflows/pages.yml) | 產生 `dist/` 與非機密 `config.js`，Actions 發布 Pages |

## 必須維持的業務規則

### 手機名單不是出席紀錄

`selectionKey` 使用 `attendance-selected:v1:` 前綴，依 `mode`、`church`、`scope` 編碼，兒童加 `:children`，大組入口加 `:site:group-N`。其中 `church` 使用 API 回傳值，目前為召會名稱，不是直接套用設定中的數字 ID；改欄位或名稱時要考慮儲存鍵相容。值為 `{version:1, ids:[...]}`。同小區、同一般／兒童種類的名單跨週次與聚會沿用；聚會不是儲存鍵的一部分。

首次帶入只在鍵不存在，且當次工作階段也尚未初始化時發生：以 `meta.weeks[1]`、同小區及當下聚會的出席人員，和目前名單取 ID 交集；只帶入人名，不帶入出席狀態。看上週時重用該週名單，不查更早一週。成功空結果也保存；失敗不標記成功，允許重試。查詢完成後再次檢查是否切換畫面、是否已有名單，避免遲到回應覆蓋選擇。

已有名單、刻意清空或損壞的現有紀錄都不自動覆蓋。第六入口僅在新鍵不存在時，承接同瀏覽環境原首頁的對應 ID，保留舊副本；不搬到其他大組。儲存失敗時 `SelectionStore` 當次記憶體保留選擇，並顯示無法保存的提示。

同一台手機的桌面 PWA、LINE、Safari／Chrome 可能不共用儲存空間；私密瀏覽也不能當持久名單保存。排查先回原環境、相同小區及一般／兒童，不叫使用者刪捷徑、清資料或重裝。

### 點名範圍與寫入

- UI 只選到小區，不再讓使用者選排。範圍須符合入口大組及原站權限，不能由傳入 ID 擴大。
- 一般七項：主日、家聚會出訪、家聚會受訪、排聚會、禱告聚會、生命讀經、福音出訪。
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
| `GET /reports/meta` | 可選的來源、大組、週次及預留報表是否就緒 |
| `GET /reports/weekly?week=...&group=...` | 現有 8＋1 週報；`group` 應取自 report meta，不把入口號碼當原站 node key |
| `GET /reports/summary?week=...` | 進階總表預留，目前 HTTP 501 `SUMMARY_NOT_READY`；現有 8＋1 週報不受影響 |

上述路徑都要接在大組 API 前綴後，例如 `/api/groups/6/meta`。完整錯誤格式為 `{error:{code,message}}`。`SNAPSHOT_EXPIRED` 要重讀；`ROSTER_CHANGED` 核對人員／權限；`GROUP_NOT_CONFIGURED`／`DEFAULT_GROUP` 查機密設定；`AUTH_ACTION_REQUIRED` 由帳號管理者回原站處理，不繞過驗證或改密碼。

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
| 首次帶入、儲存、舊資料承接 | [selection.test.mjs](test/selection.test.mjs)；瀏覽器首次帶入→編輯→重開→清空→重開，另測兒童與不同入口 |
| 原站登入、欄位或權限 | [upstream.test.mjs](test/upstream.test.mjs)、[scopes.test.mjs](test/scopes.test.mjs)；正式驗證先只讀取，不列印個資 |
| 送出、逾時、部分成功 | [service.test.mjs](test/service.test.mjs)、[model.test.mjs](test/model.test.mjs)；用假的 timeout／readback 測試 |
| 大組或預設入口 | [group-links.test.mjs](test/group-links.test.mjs)、[http.test.mjs](test/http.test.mjs)；原首頁與六入口相容，其他入口不跨範圍 |
| 基數或統計口徑 | [baselines.test.mjs](test/baselines.test.mjs)、[reports.test.mjs](test/reports.test.mjs)、[church-reports.test.mjs](test/church-reports.test.mjs) |
| 週次／跨年 | [weeks.test.mjs](test/weeks.test.mjs)；台北週一換週與 ISO 年份 |
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
- 進階總表（受浸、新人、青職等參考表欄位）仍只有 `report-profiles.json` 與 501 窗口；現有 8＋1 週報已上線，二者要分清楚。未來總帳號也要經來源與權限驗證，不任意疊加八帳號造成重複統計。
- 沒有手機自選名單的雲端備份、跨瀏覽器同步或離線送出功能。
- 實體 iPhone／Android、實際 LINE 卡片預覽、尖峰併發仍待專項驗證；既有手機尺寸預覽與功能測試不代表這些已通過。
- Actions 曾顯示部分第三方 action 的 Node runtime 棄用提示；更新 action 版本時另外驗證發布流程，不等同本專案 Node.js 24 執行需求有錯。

## 最近可供比對的驗證紀錄

2026-11-02 交接整理前的功能基線為 Git 提交 `166533583eacfb59996aadcbf9ddfcc262b0f2aa`，Render 部署 `dep-dbjud4ijnfac7392mlv0` 已顯示 Live。後續請查實際提交，不能永久把這個版本當最新版。

- 當時 61 項自動測試與正式前端建置通過；首次帶入、保留編輯／刻意空名單、一般與兒童隔離已有回歸案例。
- 當時 Pages run 65 顯示 Success；請從 [Actions 清單](https://github.com/PingChenTW/chlife-attendance-helper/actions) 依提交 `1665335` 核對。後續依實際提交查驗，不依賴本機截圖。
- 正式首頁可進六入口，從「說明」返回保留大組；靜態說明在 320／390 寬度預覽無橫向溢出，八入口連結已核對。
- 未為此次 UI 與文件更新新增任何真實出席變更。下一次交接記錄同樣只保留彙總及驗證範圍。
