# 文件變更紀錄

> 本文件僅記錄 `docs/` 結構調整與主要文件搬移。
> 程式碼變更請參考 git log。

---

## 2026-05-05 ~ 05-07

> 五月初密集功能週：Firestore 讀取最佳化（月度聚合）、勞保 2026 新制
> 升級、跨日班虛擬卡、員工管理增強、Excel 匯出修正、突發事件工時警告。

### Firestore 讀取最佳化（P0）— 月度聚合 attendanceMonthly

**動機**：每日 Firestore reads 持續超過 5 萬，懷疑是結構性問題。

**新增 collection**：`attendanceMonthly/{userId}_{YYYY-MM}`
- per 員工 per 月一筆物化視圖（dailyStatus 預先聚合）
- 取代「每次讀月曆都掃 ~60 筆 raw attendance」

**Phase 1**：6 個 mutation 端點 shadow write 同步聚合
- `punch.js` / `punchWithoutLocation.js` / `adjustPunch.js`
- `submitLeave.js` / `approveReview.js` / `rejectReview.js`
- 每次寫 attendance 後 await `applyEventToMonthly`，try/catch 不阻擋主流程
- 首次建立聚合時做全月 rebuild（避免歷史日資料被覆蓋）
- 增量更新時用 day-level recompute（~3-5 reads + 1 write）

**Phase 1.5**：一次性 backfill 腳本
- `firebase-functions/scripts/backfill-attendance-monthly.js`
- 支援 `--dry-run` / `--force` / `--month` / `--user` / `--project`

**Phase 2**：讀取端切換
- `getCalendarSummary.js` / `getAttendanceDetails.js` 改走 `getMonthlyDailyStatus`
- 命中聚合 doc → 1 read；未命中 → lazy fallback + transaction race-safe 寫入
- 預期 reads 降幅 30-60×（50K/天 → 1-2K/天）

**新增 / 修改檔案**：
- `firebase-functions/functions/src/_attendance.js`：新增 `applyEventToMonthly` /
  `rebuildMonthlyAggregate` / `getMonthlyDailyStatus` 三個 helper
- `firebase-functions/functions/src/_helpers.js`：COLLECTIONS 加
  `ATTENDANCE_MONTHLY: "attendanceMonthly"`
- `docs/plans/Firestore-讀取最佳化-月度聚合計畫.md`：完整四 Phase 計畫
  （包含粒度權衡、保留 raw attendance 的法規理由、競態處理）

---

### 跨日班自動補虛擬卡（從 GS 移植）

**新增**：`firebase-functions/functions/src/dailyVirtualPunch.js`
- 每天 04:00 Asia/Taipei 排程觸發
- 偵測「前天最後是上班」+「昨天第一筆是下班」的跨日班
- 自動補：前天 23:59:59 下班 + 昨天 00:00:00 上班
- 寫入後同步呼叫 `applyEventToMonthly` 維護兩天的聚合 doc
- 排序：03:00 cleanExpiredSessions → 04:00 dailyVirtualPunch →
  09:00 checkYesterdayPunch（先補虛擬卡再檢查漏打卡，避免誤通知）

---

### 補打卡誤填修復工具

**新增**：`firebase-functions/scripts/find-midnight-punches.js`
- 找出 dailyVirtualPunch 上線前手動補卡誤填的「00:00 下班」紀錄
- 三種模式：
  - **list**（預設）：列出可疑紀錄
  - **--fix**：自動把 00:00 改成同一天 23:59:59（保留審計軌跡 fixHistory）
  - **--correct-prev**：修正第一版 --fix 搬錯方向的紀錄（前一日 → 同一天）
- 5 秒倒數可 Ctrl+C 中止；同步刪除受影響的 attendanceMonthly doc

---

### 勞保 / 健保 2026 新制升級

