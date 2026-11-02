# 使用統計維護說明

[公開手機統計頁](https://pingchentw.github.io/chlife-attendance-helper/usage.html) · [工程交接指南](HANDOFF.md)

2026-11-02 需求確認：使用者選擇「知道網址的人都能查看」與「免費試用，接受主機重啟後重新累計」。本版不新增資料庫、第三方統計服務、管理密碼或付費資源。

## 資料與顯示範圍

- 統計自本次後端建立 `UsageStatistics` 時開始，後端重啟、重新部署或程序重建後歸零。它不是永久日誌，也無法補登啟用前的歷史。
- 台北時區，今天／近七日／近三十日；最多保留三十個曆日的記憶體彙總。開始前的日期以「尚未啟用／—」顯示，不能當作真實零次。
- 可看全部或單一入口大組。歸類的是使用哪個入口，不是報表查詢的目標大組；報表可能透過本入口查其他大組。
- 只存日期、大組代碼、固定聚會代碼、數值計數與最後操作時間。沒有姓名、人員 ID、名單內容、出席細項、IP、瀏覽器識別碼、定位、完整網址或 user-agent。
- 原有 HTTP 限流仍使用暫時的來源 IP；那是伺服器限流機制，不會加入使用統計資料。點名 `requestId` 僅在程序內短暫保存作批次去重，最多 8,000 筆／約三十分鐘，不輸出到統計 API，不能當人員或裝置識別碼。
- 次數不代表獨立人數，也不是具有防竄改保證的稽核紀錄。公開事件可由人為呼叫產生；舊版本、斷線、回報失敗可能漏計。

## 計數定義

| 欄位 | 畫面／定義 |
| --- | --- |
| `attendanceViews` | 點名頁成功取得初始化資料後，前端最佳努力回報一次；同一頁生命週期不重複回報，重新開啟可再計 |
| `reportViews` | 報表頁第一次成功顯示正式週報後回報；後續在同一頁換週或換範圍不另計開啟 |
| `rosterReads` | 後端成功提供一次名單 HTTP 查詢；含切換、重讀與首次帶入，內部寫前核對及回查不另計 |
| `reportReads` | 後端成功處理一次週報 HTTP 查詢，含快照回傳；不是直接打原站的請求數 |
| `submissions` | 有效點名請求完成處理後的批次數；含已確認、部分成功及尚未確認，同入口同 requestId 在短期內只計一次 |
| `confirmedBatches` | 本批全部目標經回查已確認 |
| `unconfirmedBatches` | 本批結果為 partial／unconfirmed，仍有需要核對的目標 |
| `confirmedChanges` | 回查符合目標的筆數，包含新增與取消，並非人數或實際出席人數 |
| `failures` | 名單、週報或點名 API 已進入相關處理後拋出錯誤的次數；不包含前置 CORS／限流錯誤、metadata 初始化失敗及統計 API 本身 |

API 查詢也可能來自維護檢查，不限手機瀏覽器。查看統計頁不計入開啟或報表次數，統計頁沒有自動輪詢；按「更新統計」才重新讀取。

## 檔案與接口

| 檔案 | 責任 |
| --- | --- |
| [src/usage.mjs](src/usage.mjs) | 計數、台北日期、三十日保留、分組／聚會彙總、短期批次去重、公開結果 |
| [src/server.mjs](src/server.mjs) | 統計路由、獨立限流、只在原操作成功後計數；統計例外不掩蓋點名結果 |
| [public/usage-client.js](public/usage-client.js) | 只回報 `{group,page}`，無 cookie／storage／個資；失敗不阻擋原程式 |
| [public/app.js](public/app.js)、[reports.js](public/reports.js) | 正式版成功初始化／顯示後非同步載入回報模組；模組讀取或回報失敗均不阻擋點名／報表，練習模式不回報 |
| [public/usage.html](public/usage.html)、[usage.css](public/usage.css)、[usage.js](public/usage.js) | 獨立手機介面、篩選、數字、每日趨勢、明細與錯誤提示；不呼叫原網站 |
| [test/usage.test.mjs](test/usage.test.mjs) | 跨台北午夜、來源隔離、去重、重啟、保留、輸入白名單、限流分離及錯誤不中斷點名 |

這兩條路由是全域路由，不接在 `/api/groups/{n}` 後面：

| 方法 | 參數／回傳 |
| --- | --- |
| `GET /api/usage/summary?period=7d&group=all` | `period=today/7d/30d`；`group=all` 或已配置的 `1..8`。回傳 `startedAt`、`generatedAt`、`range`、`totals`、`daily`、`byGroup`、`byMeeting`；無個別事件或識別碼 |
| `POST /api/usage/events` | 僅允許 `{group:"6",page:"attendance"}` 或 `page:"reports"`，兩個欄位；JSON 與 `X-Usage-Client: 1`，body 最大 512 bytes；成功 HTTP 202 |

讀取統計每個被伺服器辨識的來源每分鐘 60 次，回報事件 240 次；與點名原有 120 次讀取／15 次 POST 分開計算，不消耗點名額度。來源仍受目前代理 IP 辨識限制，尚未修改信任代理規則。CORS 使用原本的來源設定，`X-Usage-Client` 已加入允許標頭；這不是登入或防偽驗證。

## 發布、驗證與排查

1. `npm test` 與正式 `API_BASE_URL` 建置；UI 改動更新 Service Worker，本版為 `attendance-shell-v17`。快取只包含公開介面／腳本，統計 API 永不進入允許清單。
2. 前後端都需發布：GitHub Pages 提供獨立頁與新回報腳本，Render 必須部署新的統計模組與路由。無新增機密設定或第三方服務。
3. 驗證 summary 的 schema、啟動時間、群組及零資料提示；確認統計讀取不讓計數增加。用假資料驗證送出統計，不隨機改真實出席。
4. 若剛部署看到零，先核對啟動時間；若舊版本尚未更新，頁面開啟回報可能尚未開始，但新後端仍可計到原 API 讀取。
5. 若頁面找不到統計服務，檢查 `APP_API_BASE_URL` 與 Render 是否部署同一版；只有更新 GitHub 不會自動更新後端。
6. 若未更新或出錯，先重開／重新整理；不要為了統計清除手機點名名單、改原站帳密或重複送出點名。

要長期保留時，另行設計持久儲存、保留期限、費用及存取權限，再替換記憶體聚合；不能把本版資料當作已備份，也不能把帳密或真實人員清單寫進 Git 作為統計資料。
