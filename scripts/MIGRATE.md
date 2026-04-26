# 資料遷移指南：Google Sheets → Firestore

**對象情境**：您已完成階段 C（Cloud Functions 部署），現在要把正式 Google Sheet 的資料搬進 Firestore。

**關鍵原則**：對 Sheet 副本執行，不要動正式 Sheet 本體。

---

## Step 1 — 複製一份正式 Sheet

1. 打開正式的考勤 Google Sheet
2. 右上角 **檔案 → 建立副本**
3. 命名為例如 `文輝考勤-Firestore遷移測試`
4. 放到您個人 Drive（不要放共用資料夾，避免別人誤動）
5. 從新的網址取得 **Sheet ID**（URL 中間那串）：
   ```
   https://docs.google.com/spreadsheets/d/<這裡就是 Sheet ID>/edit
   ```

## Step 2 — 取得 Firebase 服務帳號金鑰

1. [Firebase Console](https://console.firebase.google.com/project/wenhui-check-in-system/settings/serviceaccounts/adminsdk)
2. 專案設定 → **服務帳戶**
3. 點 **產生新的私密金鑰**，下載 JSON
4. 把檔案重命名為 `serviceAccountKey.json`，放到 `scripts/` 目錄內
5. 確認 `.gitignore` 已包含此路徑（本倉庫已設好）

## Step 3 — 讓服務帳號能讀取您的 Sheet 副本

**這步最容易漏掉**。服務帳號的 email 格式為：
```
firebase-adminsdk-xxxxx@wenhui-check-in-system.iam.gserviceaccount.com
```

1. 打開剛才下載的 `serviceAccountKey.json`
2. 找到 `"client_email"` 欄位，複製該 email
3. 回到 Sheet 副本，點右上 **共用**
4. 貼上 email，權限選 **檢視者**，取消「通知對方」
5. 按分享

## Step 4 — 安裝 script 相依

```bash
cd scripts
npm install
```

會下載 `firebase-admin` + `googleapis`（~100MB node_modules）。

## Step 5 — 設定環境變數

```bash
export TEST_SPREADSHEET_ID="<您的副本 Sheet ID>"
```

（或寫到 `~/.zshrc` 持久化）

## Step 6 — 乾跑驗證

```bash
cd scripts
npm run migrate:dry
```

預期輸出會顯示：
- 來源 Sheet ID、服務帳號路徑
- 每個 collection 要寫入的筆數
- 第 1 筆範例（JSON 格式）確認欄位對應

**請仔細看欄位對應是否正確**。若看到 undefined 或型別錯誤，先告訴我調整。

## Step 7 — 正式執行

驗證 OK 後：

```bash
npm run migrate
```

## 常用變化

```bash
# 僅遷某個 collection
node migrate-to-firestore.js --only=employees
node migrate-to-firestore.js --only=attendance
node migrate-to-firestore.js --only=locations

# 重跑：先清空該 collection 再寫入（避免重複 doc）
node migrate-to-firestore.js --clear
node migrate-to-firestore.js --only=employees --clear
```

## 欄位對應對照表

### 員工名單 → `employees`

| Sheet 欄位順序 | Firestore 欄位 |
|---------------|---------------|
| A userId | `userId`（也是 doc id） |
| B email | `email` |
| C name | `name` |
| D picture | `picture` |
| E firstLoginTime | `firstLoginTime`（Timestamp） |
| F dept | `dept` |
| G salary | `salary`（Number） |
| H leaveInsurance | `leaveInsurance` |
| I healthInsurance | `healthInsurance` |
| J housingExpense | `housingExpense`（Number） |
| K status | `status` |
| L preferredLanguage | `preferredLanguage` |
| M lastLoginTime | `lastLoginTime`（Timestamp） |

### 打卡紀錄 → `attendance`

| Sheet 欄位 | Firestore 欄位 |
|-----------|---------------|
| A 日期 | `timestamp`（Timestamp） |
| B userId | `userId` |
| C dept | `dept` |
| D name | `name` |
| E type | `type`（上班/下班/補打卡/請假 等）|
| F GPS/備註 | `coords` + 解析為 `lat` / `lng`（若是 `(lat,lng)` 格式） |
| G locationName | `locationName` |
| H adjustmentType | `adjustmentType`（補打卡/系統請假記錄 等）|
| I audit | `audit`（? / v / x）|
| J note | `note` |

doc id 格式：`<userId>_<timestampMs>_<index>`（避免重複）

### 打卡地點表 → `locations`

| Sheet 欄位 | Firestore 欄位 |
|-----------|---------------|
| A ID | doc id（若空則自動產 `loc_1`、`loc_2`...） |
| B 地點名稱 | `name` |
| C GPS(緯度) | `lat`（Number） |
| D GPS(經度) | `lng`（Number） |
| E 容許誤差(公尺) | `radius`（Number） |

## 驗證遷移成功

### Firebase Console 檢查
1. Firestore Database → 看集合 `employees` / `attendance` / `locations`
2. 文件數量應與 Sheet 行數相符

### 前端整合測試
遷移完成後：

```bash
# 回到專案根
npm run dev
# 瀏覽器開 http://localhost:5173/?backend=firestore
# 使用 LINE 登入（走 getProfile 流程）
```

## 疑難排解

### `PERMISSION_DENIED: The caller does not have permission`
→ Sheet 沒有分享給服務帳號 email。回 Step 3 分享。

### `Error: ENOENT: no such file or directory, open 'serviceAccountKey.json'`
→ 金鑰檔路徑錯誤。確認 `scripts/serviceAccountKey.json` 存在。

### 遷移後某員工 doc id 是 undefined
→ Sheet 的 userId（A 欄）有空白或格式錯。清理 Sheet 後重跑 `--clear`。

### 打卡資料很多，寫入很慢
→ 正常。每 400 筆一批，Firestore 有寫入速率限制。100 萬筆約需 30-60 分鐘。

---

**遷移完成後**請回報我，接著進入 **階段 E：切換決策**（雙軌 / 漸進合併 / 完全切換）。
