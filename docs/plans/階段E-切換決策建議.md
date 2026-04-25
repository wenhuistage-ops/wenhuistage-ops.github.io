# 階段 E：切換決策建議

**前置**：階段 A–D 全部完成，分支版 Firestore 後端已可完整運作（18 Cloud Functions、5758 筆打卡資料遷移、LINE 通知驗證 6/6）。

**現況**：
- 主線 `main`：仍是 GAS + Google Sheets，正式環境使用中
- 分支 `claude/amazing-rubin-a2b7e2`：Firestore + Cloud Functions，已驗證可用

**決策題**：要怎麼把分支的 Firestore 成果安全地推進「正式環境」？

---

## 三個選項對照

| | A. 永久雙軌 | B. 漸進合併 | C. 完全切換 |
|--|-----------|-----------|-----------|
| 主線（main）後端 | GAS 不變 | 程式碼合進 main，flag 預設關（仍 GAS） | 改為 Firestore |
| 分支保留？ | ✅ 保留作實驗用 | ❌ 合併後刪除 | ❌ 合併後刪除 |
| 風險 | 🟢 零（主線完全不動） | 🟡 中（有 flag 把關，但 main 多了大量程式碼） | 🔴 高（一次切換，回滾要重 deploy） |
| 切換成本 | 永遠在分支用 | 灰度 → 全量，可隨時 flip flag 回滾 | 一刀切，回滾要 push revert |
| 可逆性 | 不適用 | ✅ flag 即時切回 | 中（可 revert，但資料新增已分歧）|
| 資料源 | Sheets（主）+ Firestore（測） | Sheets 為主，雙寫到 Firestore | 純 Firestore |
| 維護負擔 | 低（兩套各自獨立） | 中（短期內維護兩套） | 高（要保證 Firestore 100% 對齊行為）|
| 適合情境 | 您只想做實驗，沒打算實際切換 | 想切換但要逐步驗證 | 對 Firestore 有完整信心 |

---

## 選項 A：永久雙軌（保留現狀）

### 適用情境
- 您覺得 Firestore 不錯但**沒有迫切需要切換**
- 想保留分支當「未來重新設計新功能時的實驗場」
- 主線使用者體驗已經夠用

### 執行
- **不做任何事**
- 偶爾在分支測試新東西，主線繼續用 GAS
- 想停 Firestore 時：在 Firebase Console 暫停 Cloud Functions（省到 0 元）或刪除 Firestore database

### 後續工作
- 無

---

## 選項 B：漸進合併（推薦）

### 適用情境
- 想往 Firestore 走，但要 **可隨時回滾**
- 願意花 1-2 週做灰度
- 想保留 GAS 作為 fallback

### 執行步驟

**Phase B1：合併分支到 main，flag 預設關（半天）**
1. 在 main 分支執行 `git merge claude/amazing-rubin-a2b7e2`
2. 確認 `js/config.js` 的 `useFirestore: false`
3. 推送 main → GitHub Pages 部署（**使用者體驗 0 變化**，仍走 GAS）
4. 結果：main 上**有 Firestore 程式碼但不啟用**

**Phase B2：少數使用者 opt-in（1-2 天）**
1. 您本人或 1-2 位志願者在 Console 設定：
   ```js
   localStorage.setItem('backend', 'firestore'); location.reload()
   ```
2. 觀察是否有問題（您可以隨時切回 `localStorage.removeItem('backend')`）
3. 觀察 Firebase Console → Functions / Firestore 的使用量、錯誤率

**Phase B3：URL 參數讓更多人測（1 週）**
1. 公告：「想試 Firestore 版？網址加 `?backend=firestore` 即可」
2. 部分使用者使用，主流仍 GAS
3. 你可以從 Cloud Functions logs 看用量

**Phase B4：切換預設值（觀察 1 週）**
1. 改 `API_CONFIG.useFirestore: true`
2. 推 main，所有使用者預設走 Firestore
3. 想用 GAS 的人加 `?backend=gas`
4. **這一步可隨時 revert**

**Phase B5：移除 GAS（決定永久切換時）**
- 當所有人都已穩定使用 Firestore 1-2 週
- 移除 `js/config.js` 的 GAS endpoint
- 移除 `core.js` 的 GAS 分支邏輯
- 刪除 `GS/*.gs`（仍可從 git 歷史找回）
- 在 Apps Script Editor 暫停或刪除部署

### 風險與緩解

