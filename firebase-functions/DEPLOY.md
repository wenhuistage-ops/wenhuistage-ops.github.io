# Firebase 專案部署指南

本文件給**第一次部署 Cloud Functions** 的操作步驟。

**對象專案**：`wenhui-check-in-system`（分支用，測試環境）

---

## 前置需求

1. Firebase 專案 `wenhui-check-in-system` 已建立 ✅
2. 本機需安裝：
   - Node.js 20+
   - Firebase CLI：`npm install -g firebase-tools`

## Step 1 — 登入 Firebase

```bash
firebase login
```

會開啟瀏覽器授權，使用建立專案的同一個 Google 帳號。

## Step 2 — 在本倉庫初始化專案關聯

```bash
cd firebase-functions
firebase use --add
```

選項：
- 選擇 `wenhui-check-in-system`
- 別名 (alias)：`default`

完成後會產生 `firebase-functions/.firebaserc`（已在 `.gitignore`，不會提交）。

## Step 3 — 啟用 Firestore（一次性）

Firebase Console → Firestore Database → 建立資料庫：
- 區域：**asia-southeast1**（新加坡，台灣最近）
- 模式：**以生產模式啟動**（rules 預設全鎖，我們要的就是這樣）
- 初始化需 1–2 分鐘

## Step 4 — 安裝 Cloud Functions 依賴

```bash
cd firebase-functions/functions
npm install
```

會產生 `node_modules/`（已在 .gitignore）。

## Step 4.5 — 設定 LINE secrets（部署前必做）

`getProfile` 與 `getLoginUrl` 需要 LINE Channel ID / Secret / Access Token。
這些值不能寫進程式碼，用 Firebase Secret Manager 儲存：

```bash
# 從 GAS 的 Script Properties 複製對應值
cd firebase-functions
firebase functions:secrets:set LINE_CHANNEL_ID
# 提示輸入時貼上值，Enter 確認

firebase functions:secrets:set LINE_CHANNEL_SECRET
firebase functions:secrets:set LINE_CHANNEL_ACCESS_TOKEN
```

Secret Manager 需啟用 API（首次會提示）。若遇權限錯誤：
- GCP Console → IAM & Admin → Service Accounts → 找到 App Engine default service account → 加「Secret Manager Secret Accessor」角色

驗證已設定：
```bash
firebase functions:secrets:access LINE_CHANNEL_ID
```

## Step 5 — 部署 security rules

```bash
cd firebase-functions
firebase deploy --only firestore:rules
```

確認 `firestore.rules` 內容為「全鎖」。

## Step 6 — 部署 Cloud Functions

**⚠️ 第一次部署時 Firebase 會自動啟用必要 API（Cloud Functions、Cloud Build）**，可能出現計費帳戶要求。文輝考勤量在免費額度內。

```bash
cd firebase-functions
firebase deploy --only functions
```

部署成功後可於 Firebase Console → Functions 查看（17 個）：

**身份與 session**：
- `checkSession`
- `getLoginUrl`
- `getProfile`
- `exchangeToken`

**打卡寫入**：
- `punch`
- `punchWithoutLocation`
- `adjustPunch`

**打卡查詢**：
- `getLocations`
- `getCalendarSummary`
- `getAttendanceDetails`
- `getCompleteAttendanceRecords`
- `getAbnormalRecords`

**管理員**：
- `getEmployeeList`
- `addLocation`

**請假與審核**：
- `submitLeave`
- `getReviewRequest`
- `approveReview`
- `rejectReview`

## Step 7 — 產生測試資料

目前 Firestore 是空的。先手動加幾筆測試資料：

### 7.1 `employees` 集合

在 Firebase Console → Firestore → `+ 啟動集合` → `employees` → 加一筆：

| 欄位 | 值 |
|------|---|
| 文件 ID | `test-user-001`（LINE userId 格式） |
| name | `測試員工` |
| picture | （空或 URL） |
| dept | `員工` 或 `管理員` |

### 7.2 `sessions` 集合

```
集合：sessions
文件 ID：test-session-token-001
欄位：
  userId: "test-user-001"
  createdAt: 2026-04-24T00:00:00Z（timestamp 類型）
```

### 7.3 `locations` 集合

```
集合：locations
文件 ID：office
欄位：
  name: "辦公室"
  lat: 25.033
  lng: 121.565
  radius: 100
```

## Step 8 — 前端測試

本地 dev：

```bash
# 在專案根執行
npm run dev
# 打開 http://localhost:5173/?backend=firestore
```

或於 DevTools Console 設定永久切換：

```js
localStorage.setItem('backend', 'firestore')
localStorage.setItem('sessionToken', 'test-session-token-001')
location.reload()
```

打開 DevTools Network 觀察：
- 應看到對 `asia-southeast1-wenhui-check-in-system.cloudfunctions.net` 的請求
- 不應再看到對 script.google.com 的請求

## 切回 GAS

隨時可切回：

```js
localStorage.setItem('backend', 'gas')
location.reload()
```

或清除 localStorage：

```js
localStorage.removeItem('backend')
location.reload()
```

## 檢查清單

- [ ] `firebase login` 完成
- [ ] `firebase use` 關聯 `wenhui-check-in-system`
- [ ] Firestore 已啟用（asia-southeast1）
- [ ] `npm install` 於 `firebase-functions/functions/` 完成
- [ ] `firebase deploy --only firestore:rules` 成功
- [ ] `firebase deploy --only functions` 成功
- [ ] 手動加入測試資料（employees、sessions、locations 各一筆）
- [ ] 前端 `?backend=firestore` 可呼叫 `checkSession` 與 `getLocations`

完成後回報，我接著實作下一批 action（`getProfile`、`punch`、`getCalendarSummary` 等）。
