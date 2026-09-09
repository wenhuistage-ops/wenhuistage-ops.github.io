# legacy/ — 已停用的 Google Apps Script 後端（僅供查閱）

> **狀態：已於 2026 年停用，不再執行、不再維護、不可切回。**
> 保留原因只有一個：Cloud Functions 的原始碼註解仍以這些檔案為「原始邏輯出處」。

---

## 這是什麼

本目錄是 2026 年之前的 GAS（Google Apps Script）後端原始碼，配合 Google 試算表當資料庫。
2026 年全面遷移到 **Firebase Cloud Functions + Firestore** 之後即停用。

原本放在專案根目錄的 `GS/`，於 2026-09-09 移到這裡，避免被誤認成仍在運作的後端。

| 檔案 | 原用途 |
|---|---|
| `Main.gs` | `doGet` 入口與 action 路由分發 |
| `Handlers.gs` | 各 action 的處理函式（回傳 JSON/JSONP） |
| `DbOperations.gs` | 試算表讀寫（員工、Session、打卡紀錄） |
| `LineApi.gs` | LINE Login OAuth 2.0 流程 |
| `Utils.gs` | 時間轉換、驗證、出勤彙整、異常判定 |
| `Constants.gs` | Sheet 名稱、TTL、時間設定等常數 |
| `判斷昨天有無打卡.gs` | 每日漏打卡提醒（→ 現 `checkYesterdayPunch.js`） |
| `虛擬卡判斷.gs` | 每日虛擬打卡（→ 現 `dailyVirtualPunch.js`） |
| `日期處理.gs` | 日期小工具 |
| `Attendance-System.ods` | 當年試算表資料庫的結構樣本 |

---

## 為什麼不直接刪掉

`firebase-functions/functions/src/` 底下約 24 個檔案的檔頭註解寫著「**對應 GS：Handlers.gs …**」，
用來說明每個 Cloud Function 是從哪段 GAS 邏輯移植過來的；`firebase-functions/README.md`
也直接以路徑指向 `GS/DbOperations.gs`、`GS/Handlers.gs`、`GS/Utils.gs`。

更關鍵的是 `_attendance.js` 仍留有兩處**尚未完成**的 TODO，明確把 GAS 版當成待對齊的規格：

- `_attendance.js:155` — `TODO：對齊 GS Utils.gs 的 checkAttendance / checkAttendanceCalendar`
- `_attendance.js:364` — `TODO：對齊 GS Utils.gs checkAttendanceAbnormal`

在這兩個 TODO 收掉之前，把檔案整個刪掉會讓維護者無從比對規格
（雖然 git 歷史找得回來，但沒人會知道要去翻）。

---

## 使用須知

- **不要部署、不要執行。** 對應的 GAS 專案與試算表已停用。
- **不要當成現行行為的依據。** 現行行為以 `firebase-functions/functions/src/` 為準；
  兩邊不一致時，一律以 Cloud Functions 為正解。
- 前端已鎖死走 Cloud Functions（`js/config.js` 移除了 `apiUrl`，並拿掉 `?backend=gas` 降級開關），
  技術上不可能切回這套後端。

---

## 何時可以真的刪除

上面兩個 `_attendance.js` TODO 完成、且 `firebase-functions/` 內的「對應 GS：」註解清乾淨之後，
本目錄即可整個刪除，歷史留在 git 即可。