| 風險 | 緩解 |
|------|------|
| 有使用者誤切到 Firestore 但沒同步資料 | Phase B1 後跑 migration 確保 Firestore 與 Sheets 對齊；Phase B4 切換前再跑一次最終 migration |
| Phase B4 切換後發現 bug | 立刻 push 一個 commit 改 `useFirestore: false` 即回滾 |
| 雙寫期間資料不一致 | **不做雙寫**：選項 B 是「讀寫各自獨立」，使用者體驗的後端取決於 flag |

### 預估工期
- Phase B1：30 分鐘
- B2：1-2 天觀察
- B3：1 週
- B4 + 觀察：1-2 週
- B5：30 分鐘

**總計：2-3 週可完整完成**

---

## 選項 C：完全切換（最激進）

### 適用情境
- 您對 Firestore 有完整信心
- 願意承擔短期 bug 的風險
- 想立刻擺脫 GAS 維護負擔

### 執行步驟

1. **最終 migration**（確保 Firestore 與正式 Sheets 對齊）
   ```bash
   cd scripts
   node migrate-to-firestore.js --clear
   ```
2. **Merge 並切換預設**
   - 在 main 執行 `git merge claude/amazing-rubin-a2b7e2`
   - 改 `js/config.js` 的 `useFirestore: true`
   - 移除 GAS fallback 邏輯
   - 刪除 `GS/*.gs`
3. **Push main**
   - GitHub Pages 部署
   - 所有使用者立即走 Firestore
4. **觀察期 1 週**
   - 看 Cloud Functions logs 是否有錯
   - 看 LINE 通知是否正常
   - 收集使用者回報

### 回滾流程
若發現重大問題：
1. `git revert HEAD~N`（其中 N 是 merge commit 數）
2. 推 main → 立即恢復 GAS
3. 但**新增資料已分歧**：Firestore 新打的卡不會自動回到 Sheets

### 預估工期
- 30 分鐘執行
- 1 週觀察期

---

## 我的推薦：**選項 B（漸進合併）**

### 為什麼？
1. **零回滾痛點**：任何階段都能 flag 即時切回
2. **GitHub Pages 主線體驗 0 變化**：使用者完全無感
3. **您可全程控制節奏**：覺得穩了再往下一階段
4. **保留 GAS 作為長期 fallback**：Phase B5 之前都有兩個後端可選

### 起手式
今天可立刻做 Phase B1（30 分鐘）：
```bash
git checkout main
git pull
git merge claude/amazing-rubin-a2b7e2

# 確認 flag
grep "useFirestore" js/config.js
# 應該看到 useFirestore: false

git push origin main
```

GitHub Pages 上線後，你個人測試 `localStorage.setItem('backend', 'firestore')` 看一切無誤。**主線使用者完全不受影響**。

---

## 切換前的「健康檢查清單」

無論選哪個方案，**切換前**請確認：

- [ ] **資料同步**：最近一次 migration 涵蓋所有正式 Sheets 資料
- [ ] **LINE 通知**：testNotification 6/6 ✅ 已驗證
- [ ] **使用者帳號**：所有員工的 LINE userId 都在 Firestore employees collection
- [ ] **打卡地點**：所有 16 個地點都在 locations
- [ ] **管理員設定**：dept='管理員' 的 6 人正確標記
- [ ] **session 不要遷移**：sessions collection 故意不從 Sheets 遷（讓使用者重新登入即可）
- [ ] **GitHub Pages**：分支端 OAuth callback URL 已加入 LINE Developer Console 白名單

---

## 後續可選的優化（合併後再做）

優先級依序：

1. **對齊勞基法異常規則**（暫停中的 G）
   - `_attendance.js` 對齊 GS Utils.gs 的完整規則
   - 預估 4-6 小時
2. **薪資計算重新設計**
   - 待規劃，與 G 一起做
3. **後端效能優化**
   - In-memory cache（locations、admin list）
   - Firestore 索引優化
4. **退役 GAS**
   - 移除 `GS/*.gs`、Apps Script 部署、相關文件
5. **異步通知改為佇列模式**
   - 大量通知時改用 Firestore queue + scheduled function
   - 目前 fire-and-forget 直推適用小團隊

---

## 決策後請告知

無論選哪個，跟我說「執行 A」/「B」/「C」+ 起點時間，我會：
- 建立對應的 PR / commit 計畫
- 預先寫好回滾腳本
- 監控部署過程
- 整理執行紀錄至 ChangeLog
