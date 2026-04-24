# 文件變更紀錄

> 本文件僅記錄 `docs/` 結構調整與主要文件搬移。
> 程式碼變更請參考 git log。

---

## 2026-04-24

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
