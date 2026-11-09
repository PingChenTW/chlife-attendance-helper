# 使用統計維護說明

[公開手機統計頁](https://pingchentw.github.io/chlife-attendance-helper/usage.html) · [工程交接指南](HANDOFF.md)

2026-11-02 需求更新：使用者要求持續統計，並同意以 PingChenTW 的 GitHub 身分建立 Upstash 免費資料庫、接受條款、連線金鑰只存 Render。公開查看與不記人員資料維持原決定。早先的重啟歸零試用仍保留作無資料庫設定時的模式，不能與正式持久模式混淆。

正式持久模式已於 2026-11-02 啟用，並完成 Render 實際重啟前後計數、累計與起始時間相同的核對；程式提交與部署紀錄見 [交接驗證紀錄](HANDOFF.md#最近可供比對的驗證紀錄)。本次沒有建立付費資源、自動升級或定時喚醒。

## 資料與顯示範圍

2026-11-09 一般點名新增晨興（`morning`），使用同一份聚會白名單，自動納入各聚會名單查詢、送出與確認次數。沿用既有 Redis 累計，不需清庫、搬移或修改機密設定；新增前沒有晨興操作計數，不回填或推估。

- 正式持久模式將數值彙總存入 Upstash Redis，已落庫資料跨 Render 休眠、重啟及部署保留。每日彙總及累計不設應用層過期；不等於保證永不遺失或完整稽核。
- 台北時區，畫面提供今天／近七日／近三十日及啟用至今累計，累計亦受入口篩選。起始日取自資料庫，不因程序重建改變；之前日期顯示「尚未啟用／—」。無法重建從未收到或早已歸零的歷史。
- 可看全部或單一入口大組。歸類的是使用哪個入口，不是報表查詢的目標大組；報表可能透過本入口查其他大組。
- 只存日期、大組代碼、固定聚會代碼、數值計數與最後操作時間。沒有姓名、人員 ID、名單內容、出席細項、IP、瀏覽器識別碼、定位、完整網址或 user-agent。
- 原有 HTTP 限流仍使用暫時的來源 IP，不加入統計。原始 `requestId` 僅在程序內約三十分鐘去重；資料庫只存其 SHA-256 摘要收據約三十分鐘，讓跨程序重送也能去重。其他回報使用隨機短期收據；均非人員或裝置識別碼，不輸出到統計 API。
- 次數不代表獨立人數，也不是具有防竄改保證的稽核紀錄。公開事件可由人為呼叫產生；舊版本、斷線、回報失敗可能漏計。

## 計數定義

連線監測的四個新增欄位、分階段日誌與手機暫存補送見 [DIAGNOSTICS.md](DIAGNOSTICS.md)。`metadataReads`／`metadataFailures`／`clientConnectionFailures`／`rateLimited` 自新版啟用後才監測；不能把歷史零值當作正常服務證明。初始化失敗同時計入既有 failures，手機連線回報與限流分開列出。斷線補送按伺服器接收當日計數，不倒填手機時間。

| 欄位 | 畫面／定義 |
| --- | --- |
| `attendanceViews` | 點名頁成功取得初始化資料後，前端最佳努力回報一次；同一頁生命週期不重複回報，重新開啟可再計 |
| `reportViews` | 報表頁第一次成功顯示正式週報後回報；後續在同一頁換週或換範圍不另計開啟 |
| `rosterReads` | 後端成功提供一次名單 HTTP 查詢；含切換、重讀與首次帶入，內部寫前核對及回查不另計 |
| `reportReads` | 後端成功處理一次週報或全召會完整總表 HTTP 查詢，含快照回傳；不是直接打原站的請求數，內部比較週不另計 |
| `submissions` | 有效點名請求完成處理後的批次數；含已確認、部分成功及尚未確認，同入口同 requestId 在短期內只計一次 |
| `confirmedBatches` | 本批全部目標經回查已確認 |
| `unconfirmedBatches` | 本批結果為 partial／unconfirmed，仍有需要核對的目標 |
| `confirmedChanges` | 回查符合目標的筆數，包含新增與取消，並非人數或實際出席人數 |
| `failures` | 名單、週報或點名 API 已進入相關處理後拋出錯誤的次數；本版起包含 metadata 初始化失敗；不包含前置 CORS／限流拒絕及統計 API 本身（輔助主機限流另列） |

API 查詢也可能來自維護檢查，不限手機瀏覽器。查看統計頁不計入開啟或報表次數，統計頁沒有自動輪詢；按「更新統計」才重新讀取。

## 檔案與接口

| 檔案 | 責任 |
| --- | --- |
| [src/usage.mjs](src/usage.mjs) | 計數、台北日期、三十日保留、分組／聚會彙總、短期批次去重、公開結果 |
| [src/persistent-usage.mjs](src/persistent-usage.mjs) | 持久模式、非阻塞佇列、重試、還原、累計與一次承接 |
| [src/usage-store.mjs](src/usage-store.mjs) | 原生 fetch 的 Redis REST transport；Lua 原子增量／去重與一致讀取，不覆寫整份快照 |
| [src/server.mjs](src/server.mjs) | 統計路由、獨立限流、只在原操作成功後計數；統計例外不掩蓋點名結果 |
| [public/usage-client.js](public/usage-client.js) | 只回報 `{group,page}`，無 cookie／storage／個資；失敗不阻擋原程式 |
| [public/app.js](public/app.js)、[reports.js](public/reports.js) | 正式版成功初始化／顯示後非同步載入回報模組；模組讀取或回報失敗均不阻擋點名／報表，練習模式不回報 |
| [public/usage.html](public/usage.html)、[usage.css](public/usage.css)、[usage.js](public/usage.js) | 獨立手機介面、篩選、數字、每日趨勢、明細與錯誤提示；不呼叫原網站 |
| [test/usage.test.mjs](test/usage.test.mjs) | 跨台北午夜、來源隔離、去重、重啟、保留、輸入白名單、限流分離及錯誤不中斷點名 |
| [test/usage-persistence.test.mjs](test/usage-persistence.test.mjs) | 新實例還原、長期累計、並行加總、模糊提交後重試、一次承接、連線失敗及不阻塞點名；使用假 Redis transport，正式驗證另查部署紀錄 |

這兩條路由是全域路由，不接在 `/api/groups/{n}` 後面：

| 方法 | 參數／回傳 |
| --- | --- |
| `GET /api/usage/summary?period=7d&group=all` | `period=today/7d/30d`；`group=all` 或已配置的 `1..8`。回傳 `startedAt`、`generatedAt`、`range`、`totals`、`daily`、`byGroup`、`byMeeting`。持久模式另有 `storage:"redis"`、`retentionDays:null`、`lifetimeTotals`、`persistence`，沒有個別事件或識別碼 |
| `POST /api/usage/events` | 僅允許 `{group:"6",page:"attendance"}` 或 `page:"reports"`，兩欄；JSON 與 `X-Usage-Client: 1`，body 最大 512 bytes；HTTP 202 代表已接收排隊，不代表永久保存成功 |

讀取統計每個被伺服器辨識的來源每分鐘 60 次，回報事件 240 次；與點名原有 120 次讀取／15 次 POST 分開計算，不消耗點名額度。來源仍受目前代理 IP 辨識限制，尚未修改信任代理規則。CORS 使用原本的來源設定，`X-Usage-Client` 已加入允許標頭；這不是登入或防偽驗證。

## 發布、驗證與排查

1. `npm test` 與正式 `API_BASE_URL` 建置；UI 改動更新 Service Worker，本版為 `attendance-shell-v21`。統計 API 永不進入離線允許清單。
2. 前後端都需發布；GitHub 更新不會自動部署 Render。持久模式需要下面兩個機密設定，從 Upstash 資料庫的 REST 區取得，不可用唯讀 token。
3. 驗證 API `storage:"redis"`、起始時間、累計與保存狀態；重啟前後比較同期間／同入口，不以不同期間的數值判斷遺失。統計讀取不增加次數。測試出席只用假資料。
4. 若重啟後出現 `storage:"memory"`，先檢查機密設定是否移除、部署是否回退；不要清除資料庫或另建新庫。設定只填一半會停止啟動，不會靜默切回記憶體。
5. 若找不到 API，檢查前端建置的 `API_BASE_URL` 與 Render 版本。若資料庫無法讀取，回 503 並顯示錯誤，不能用空表偽裝成功。
6. 若未更新或出錯，先重開／重新整理；不要為了統計清除手機點名名單、改原站帳密或重複送出點名。

## 後端設定與儲存格式

| 環境變數 | 用途 |
| --- | --- |
| `USAGE_REDIS_REST_URL` | `https://<database>.upstash.io`；只允許官方 HTTPS 單一端點，不跟隨轉址 |
| `USAGE_REDIS_REST_TOKEN` | 寫入 REST token，只在 Authorization header；只存 Render 機密設定，不能放前端／Git／日誌 |
| `USAGE_SEED_JSON` | 選用的一次數值承接；一般部署不需填。完成後可移除，保留時亦由固定收據防重複 |

兩個 Redis 設定均未填時維持記憶體試用模式：最多三十日，重啟歸零。正式不要誤刪這兩個設定，也不要把 Free Render 的本機檔案／SQLite 當永久儲存。

Redis namespace 為 `{attendance-usage-v1}:`：`startedAt` 起始時間字串、`lifetime` 各入口累計 hash、`day:YYYY-MM-DD` 每日 hash。欄位是 `group:metric`、`group:m:meeting:metric` 與 `group:lastActivity`。`receipt:*` 是三十分鐘短期去重；`receipt:seed-v1-*` 是少量不過期的承接標記。不要手動改正式數字或啟用自動淘汰；更換 namespace 會像新資料庫一樣重新開始。

一次承接格式是最多八列的 JSON array，每列包含 `group`（字串）、`day`（台北日期）、`startedAt`、`at`（ISO 時間）、`counters`（十三種白名單數值）、`meetings:[{key,counters}]`。必須取自同一天、各入口的 `period=today` 摘要，聚會合計不能大於入口合計。程式扣除聚會部分後再匯入一般部分，避免重複累加；固定入口／日期／聚會收據讓重啟重讀只承接一次。這不是通用歷史匯入器，換 snapshot 不能重複補差額；不要附上原站人名或出席。切換窗口內新發生、未被快照捕捉的操作可能漏計。

## 故障、額度與長期維護

- 更新採原子增量，不以舊程序的全表覆蓋新程序資料。每次最多一百項排隊操作，佇列上限一萬；五秒連線逾時後約十五秒再試。程序在正常 SIGTERM 時盡力排空。
- 點名／原站報表不等待資料庫。待同步時只顯示已保存值及警告；佇列溢出另顯示漏收數。程序突然停止會失去尚未落庫的操作；超過短期收據有效時間的模糊重試也可能重計。本統計屬最佳努力，不是財務或稽核紀錄。
- 已落庫歷史不受 Render 重啟影響；資料庫本身的誤刪、帳號／免費方案政策或災難仍是風險。長期重要資料應另外制定定期匯出與還原演練，本次沒有設自動備份或定時喚醒。
- [Upstash 免費方案](https://upstash.com/pricing/redis) 目前列 250 MB、10 GB 月流量、每月 500K 指令；一個使用操作不等於一個資料庫指令，Lua 內亦有多個呼叫。監看控制台，不自動升級、不新增信用卡。滿額或容量不足時可能暫停統計，不影響原點名回應。
- [官方 FAQ](https://upstash.com/docs/redis/help/faq) 說明免費庫長期無使用可能封存，會先通知；需從控制台還原。正常每週使用會產生讀寫，不新增空打流量維持活動。若長期停用後重開失敗，先檢查封存狀態。條款與方案以當時官方內容為準。
