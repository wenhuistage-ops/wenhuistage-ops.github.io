# Firestore 切換策略：分支 vs 主線

**策略確定日期**：2026-04-24
**目標**：主線保持 GAS + Google Sheets，分支逐步切換到 Firestore，降低正式環境風險。

---

## 總體方針

| 分支 | 後端 | 資料 | 部署位置 |
|------|------|------|---------|
| `main` | Google Apps Script | Google Sheets | GitHub Pages 根（正式線上） |
| `claude/amazing-rubin-a2b7e2`（本分支） | Cloud Functions | Firestore | GitHub Pages branch 子頁 或 本地 dev |

### 關鍵原則

1. **程式碼必須能同時支援兩種後端** — 透過 feature flag 切換，不能分岔程式碼
2. **前端 `callApifetch` 介面不變** — 底層才切換（GAS HTTP POST / Firebase httpsCallable）
3. **分支預設走 Firestore、主線預設走 GAS** — 但有 runtime override 讓雙邊可互驗
4. **資料不合併** — 分支有獨立的測試用 Firebase 專案，與正式 Sheets 完全隔離

---

## 技術選擇（延續既有 Firestore遷移計劃.md）

| 層 | 技術 | 選擇原因 |
|----|------|---------|
| 後端運算 | **Cloud Functions (Node.js)** | Firebase 生態、取代 GAS 邏輯、httpsCallable 與前端無縫 |
| 資料庫 | **Firestore** | Firebase 免費層、支援即時查詢與索引、比 Sheets 快 5-10 倍 |
| 前端 SDK | **Firebase Web SDK v10 modular（CDN 載入）** | 與既有 Leaflet / DOMPurify 的 CDN 載入模式一致，無需 npm install |
| Auth | **保留現有 LINE Login** | 不動用戶流程；session token 在 Cloud Functions 驗 |

---

## 前端 Feature Flag 設計

新增至 `js/config.js`：

```js
const API_CONFIG = {
  // 主線：GAS endpoint；分支：保留供 fallback
  apiUrl: "https://script.google.com/macros/s/.../exec",
  redirectUrl: "https://wenhuistage-ops.github.io/",

  // Firestore 切換（本分支預設 true，主線保持 false）
  useFirestore: false,

  // Firebase 專案配置（Firestore 啟用時才用）
  firebase: {
    apiKey: null,          // 由使用者填入（Firebase Console → 專案設定）
    authDomain: null,
    projectId: null,
    region: "asia-southeast1",
  },
};

// Runtime override 機制（方便 A/B 測試）
(function applyRuntimeFlagOverride() {
  // URL 參數：?backend=firestore | ?backend=gas
  const params = new URLSearchParams(window.location.search);
  const backendParam = params.get("backend");
  if (backendParam === "firestore") API_CONFIG.useFirestore = true;
  else if (backendParam === "gas") API_CONFIG.useFirestore = false;

  // localStorage：永久覆寫（僅本瀏覽器）
  const stored = localStorage.getItem("backend");
  if (stored === "firestore") API_CONFIG.useFirestore = true;
  else if (stored === "gas") API_CONFIG.useFirestore = false;
})();
```

使用方式：
- `?backend=firestore` → 臨時切到 Firestore（測試用）
- `?backend=gas` → 臨時切到 GAS（fallback）
- `localStorage.setItem('backend', 'firestore')` → 永久（瀏覽器）
- 清除 localStorage 回到 `API_CONFIG.useFirestore` 預設

---

## callApifetch 分流

`js/core.js` 改造為：

```js
async function callApifetch(params, loadingId = "loading") {
  if (API_CONFIG.useFirestore) {
    return await callFirestoreFunction(params, loadingId);
  }
  return await callGasEndpoint(params, loadingId);  // 現有邏輯
}
```

兩端都回傳相同結構的 `{ ok, code, params, records, ... }`，業務層完全無感。

---

## 實作階段（全部在分支進行）

### 階段 A：零風險準備（我主動執行）

- [x] 策略文件（本文件）
- [ ] Feature flag 骨架加入 `js/config.js`
- [ ] 建立 `js/firestore-client.js`：空殼 + `callFirestoreFunction` 介面
- [ ] `core.js` 加入分流邏輯（預設仍走 GAS）
- [ ] 建立 `firebase-functions/` 目錄（空殼 + README）
- [ ] 寫 `scripts/migrate-to-firestore.js` 雛形（不執行）

### 階段 B：需要您操作一次（低成本）

- [ ] 建 Firebase 測試專案（免費層）
- [ ] Firebase Console 取得 config（`apiKey`、`projectId` 等）
- [ ] 填入分支版 `js/config.js` 的 `API_CONFIG.firebase`
- [ ] 把 `API_CONFIG.useFirestore` 改為 `true`（分支專屬）

### 階段 C：後端實作（分支）

- [ ] 撰寫 Cloud Functions：對應 GAS 的每個 action（`punch`、`checkSession`、`getAttendanceDetails`...）
- [ ] 部署 Cloud Functions 到**測試專案**（不影響正式）
- [ ] 寫 Firestore security rules

### 階段 D：資料準備（分支）

- [ ] 複製一份正式 Sheets 為「測試資料來源」（或用全新假資料）
- [ ] 執行 `migrate-to-firestore.js` 把測試資料匯入 Firestore
- [ ] 在瀏覽器 `?backend=firestore` 完整走過所有功能

### 階段 E：決策點

完成階段 D 後，您可以決定：
1. **永久雙軌**：分支版供新功能實驗，主線保持 GAS
2. **漸進合併**：把 Firestore 版本合回主線，但 flag 預設 false，灰度發佈
3. **完全切換**：把 Firestore 設為主線預設，保留 GAS 作為 fallback

---

## 資料隔離保證

| 資產 | 分支存取 | 主線存取 |
|------|---------|---------|
| 正式 Google Sheets | ❌ 分支預設用 Firestore，不碰 Sheets | ✅ 主線唯一來源 |
| 測試 Firebase 專案 | ✅ 只給分支用 | ❌ 主線不連 |
| 正式 GAS endpoint | fallback 用（`?backend=gas`） | ✅ 主線唯一後端 |

**重要**：
- 分支的 `API_CONFIG.apiUrl` 仍保留正式 GAS URL——這是 fallback 用
- 若擔心 fallback 誤觸，可在分支版改成測試 GAS endpoint 或直接拔掉 fallback 能力

---

## 風險清單

| 風險 | 等級 | 緩解 |
|------|-----|------|
| 分支誤連正式 GAS 造成雙寫 | 🟡 | 開發期間禁用 fallback（`useFirestore: true` 且不降級） |
| Firebase 免費層超額 | 🟢 | 測試資料量小，遠低於免費額度 |
| Cloud Functions 冷啟動慢 | 🟡 | 可設 min instances=1（低成本）；初期不優化 |
| Firestore security rules 寫錯導致資料暴露 | 🟠 | rules 先全鎖死、從 Cloud Functions 後端寫；不走前端直寫 |

---

## 相關文件

- [異步通知系統.md](../architecture/異步通知系統.md) — 獨立於 Firestore 的前置改善
- [Firestore遷移計劃.md](../architecture/Firestore遷移計劃.md) — 原始 6 週計畫（本策略為其「分支灰度」版）
- [效能遷移計劃.md](../issues/效能遷移計劃.md) — 性能瓶頸分析與目標