**法源**：勞動部 114/11/21 勞動保 2 字第 1140091863 號令、
[勞保局官方分擔金額表](https://www.bli.gov.tw/0005475.html)、
[健保署費率表](https://www.nhi.gov.tw/ch/cp-19418-9eefb-2576-1.html)

**勞保分級表**：23 級舊表 → **11 級新表**（29,500 ~ 45,800）

**新增「國籍」欄位**：員工區分台灣 / 外籍
- 本國勞工：勞保普通事故 11.5% + 就保 1% = 12.5%，員工自付 2.5%
- 外籍勞工：不適用就保法 §5（限 ROC 國籍），只有 11.5%，員工自付 2.3%
- 外籍員工自動 disable 勞退提繳（外籍移工通常不適用）

**健保**：費率不變（5.17% × 員工 30%），但**精度修正**
- 舊：`0.0155`（差 0.001 在 29,500 級會少 1 元，officially 458 顯示成 457）
- 新：`0.0517 * 0.30`（精確 0.01551）

**基本工資**：28,590 → **29,500**（前後端一致更新）

**Excel 公式修正**：
- 勞保 / 健保扣繳全部用 `ROUND(...,0)` 包起來（政府規定保費四捨五入到元）
- 勞保費率依國籍動態（外籍 0.023、本國 0.025）

---

### 突發事件工時偵測（取代「違法工時」）

**邏輯改動**：
- 移除休息日 `rest_ot3` 12h 上限（員工真實超時也計薪）
- 新增 `stats.illegalHours` 欄位：勞基法 §32 §36 警示
  - 例假日：任何 net > 0 即標記
  - 其他日：max(net - 12, 0)

**改名**：「違法工時」→「**突發事件工時**」
- 勞基法 §40 允許天災/事變/突發事件停假，員工出勤可能合法
- 系統標警告而非定罪，業主依 §40 自行判斷

**呈現**：
- Excel R 欄：每日「⚠️ X.Xh」、月度「⚠️ X.Xh / N天」
- Excel 警告區（單獨一列）：列出總時數 + 法源 + 業主審查提示
- 管理員 UI：KPI 區紅 → 橙色警告框（amber，提醒非定罪）

---

### Excel 匯出多項修正

1. **H 欄「加班時數」回歸實際工時定義**（不重複算法定加倍）
   - workday：ot1 + ot2（扣掉 8h 正常）
   - rest / public / regular：net（淨工時）
   - 例假日 base + comp 顯示在「應發項目區」，不混入 H

2. **應發項目區公式錯位修復**：警告區會多吃 1 行，applyBaseRow 動態加
   `warningOffset` 避免公式落到表頭。

3. **月薪 cell 引用修正**：`$S$1` → `$T$1`（R 欄加入「突發事件工時」後
   月薪數值移到 T 欄；S 欄為「月薪」label）；`T${sumRow}` /
   `T${payRow}` 同步調整。

4. **健保精度修正**：`-投保薪資*0.0155` → `-ROUND(投保薪資*0.0517*0.3,0)`
   29,500 級從 -457 修正為 **-458** 與官方表一致。

5. **勞保 ROUND 補上**：`-投保薪資*0.023` 顯示 -678.5 → 加 ROUND 變 -679。

6. **規則說明 sheet** 更新：新版本沒有 12h cap、納入國籍區分費率。

---

### 員工管理增強

1. **「離職」軟刪除按鈕**（`setEmployeeStatus.js` field='resign'）
   - status='已離職' + resignedAt 時戳
   - 單向操作（要重啟用須改 active=true）
   - 排程任務（checkYesterdayPunch / dailyVirtualPunch）自動排除

2. **管理員員工選單只顯示「啟用中」員工**（過濾停用 / 未啟用 / 已離職）

3. **月薪 step 修復**：`step="100"` → `step="10"`（允許輸入 28590 / 29500
   等基本工資值）

4. **本地 state 同步**：薪資設定儲存後 `Object.assign` 漏 `nationality`，
   切換員工會跳回舊值；補上後立即生效。

---

### 假日類型判斷修正

**Bug**：`getDayKind` 對「國定假日落在週末」誤判 public

**法源**：勞基法施行細則 §23（休假日遇例假/休息日應於其他工作日補休）

**修法**：
- caption 含「補假」 → public（取代被補假的國定假日）
- caption 有值 + 週末 → rest（六）/ regular（日）（國定假日已遞延）
- caption 有值 + 平日 → public

**驗證範例**（2026/04 連假四天）：
- 4/3 (五) 補假 → public ✅
- 4/4 (六) 兒童節 → rest（之前誤判 public）✅
- 4/5 (日) 清明節 → regular（之前誤判 public）✅
- 4/6 (一) 補假 → public ✅

---

### 翻譯補齊（5 語系）

新增 i18n 鍵：
- `STATUS_PUNCH_NORMAL`（vi 缺失）
- `RECORD_HOURS_PREFIX`（5 語系全缺）
- `MONTH_TOTAL_HOURS_PREFIX`（5 語系全缺）
- `UNIT_HOURS`（5 語系全缺，「小時」單位）
- `LOCATION_VIRTUAL_PUNCH`（5 語系全缺，「系統虛擬卡」）

對應的 hardcode 字串改用 `t()` 動態取譯。

---

### 其他修復

- `cacheManager.invalidate()` alias（5 處 caller 使用但沒實作 → TypeError）
- `applyEventToMonthly` 首次建立聚合時做全月 rebuild（避免只寫一日）
- backfill 腳本用 `createRequire` 從 `functions/` 解析 firebase-admin
- backfill 腳本 `--correct-prev` 修正搬錯方向的補卡

---

## 2026-04-25

### 階段三 D 前置：migrate-to-firestore.js 完整實作

**脈絡**：使用者已升級 Blaze、完成 DEPLOY.md 8 步驟（Cloud Functions 部署完成），
要開始遷移實際 Google Sheets 資料到 Firestore。

**新增 / 更新**：
- `scripts/migrate-to-firestore.js`：完整實作（原骨架約 90 行 → 完整 300 行）
  - 使用 `firebase-admin` + `googleapis` 讀 Sheets 寫 Firestore
  - 支援 `--dry-run` / `--clear` / `--only=<target>` 三個模式
  - 批次寫入（每 400 筆一批，避開 Firestore 500 operation limit）
  - doc id 策略：`employees.userId`、`attendance.<userId>_<ts>_<idx>`、`locations.<id|loc_N>`
  - 座標解析：`(lat,lng)` 格式拆成獨立 lat/lng 欄位
  - 全部欄位對應與 GS writeEmployee_ / punch / getLocationsCached 同步
- `scripts/package.json`：新增 devDependencies（firebase-admin + googleapis）
- `scripts/MIGRATE.md`：**使用者逐步指南**（8 個 Step + 欄位對應表 + 疑難排解）
- `.gitignore`：追加 `scripts/node_modules/`、`scripts/serviceAccountKey.json`

**關鍵提醒（寫在 MIGRATE.md Step 1）**：
- ❌ 不要對正式 Sheet 本體執行
- ✅ 先 **建立副本** 再執行 migration
- ✅ 先 `npm run migrate:dry` 驗證欄位正確，再正式 `npm run migrate`

**下一步使用者要做**：
1. 複製正式 Sheet 為測試副本
2. Firebase Console 下載服務帳號金鑰 → 放 `scripts/serviceAccountKey.json`
3. 把金鑰 email 加入副本 Sheet 的共用
4. `cd scripts && npm install && npm run migrate:dry` 驗證
5. 確認 OK 後 `npm run migrate`

測試：4 suite / 55 全綠。

---

### 階段三 C（完結）：Cloud Functions 全部 17 個 action 實作完成

**本輪新增 11 個 Cloud Functions + 1 個 attendance helper**

新增 helper：
- `src/_attendance.js`：`getMonthlyAttendance`、`summarizeByDay`、`detectAbnormal`、`parseMonth`

新增 functions（依群組）：
- **打卡寫入**：`punchWithoutLocation`、`adjustPunch`
- **打卡查詢**：`getCalendarSummary`、`getAttendanceDetails`、`getCompleteAttendanceRecords`、`getAbnormalRecords`
- **管理員**：`getEmployeeList`、`addLocation`
- **請假審核**：`submitLeave`、`getReviewRequest`、`approveReview`、`rejectReview`

### 實作策略
- 複雜的勞基法判斷（checkAttendance / checkAttendanceCalendar / checkAttendanceAbnormal）
  先做**簡化版**，標 TODO 待對齊 GS Utils.gs
- `reviewRequest` 的 `id` 改用 Firestore docId 取代 GS 的 rowNumber
- 管理員權限檢查統一用 helper `verifyAdmin`
- `submitLeave` / `adjustPunch` 的管理員通知暫留 TODO，等異步通知系統落地後接入

### Cloud Functions 最終狀態
**17 / 17 實作完成**（`testNotification` 列為選擇性，略過）
```
身份：    checkSession、getLoginUrl、getProfile、exchangeToken
打卡寫入：punch、punchWithoutLocation、adjustPunch
打卡查詢：getLocations、getCalendarSummary、getAttendanceDetails、
          getCompleteAttendanceRecords、getAbnormalRecords
管理員：  getEmployeeList、addLocation
請假審核：submitLeave、getReviewRequest、approveReview、rejectReview
```

### DEPLOY.md 更新
Step 6 部署後應看到的 17 個 functions 清單。

測試：4 suite / 55 全綠。主線 useFirestore=false 仍不受影響。

**下一步等待使用者操作**：
1. 升級 Firebase Blaze plan
2. 執行 DEPLOY.md 8 個步驟
3. 準備測試資料（複製正式 Sheet 或用假資料）
4. 在瀏覽器 `?backend=firestore` 走過完整流程驗證

---

### 階段三 C（續）：身份流程 + 打卡核心 Cloud Functions

**脈絡**：階段 B 發現 Firebase Cloud Functions 需要 Blaze plan，使用者決定**晚點升級**，
本輪繼續在分支寫程式碼，升級後可一次部署。

**本輪新增 4 個 Cloud Functions**：
- `src/getLoginUrl.js` — 產生 LINE OAuth 授權 URL
- `src/getProfile.js` — LINE code 換 access_token + id_token，upsert 員工、發 oneTimeToken
- `src/exchangeToken.js` — oneTimeToken 換 sessionToken（單次使用）
- `src/punch.js` — 員工打卡（含 Haversine 距離、地點驗證、backend_timings）

**Helpers 擴充**（`src/_helpers.js`）：
- LINE secrets 宣告：`LINE_CHANNEL_ID`、`LINE_CHANNEL_SECRET`、`LINE_CHANNEL_ACCESS_TOKEN`（defineSecret）
- `validateCoordinates(lat, lng)` — 座標合法性檢查
- `getDistanceMeters(lat1, lng1, lat2, lng2)` — Haversine 公式
- `getAllLocations()` — 讀所有地點（未快取，v1 簡化）
- `upsertEmployee(profile)` — 新員工建立、既有員工更新 lastLoginTime
- `createOneTimeToken(userId)` / `consumeOneTimeToken(otoken)` — 一次性 token 管理

**Firestore 集合新增**：
- `oneTimeTokens` — 一次性 token（getProfile 產生、exchangeToken 消耗）
- `attendance` — 打卡紀錄（由 punch 寫入）

**DEPLOY.md 更新**：
- 新增 Step 4.5「設定 LINE secrets」(`firebase functions:secrets:set`)
- Step 6 完成後應看到 6 個 function

**已實作 Cloud Functions 進度**：6 / 18
- ✅ checkSession、getLoginUrl、getProfile、exchangeToken、punch、getLocations
- ⏳ 下一輪：punchWithoutLocation、adjustPunch、getCalendarSummary、getAttendanceDetails、
  getAbnormalRecords、getCompleteAttendanceRecords、getEmployeeList、addLocation、
  submitLeave、getReviewRequest、approveReview、rejectReview

測試：4 suite / 55 全綠。前端 `useFirestore=false` 保持不變，零風險。

---

## 2026-04-24

### 階段三 C：Cloud Functions MVP 建置（checkSession、getLocations）

**使用者已完成階段 B**：建立 Firebase 專案 `wenhui-check-in-system`（區域
`asia-southeast1`），並將 config 填入 `js/config.js` 的 `API_CONFIG.firebase`。

**本輪建置**：

Firebase Functions 專案完整骨架
- `firebase-functions/firebase.json` — 部署設定含 emulator 埠配置
- `firebase-functions/firestore.rules` — 預設全鎖（所有前端直存一律拒絕）
- `firebase-functions/firestore.indexes.json` — 空索引（之後再加）
- `firebase-functions/functions/package.json` — Node 20 + firebase-admin v12 + firebase-functions v6
- `firebase-functions/functions/index.js` — 主入口（已實作 2、註解 16 個待補 action）
- `firebase-functions/DEPLOY.md` — **給您的一次性部署指南**（8 個步驟含檢查清單）

MVP Cloud Functions（2 個）
- `functions/src/_helpers.js`（88 行）— Admin SDK 單例、集合常數、`verifySession`/`verifyAdmin`
- `functions/src/checkSession.js`（40 行）— 對應 GS `handleCheckSession`
- `functions/src/getLocations.js`（38 行）— 對應 GS `handleGetLocation`

前端 Firebase Web SDK 接入
- `js/firestore-client.js` 骨架升級為真實實作
  - Firebase SDK v10.14.1 透過 CDN 動態 `import()` 載入
  - `initFirestoreClient()` 含 _initPromise 避免重複初始化
  - `callFirestoreFunction()` 依 `params.action` 映射至對應 callable function
  - sessionToken 自動從 localStorage 取出注入 payload
  - 錯誤標準化回應：`ERR_FIRESTORE_NOT_CONFIGURED` / `ERR_FIRESTORE_CALL_FAILED`

**本輪不會跑任何網路請求**（未執行部署前，前端 call 到 Firebase 會回
`ERR_FIRESTORE_NOT_CONFIGURED` 因為 SDK 尚未下載；主線 `useFirestore=false` 不受影響）。

**下一步**：請您執行 `firebase-functions/DEPLOY.md` 的 8 個步驟完成部署，回報後我繼續實作剩餘 Cloud Functions。

---

### 階段三 A：Firestore 切換骨架（分支 vs 主線策略）

**策略**：主線保持 GAS + Google Sheets，本分支逐步切換到 Firestore + Cloud
Functions，資料完全隔離、風險歸零於主線。

**本輪完成（階段 A，零風險前置建設）**：

新增文件：
- `docs/plans/Firestore切換策略-分支vs主線.md` — 策略、技術選擇、階段 A/B/C/D/E checklist
- `firebase-functions/README.md` — Cloud Functions 目錄說明與 GAS action 對照表
- `scripts/migrate-to-firestore.js` — 遷移腳本雛形（骨架未實作 SDK 呼叫，需配置後才能跑）

新增程式碼：
- `js/config.js`：
  - 新增 `API_CONFIG.useFirestore`（預設 `false`）
  - 新增 `API_CONFIG.firebase`（apiKey/projectId 等 placeholder）
  - 新增 runtime override：`?backend=firestore|gas` URL 參數 + `localStorage.backend`
- `js/firestore-client.js`（新檔 118 行）：
  - `initFirestoreClient()`、`callFirestoreFunction(params, loadingId)` 介面
  - 目前是骨架，未配置時回傳 `{ ok: false, code: "ERR_FIRESTORE_NOT_CONFIGURED" }`
  - **完全不執行任何網路呼叫**，不會影響任何資料
- `js/core.js`：`callApifetch` 入口加分流判斷，若 `API_CONFIG.useFirestore=true` 改走 Cloud Functions
- `index.html`：於 core.js 之前載入 firestore-client.js
- `.gitignore`：新增 `serviceAccountKey.json`、`firebase-functions/node_modules/`

**風險評估**：
- 主線合併本分支時 `useFirestore=false`，行為與舊版完全一致
- firestore-client 未配置時直接回錯誤代碼，不呼叫任何網路資源
- 測試全綠（55 / 55）

**下一步（需要您操作）**：
- 階段 B：建 Firebase 測試專案、取得 config、填入 `API_CONFIG.firebase`
- 階段 C：在 `firebase-functions/` 實作 Cloud Functions
- 階段 D：準備測試用 Sheet、跑 migration
- 階段 E：決定切換策略（雙軌 / 漸進合併 / 完全切換）

---

### 重構：抽出 index.html 模板至 templates/（階段二完結）

**調查發現**：index.html 的 5 個內嵌 `<template>` 與配套的
`js/template-loader.js` **完全未被任何程式碼使用**——`UIComponentGenerator`
實際上是純 `document.createElement` 動態生成，不讀取 `<template>` 元素。

**動作**：
- 建立 `templates/` 目錄
- 將 5 個 `<template>` 片段保留至 `templates/ui-components.html`
  （未來重啟外部模板機制時可直接沿用）
- 建立 `templates/README.md` 記錄目的、現況與重啟指南
- 刪除 `index.html` 的 `<div id="templates">...</div>`（line 81-142，62 行）
- 刪除 `js/template-loader.js`（125 行死碼）
- 從 `index.html` 移除 template-loader.js 的 `<script defer>` 載入

**檔案變動**：
| 檔案 | 變化 |
|------|------|
| `index.html` | 731 → 673 行（-58 行，-8%） |
| `js/template-loader.js` | **已刪除**（125 行死碼） |
| `templates/ui-components.html` | 新增（79 行，保留素材） |
| `templates/README.md` | 新增（使用指南） |

**保留**：
- `js/ui-component-generator.js`（實際被 admin.js 使用，非死碼）

**測試結果**：4 suite / 55 測試全綠。

### 🎉 階段二全部完成

所有階段二檢查清單項目已完成或轉為其他形式：
- [x] admin.js 拆分 — 改為透過刪除薪資達成 2511→1179 行（-53%）
- [x] punch.js 拆分 — 1029 行 → 5 個子模組於 js/punch/
- [x] 抽出 index.html 模板至 templates/ — 刪除死碼 + 保留素材
- [x] admin.js 與 modules/payroll.js 衝突 — 兩邊都刪
- [x] Excel 匯出簡化 — 只輸出完整打卡紀錄

---

### 重構：punch.js 拆分完成（第四步：補打卡 UI）

**動作**：將 Region 4「補打卡 UI 與 API 邏輯」搬至 `js/punch/make-up.js`，
punch.js 完全移除（`git mv` 保留歷史）。

**檔案變動**：
| 檔案 | 變化 |
|------|------|
| `js/punch.js` | **已刪除**（原 441 行 → 0） |
| `js/punch/make-up.js` | 新增 461 行（自 punch.js 搬移並重寫檔頭 + UMD export） |
| `index.html` | 移除 `js/punch.js` 載入，改為 `js/punch/make-up.js` |

**模組內容**：
- `validateAdjustTime(value)` — 純函式，驗證補打卡日期在合法範圍
- `bindPunchEvents()` — 超大事件綁定中心（補打卡 Modal、請假/休假按鈕、API 呼叫）

**相容性**：
- `app.js:296` 的 `bindPunchEvents()` 呼叫透過全域相容
- 載入順序：abnormal-records → auto-punch → geolocation → punch-flow → make-up

### 🎉 punch.js 拆分全部完成

| 階段 | punch.js 行數 | 變化 |
|------|---------------|------|
| 原始 | 1029 | — |
| Region 3（異常紀錄） | 799 | -230 |
| Region 2（自動打卡） | 758 | -41 |
| Region 1（核心打卡） | 441 | -317 |
| **Region 4（補打卡 UI）** | **0 / 已刪除** | **-441** |

### js/punch/ 最終結構

```
js/punch/
├── abnormal-records.js  (253 行)  異常紀錄查詢與渲染
├── auto-punch.js        ( 57 行)  URL 參數自動觸發打卡
├── geolocation.js       (188 行)  GPS 權限、精確定位、重試
├── punch-flow.js        (198 行)  doPunch 主流程、權限降級、無定位打卡
└── make-up.js           (461 行)  補打卡 UI、事件綁定、請假/休假申請
```

總計 1157 行（因各模組加檔頭註解與 UMD export 約 +128 行），原 1029 行核心邏輯完整保留、關注點清晰分離。

測試結果：4 suite / 55 測試全綠。

---

### 重構：punch.js 拆分第三步（抽出核心打卡邏輯）

**動作**：將 punch.js Region 1「核心打卡邏輯」拆為兩個關注點獨立的模組。

**檔案變動**：
| 檔案 | 變化 |
|------|------|
| `js/punch.js` | 758 → 441 行（**-317 行**） |
| `js/punch/geolocation.js` | 新增（193 行） |
| `js/punch/punch-flow.js` | 新增（193 行） |
| `index.html` | +2 script 標籤 |

**抽出內容**：

`js/punch/geolocation.js`（定位相關）
- 常數：`PUNCH_GEOLOCATION_OPTIONS`、`GPS_ACCURACY_THRESHOLDS`
- 狀態：`lastPunchPosition`、`geolocationPermissionStatus`
- 函式：`checkGeolocationPermission`、`requestGeolocationPermission`、`getAccurateLocation`

`js/punch/punch-flow.js`（打卡流程）
- 函式：`doPunch`、`handleLocationPermissionDenied`、`submitPunchWithoutLocation`

**相容性**：
- 全域函式宣告保持不變，`app.js:204, 205` 的 `doPunch("上班"|"下班")` 呼叫無影響
- 載入順序：geolocation.js → punch-flow.js → punch.js（punch-flow 依賴 geolocation）
- 4 suite / 55 測試全綠

### punch.js 拆分累計進度

| 階段 | 行數 | 變化 | 累計 |
|------|-----|------|------|
| 原始 | 1029 | — | — |
| 抽 Region 3（異常紀錄） | 799 | -230 | -22% |
| 抽 Region 2（自動打卡） | 758 | -41 | -26% |
| **抽 Region 1（核心打卡）** | **441** | **-317** | **-57%** |

剩餘：Region 4 補打卡 UI（≈421 行，含巨大的 bindPunchEvents）。

---

### 重構：punch.js 拆分第二步（抽出自動打卡模組）

**動作**：將 punch.js Region 2「自動打卡」抽出為獨立模組。

**檔案變動**：
| 檔案 | 變化 |
|------|------|
| `js/punch.js` | 799 → 758 行（-41 行） |
| `js/punch/auto-punch.js` | 新增（59 行） |
| `index.html` | +1 script 標籤 |

**抽出的內容**：
- `checkAutoPunch()` — 解析 URL `?action=in\|out` 後自動點擊對應打卡按鈕

**相容性**：
- 透過全域函式宣告，對 `app.js:358, 369` 的 `checkAutoPunch()` 呼叫完全相容
- 新模組加 UMD export，後續可於 Jest 補測試
- 4 suite / 55 測試全綠

### punch.js 拆分累計進度
| 版本 | 行數 | 變化 |
|------|-----|------|
| 原始 | 1029 | — |
| 抽出 Region 3 | 799 | -230 |
| **抽出 Region 2** | **758** | **-41** |

---

### 重構：punch.js 拆分第一步（抽出異常紀錄模組）

**動作**：將 punch.js Region 3「異常紀錄檢查」抽出為獨立模組。

**檔案變動**：
| 檔案 | 變化 |
|------|------|
| `js/punch.js` | 1029 → 799 行（**-230 行 / -22%**） |
| `js/punch/abnormal-records.js` | 新增 242 行 |
| `index.html` | 新增 1 行 script 標籤 |

**抽出的內容**：
- `checkAbnormal(monthsToCheck, forceRefresh)` — 並行查詢多月異常記錄
- `enrichAbnormalRecordsWithApplicationStatus(records)` — 補上待審核申請狀態
- `renderAbnormalRecords(records)` — 渲染列表（含 DOMPurify XSS 防護）

**相容性**：
- 透過全域函式宣告，對 `app.js:67, 357` 的 `checkAbnormal()` 呼叫完全相容
- index.html 中 `abnormal-records.js` 在 `punch.js` 之前載入，確保依賴順序
- 新模組加 UMD export，後續可直接於 Jest 補測試

**測試結果**：4 suite / 55 測試全綠。

**下一步 punch.js 拆分候選**（尚未做）：
- Region 1「核心打卡」(≈308 行) → `js/punch/geolocation.js` + `punch-flow.js`
- Region 2「自動打卡」(≈36 行) → `js/punch/auto-punch.js`
- Region 4「補打卡 UI」(≈421 行，含巨大的 `bindPunchEvents`) → `js/punch/make-up.js` + `events.js`

---

### 移除：薪資完整拆除（admin.js -53%）

**決策**：Excel 匯出簡化為只匯出完整打卡紀錄，所有薪資相關程式碼全部移除，
為重新設計騰出空間。

**程式碼變動**：
| 檔案 | 前 | 後 | 變化 |
|------|-----|-----|------|
| `js/admin.js` | 2511 行 | 1179 行 | **-1332 行 (-53%)** |
| `index.html` | 758 行 | 731 行 | -27 行（刪除薪資設定卡片） |
| `js/state.js` | 130 行 | 124 行 | -6 行（DOM 宣告） |
| `js/app.js` | 436 行 | 435 行 | -1 行 |
| `js/modules/ui-manager.js` | 196 行 | 192 行 | -4 行 |

**admin.js 移除內容**：
- 常數：`OVERTIME_RATES`、`INSURANCE_RATES`、`DAY_TYPE`
- 純計算函式：`calculateEffectiveHours`、`calculateDailySalary`、
  `calculateDailySalaryFromPunches`、`classifyOvertimeHours`、
  `calculateOvertimeFees`、`calculatePayrollIncome`、
  `calculatePayrollDeductions`、`generatePayrollSummary`
- 日期類型：`isExplicitNonHolidayValue`、`determineDayType`
- Excel 薪資輸出：`generatePayrollSheet`、`generateSamplePayrollFormatSheet`
- 輔助：`setupAdminSalaryToggle`、`resolveHourlyRateForExport`、
  `getPunchesFromRecord`、`pickInOutPunches`、`parseTimeToDate`、
  `computeRawHoursFromPunches`
- `renderAdminDailyRecords` 中顯示當日薪資的 salaryHtml 區塊
- `setupAdminExport` 重寫為只輸出完整打卡紀錄（一個 Sheet）
- 員工資料設定時填入薪資 UI 的兩行（`salaryValueSpan.innerText`、
  `basicSalaryInput.value`）

**index.html 移除內容**：
- 整個「薪資設定」卡片（form-leave-salary，含 basic-salary 滑桿）
  — 其 `onsubmit="handleLeaveSalaryUpdate(event)"` 是既有 bug（handler 不存在）

**state.js / app.js / ui-manager.js 移除內容**：
- DOM 綁定：`basicSalaryInput`、`salaryValueSpan`、`formLeaveSalary`、
  `adminMonthlySalaryDisplay`、`exportPayrollBtn`

**保留（待重新設計時決定）**：
- i18n 各語系的薪資翻譯鍵（`LEAVE_SALARY_SETTINGS`、`BASIC_SALARY`、
  `MONTHLY_SALARY_PREFIX` 等）
- `docs/rules/薪資與加班計算規則整理.md` 等規劃素材

**測試結果**：55 測試全綠，4 suite pass。

---

### 移除：薪資計算死碼（待重新設計）

**決策**：薪資計算邏輯將重新設計，先刪除過時死碼，騰空位給之後的規劃。

**刪除**：
- `js/modules/payroll.js`：簡化版（固定 1.33 倍率），瀏覽器載入後被 admin.js
  的勞基法版本覆蓋而從未實際執行。與 admin.js 的回傳格式也不相容。
- `tests/admin.test.js` 的「薪資計算」區塊（27 測試）：依賴上述已刪模組
- `index.html` 中 `<script>` 載入 payroll.js 的標籤

**保留（待規劃）**：
- `admin.js` 中的 13 個薪資計算函式（OVERTIME_RATES、INSURANCE_RATES、
  calculateEffectiveHours、calculateDailySalary、calculateDailySalaryFromPunches、
  classifyOvertimeHours、calculateOvertimeFees、calculatePayrollIncome、
  calculatePayrollDeductions、generatePayrollSummary、DAY_TYPE、
  isExplicitNonHolidayValue、determineDayType）
- 原因：admin.js 的 Excel 匯出（generatePayrollSheet、
  generateSamplePayrollFormatSheet、匯出 handler）仍呼叫這些函式，貿然移除
  會導致 ReferenceError。需先決定「薪資匯出」是否也要連帶重新設計
- `index.html` 的 form-leave-salary UI 表單
- `i18n` 的薪資相關翻譯鍵（保留待重新設計時沿用或汰換）
- `docs/rules/薪資與加班計算規則整理.md` 等規劃素材

**測試結果**：82 → 55（減少 27 個薪資測試），4 個 suite 全綠。

---

### 修復：超出範圍打卡錯誤訊息未翻譯

**問題**：使用者打卡超出地點範圍時，畫面顯示原始字串
`ERR_OUT_OF_RANGE_DISTANCE:150m_LOCATION:辦公室_RADIUS:100m` 而非可讀錯誤。

**根因**：`GS/DbOperations.gs:362` 把參數塞進 i18n key 字串裡返回給前端，
前端 `t()` 找不到對應翻譯就直接顯示原 key。

**修復**：
- `GS/DbOperations.gs`：改回 `{ ok: false, code: "ERR_OUT_OF_RANGE_WITH_DISTANCE", params: { distance, location, radius } }` 乾淨結構
- `i18n/*.json` × 5 語系：新增 `ERR_OUT_OF_RANGE_WITH_DISTANCE` 翻譯
- `js/modules/i18n.js`：`t()` 新增 fallback 解析舊格式（GAS 重新部署前仍能正確顯示）+ UMD export
- `tests/i18n.test.js`：新增 9 個測試覆蓋 t() 真實函式與向後相容解析

**部署提醒**：Apps Script 需重新部署才能生效新格式；前端 fallback 同時涵蓋舊格式，故任一端先部署都能正確顯示。

---

### 階段二：測試基礎建設

#### 修改
- `js/modules/payroll.js` 尾部新增 UMD export（`typeof module !== 'undefined'` 保護）—瀏覽器不受影響，Node.js/Jest 可 `require`
- `tests/admin.test.js`「薪資計算」改寫：從內聯假函式改為 `require('../js/modules/payroll')` 真實測試，新增常數、`calculateEffectiveHours`、`calculateDailySalary`、`calculateOvertimeFees`、`calculateDailySalaryFromPunches`、`calculateMonthlySalary`、`generatePayrollSummary` 覆蓋（+16 測試）
- `tests/punch.test.js`「補打卡驗證」修正 `toDateString()` 字串比較 bug，改用時間戳比較；測試日期改相對今日，避免硬編碼過期

#### 測試結果
- 從 `52 tests (50 pass, 2 fail)` 提升至 `73 tests (73 pass)`
- admin.test.js 從 26 → 42 個測試

#### 待後續處理
- `admin.js` 與 `modules/payroll.js` 兩套薪資實作衝突——admin.js 勞基法完整版（實際生效）、modules/payroll.js 簡化原型版（被覆蓋為死碼）。需於階段二拆分 admin.js 時統一
- admin.js 黃金測試需先抽純函式到可 require 模組（例如 `js/admin/salary-calculator.js`）

---

### 階段一：清理與奠基

#### 新增
- `docs/專案架構與優化路徑.md` — 全專案架構分析與四階段優化路徑
- `docs/ChangeLog.md` — 本文件
- `docs/guides/`、`docs/plans/` 目錄

#### 搬移（保留 git 歷史）

**根目錄 → docs/**

| 原位置 | 新位置 |
|-------|-------|
| `ASYNC_NOTIFICATION_SYSTEM.md` | `docs/architecture/異步通知系統.md` |
| `FIRESTORE_COMPLETE_MIGRATION.md` | `docs/architecture/Firestore遷移計劃.md` |
| `PERFORMANCE_MIGRATION_PLAN.md` | `docs/issues/效能遷移計劃.md` |

**docs/ 根 → 分類子目錄**

| 原位置 | 新位置 |
|-------|-------|
| `docs/月曆格子顏色定義.md` | `docs/rules/月曆格子顏色定義.md` |
| `docs/異常記錄定義.md` | `docs/rules/異常記錄定義.md` |
| `docs/薪資與加班計算規則整理.md` | `docs/rules/薪資與加班計算規則整理.md` |
| `docs/LINE通知設置指南.md` | `docs/guides/LINE通知設置指南.md` |
| `docs/文檔組織守則.md` | `docs/guides/文檔組織守則.md` |
| `docs/security/前端實施指南.md` | `docs/guides/前端實施指南.md` |
| `docs/優化計劃書.md` | `docs/plans/優化計劃書.md` |
| `docs/Excel導出功能規劃.md` | `docs/plans/Excel導出功能規劃.md` |
| `docs/P2-3_HTML_Optimization_Summary.md` | `docs/plans/P2-3_HTML_Optimization_Summary.md` |

#### 刪除
- `src/main.js` 與 `src/` 目錄（確認 `index.html` 未引用，為聚合死碼）

#### 配置
- `.gitignore`：新增 `dist/`、`.vite/`、`coverage/`（`dist/` 既有追蹤檔案維持追蹤以支援 GitHub Pages 部署）

#### 引用同步
- `docs/security/測試指南-POST改進.md` → 修正「前端實施指南」連結至 `../guides/`
- `docs/plans/Excel導出功能規劃.md` → 修正「月曆格子顏色定義.md」路徑為 `/docs/rules/`
- `docs/專案架構與優化路徑.md` → 同步相關文件索引與階段一檢查清單

---

## 目錄結構（當前）

```
docs/
├── README.md
├── ChangeLog.md
├── 專案架構與優化路徑.md
├── architecture/    系統架構與遷移藍圖
├── guides/          開發與使用指南
├── issues/          問題分析與效能
├── plans/           功能規劃與優化計劃
├── rules/           業務規則定義
└── security/        安全審查
```
