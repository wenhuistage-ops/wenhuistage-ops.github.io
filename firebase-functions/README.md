# firebase-functions/ — Cloud Functions 後端

## 狀態

**目錄骨架階段**。尚未實作任何 Cloud Function，等待 Firebase 測試專案建立後啟動。

## 目的

取代 `GS/*.gs`（Google Apps Script）作為分支版後端，與 Firestore 配合提供：
- 打卡（`punch`）
- 補卡（`adjustPunch`）
- 請假/休假申請與審核
- 會話管理（`checkSession`、`getProfile`）
- 異常紀錄查詢
- 員工管理
- 匯出資料

## 對應表（原 GAS action → 預計 Cloud Function）

| GAS action | Cloud Function | 備註 |
|-----------|---------------|------|
| `punch` | `exports.punch` | 驗 session、GPS 範圍、寫 attendance |
| `checkSession` | `exports.checkSession` | 驗 sessionToken |
| `getProfile` | `exports.getProfile` | LINE Login 後端交換 token |
| `getAttendanceDetails` | `exports.getAttendanceDetails` | 月度打卡紀錄 |
| `getCalendarSummary` | `exports.getCalendarSummary` | 月曆摘要 |
| `getAbnormalRecords` | `exports.getAbnormalRecords` | 異常列表 |
| `getReviewRequest` | `exports.getReviewRequest` | 待審核申請 |
| `adjustPunch` | `exports.adjustPunch` | 補打卡 |
| `leaveRequest` / `vacationRequest` | `exports.leaveRequest` / `vacationRequest` | 請假 / 休假申請 |
| `approveRequest` / `rejectRequest` | `exports.approveRequest` / `rejectRequest` | 管理員審核 |
| `getEmployeeList` | `exports.getEmployeeList` | 員工清單（管理員） |
| `getLocations` | `exports.getLocations` | 打卡地點 |

## 啟動步驟（待執行）

```bash
# 1. 安裝 Firebase CLI（若尚未安裝）
npm install -g firebase-tools

# 2. 登入 Firebase（使用者帳號操作）
firebase login

# 3. 於本目錄初始化（--existing 用既有專案）
cd firebase-functions
firebase init functions
# 選項：JavaScript / Node 20 / ESLint yes / install dependencies yes

# 4. 撰寫 exports.xxx（見上方對應表）

# 5. 部署到「測試專案」（不要部署到正式專案）
firebase deploy --only functions --project <TEST_PROJECT_ID>
```

## 安全規則原則

- Cloud Functions 內部用 **Admin SDK**，直接讀寫 Firestore（繞過 security rules）
- Firestore security rules 採**預設全拒絕**，前端 Web SDK 無法直讀直寫（以防誤觸）
- 僅允許前端呼叫 Cloud Functions、由函式內部驗證身份後操作資料

## 參考

- `docs/plans/Firestore切換策略-分支vs主線.md` — 整體策略
- `docs/architecture/Firestore遷移計劃.md` — Phase 4 後端重寫細節
- 原始 GAS 邏輯：`GS/DbOperations.gs`、`GS/Handlers.gs`、`GS/Utils.gs`
