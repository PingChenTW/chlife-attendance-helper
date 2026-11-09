# 連線、初始化與錯誤監測

2026-11-09 新增，不能回補或證明 11/8 的唯一故障原因。手機先 GET `/health` 確認輔助主機能回應，再讀取原站目錄及名單。讀取重試由使用者按「重新讀取」啟動；點名 POST 不自動重送，逾時仍依既有回查流程核對。

## 查看位置

- [公開使用統計](https://pingchentw.github.io/chlife-attendance-helper/usage.html) 的「連線與初始化」：初始化成功、初始化失敗、手機連線失敗回報、輔助主機限制請求。
- [Render 應用日誌](https://dashboard.render.com/web/srv-dbgljttg1s2s73bngdjg/logs)：選正確台北時間範圍，搜尋 `attendance-diagnostic` 或手機錯誤顯示的八碼查詢碼。需主機管理權限；既有 Hobby 方案僅保留約七日日誌，依控制台當時政策為準。沒有新增付費 HTTP 日誌或 CPU 監測方案。

## 固定數值欄位

| 欄位 | 定義 |
| --- | --- |
| `metadataReads` | 成功取得一次點名初始化資料；不是開啟人數或原站登入次數 |
| `metadataFailures` | 初始化已進入處理後失敗，同時列入既有 `failures` |
| `clientConnectionFailures` | 手機回報收到的連線逾時、網路錯誤或非 JSON 回應數，與伺服器操作錯誤分開，不能直接相加當獨立事故數 |
| `rateLimited` | 輔助主機對點名／報表請求的讀寫限流拒絕數；原站限流另由應用日誌的 `UPSTREAM_RATE_LIMIT` 辨識 |

沿用既有 Redis 的每日及累計數值、原子增量與三十分鐘去重收據。不清庫、不重設起始時間、不增加環境變數。Redis 不保存診斷事件原文、查詢碼、姓名、出席、帳密、IP 或裝置識別碼。老版本未監測到的初始化失敗無法回補；零或沒有回報不代表當時健康。

## 分階段應用日誌

每個可辨識的點名／報表請求有伺服器隨機 `requestId`，透過 AsyncLocalStorage 隔離併行請求。記錄 `at`、`group`、固定 `operation`／`stage`、事件、`durationMs`、安全錯誤碼、HTTP 狀態；原站已有回應時另有 `upstreamStatus`。不記錄完整 URL、query、request body、原站原文、錯誤堆疊、帳密或人員 ID。

| stage | 代表環節 |
| --- | --- |
| `helper` | 輔助服務收到請求、回應、限流或客戶端中止 |
| `initialize` | 初始化與權限／目錄資料驗證 |
| `upstream-login`／`upstream-refresh` | 原站登入／更新登入 |
| `upstream-directory`／`upstream-meetings` | 小區目錄／聚會目錄 |
| `upstream-roster` | 原站人員名單 |
| `upstream-attendance` | 原站出席寫入；詳細紀錄不含寫入人員或目標 |
| `upstream-report` | 原站正式報表 |

事件有 `request-start`、`request-complete`、`request-error`、`start`、`complete`、`error`、`client-disconnected`；啟動時另輸出 `boot`。登入／目錄快取有效時沒有對應的原站呼叫，不以日誌缺少某個 stage 判斷失敗。登入回應後的帳號政策／範圍檢查可能顯示 `initialize`，搭配錯誤碼判讀。單階段 error 可能被更新登入或回查成功恢復，仍須看同一查詢碼的 request-complete 狀態及手機結果；不能把每筆階段 error 當成獨立失敗。日誌本身失敗不可影響點名。

`UPSTREAM_TIMEOUT`／`UPSTREAM_UNAVAILABLE`／`UPSTREAM_FORMAT` 分別為原站逾時、連線不可用、非預期 JSON。`UPSTREAM_RATE_LIMIT` 為原站限流，`RATE_LIMIT` 為輔助主機限流。API 錯誤回應附 `stage`／`requestId`，並以 `X-Request-ID` 回應標頭提供同一代碼；前端只顯示簡短階段、原因及八碼查詢碼。

## 手機斷線回報

`public/connection.js` 僅將固定大組／階段／錯誤碼、耗時、時間與隨機事件 ID 暫存於當次分頁的 sessionStorage（最多二十筆、二十四小時）。沒有姓名／名單／URL／帳密或裝置指紋，不改動原本保存名單的 localStorage。儲存受限時退為本次記憶體；關閉分頁、清資料或超過期限可能無法補送。

恢復連線、下一次請求成功或瀏覽器 `online` 事件時，非阻塞送到 `POST /api/usage/diagnostics`。只有收到 HTTP 202 才移除該筆；事件 ID 僅作短期去重，持久收據為摘要，不能用來識別使用者。服務持續不可用時無法即時把錯誤送到同一主機，沒有背景喚醒、輪詢或跨日補寫歷史。

API 僅接受六欄 `{group,stage,code,durationMs,occurredAt,eventId}`，body 上限 768 bytes，JSON、`X-Usage-Client: 1` 及既有 CORS 檢查；使用獨立使用統計 POST 配額，不花點名額度。手機時間只在應用日誌標成 `clientOccurredAt`，計數依伺服器接收當天，不能信任它當準確故障時間。公開回報仍可能被人為製造，不是稽核紀錄。

## 驗證與發布

- [test/diagnostics.test.mjs](test/diagnostics.test.mjs)：初始化失敗、限流、trace 隔離／去敏、回報驗證／去重、觀測故障不影響原操作。
- [test/connection.test.mjs](test/connection.test.mjs)：分頁暫存、容量／期限、斷線與非 JSON、查詢碼文字、不重送點名及補送不卡住介面。
- [test/usage-persistence.test.mjs](test/usage-persistence.test.mjs)：新增數字跨重啟、匿名收據去重與舊累計保存。

修改後執行全套測試、正式建置與手機尺寸預覽。Service Worker v21 包含 `connection.js`。前後端都需要發布；先讓支援健康檢查 CORS 的後端上線，再發布新版 Pages，避免舊後端與新介面短暫不相容。若先部署已驗證的功能分支提交，需記錄它與合併後主分支的程式檔案相同。

故障範例只在本機假資料驗證。正式唯讀檢查健康、metadata、報表與數值累計；不得故意修改真實出席、鎖帳號、對原站壓測、清除 Redis 或刪除手機名單。
