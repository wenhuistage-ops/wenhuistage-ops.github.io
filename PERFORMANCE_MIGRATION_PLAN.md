# 打卡系統性能優化遷移計劃

## 當前現狀分析

### 性能指標
- **打卡總耗時**: 5.8 秒
  - 後端實際耗時: ~1.6 秒
  - GAS 開銷: ~4.2 秒（網絡初始化、垃圾回收等）

### 後端耗時分佈（優化後）
| 操作 | 耗時 | 百分比 | 備註 |
|------|------|--------|------|
| checkSession | 981ms | 61% | 讀 SESSION 表 + 員工快取 |
| getLocationsCached | 289ms | 18% | 讀地點表 + 快取 |
| appendRow | 241ms | 15% | 寫打卡記錄 |
| validateCoordinates | 0ms | 0% | ✅ 已優化 |
| 距離計算 | 1ms | 0% | ✅ 已優化 |
| 其他 | ~100ms | 6% | 數據處理、轉換等 |

### 已應用的優化
- ✅ 會話快取（5 分鐘）
- ✅ 員工信息快取（10 分鐘）
- ✅ 地點數據快取（30 分鐘）
- ✅ 移除排序操作
- ✅ 移除異常記錄檢查（從打卡流程中）
- ✅ 使用 appendRow 而非 getLastRow()

### 優化極限
Google Apps Script 對 Sheets API 的限制：
- 讀寫延遲: ~50-200ms 每次操作
- 無法並行化操作（單線程）
- 無法避免的 GAS 初始化開銷: ~3-4 秒

**結論**: 在 GAS 框架下，打卡時間難以降至 2 秒以下

---

## 遷移方案對比

### 方案 1: Firestore（推薦 ⭐⭐⭐⭐⭐）

**優點**
- ✅ 實時數據庫，毫秒級延遲
- ✅ 支持複雜查詢和索引
- ✅ 自動擴展，支持高並發
- ✅ 完整的安全規則管理
- ✅ 前後端可共享相同 SDK
- ✅ 離線支持（Firestore SDK）

**缺點**
- ⚠️ 不同於 Sheets 的數據模型（需要遷移數據）
- ⚠️ 需要學習 Firestore 規則語法
- ⚠️ 每月免費額度有限（讀寫次數）

**預期性能**
- 打卡耗時: **< 1 秒**（網絡延遲 200-400ms）
- 異常記錄查詢: **< 500ms**

**成本估算**
- 免費層: 5 萬次讀，2 萬次寫/天（足夠中小企業）
- 超出部分: ~$0.06/10萬次操作

**遷移工作量**
- 數據遷移: ~2-3 小時
- 後端重寫: ~1-2 天
- 前端適配: ~0.5 天
- 測試: ~1 天

---

### 方案 2: Google Cloud Functions + Cloud SQL

**優點**
- ✅ 可用 Node.js/Python，更靈活
- ✅ SQL 查詢效率高
- ✅ 與 Google Cloud 生態無縫集成
- ✅ 支持定時任務

**缺點**
- ⚠️ 需要配置數據庫
- ⚠️ 冷啟動延遲較大（~1-2 秒）
- ⚠️ 成本相對較高

**預期性能**
- 打卡耗時: **1-2 秒**（含冷啟動）
- 穩定運行後: **< 1 秒**

**遷移工作量**
- 環境搭建: ~1 天
- 後端開發: ~2-3 天
- 測試: ~1 天

---

### 方案 3: Firebase Realtime Database

**優點**
- ✅ 快速部署
- ✅ 實時同步
- ✅ 免費額度大

**缺點**
- ⚠️ 不支持複雜查詢
- ⚠️ NoSQL 模型，不適合關係型數據
- ⚠️ 數據結構需要重新設計

**預期性能**
- 打卡耗時: **< 800ms**

**遷移工作量**
- ~3-4 天

---

### 方案 4: 繼續使用 GAS（現狀）

**優點**
- ✅ 無需遷移，零改動成本
- ✅ 無需額外費用
- ✅ 所有用戶數據在一個 Sheet 中

**缺點**
- ⚠️ 打卡速度慢（5.8 秒）
- ⚠️ 無法進一步優化
- ⚠️ 未來擴展時會遇到性能瓶頸

---

## 推薦方案：Firestore 遷移

### 為什麼選擇 Firestore？
1. **性能**: 比 GAS 快 5-10 倍
2. **成本**: 免費層足夠日常使用
3. **易用性**: 與 Google 生態相同，學習曲線不陡
4. **前端無需改動**: 可在前端直接使用 Firestore SDK

---

## 遷移步驟規劃

### Phase 1: 準備階段（1-2 天）
- [ ] 評估 Firestore 免費額度是否足夠
- [ ] 創建 Firestore 數據庫
- [ ] 設計集合結構
  - `employees`: 員工信息
  - `attendance`: 打卡記錄
  - `locations`: 打卡地點
  - `sessions`: 會話信息
  - `abnormal_records`: 異常記錄（可選，由後端計算）

### Phase 2: 數據遷移（1-2 天）
- [ ] 編寫 Sheets → Firestore 遷移腳本
- [ ] 驗證數據完整性
- [ ] 創建索引（提高查詢速度）
  ```
  - attendance: 按 userId + 日期複合索引
  - attendance: 按日期降序索引
  ```

### Phase 3: 後端開發（2-3 天）
- [ ] 遷移 punch() 函數
- [ ] 遷移 checkSession() 邏輯
- [ ] 遷移 getAbnormalRecords() 查詢
- [ ] 編寫異常記錄計算邏輯
- [ ] 設置 Firestore 安全規則

### Phase 4: 前端適配（0.5-1 天）
- [ ] 更新 API 調用邏輯
- [ ] 可選：使用 Firestore SDK 直接查詢（推薦用於讀取操作）
- [ ] 移除後端的複雜計算邏輯

### Phase 5: 測試 & 驗證（1 天）
- [ ] 單元測試
- [ ] 集成測試
- [ ] 性能測試對比
- [ ] 灰度發佈（10% → 50% → 100%）

### Phase 6: 優化 & 清理（1 天）
- [ ] 刪除或歸檔舊的 GAS 代碼
- [ ] 添加監控和告警
- [ ] 文檔更新

---

## 數據模型設計（Firestore）

### 員工信息
```
employees/{userId}
├── email: string
├── name: string
├── picture: string
├── firstLoginTime: timestamp
├── dept: string
├── salary: number
├── leaveInsurance: string
├── healthInsurance: string
├── housingExpense: number
├── status: string
├── preferredLanguage: string
└── lastLoginTime: timestamp
```

### 打卡記錄
```
attendance/{docId}
├── timestamp: timestamp (自動排序)
├── userId: string
├── dept: string
├── name: string
├── type: string (上班/下班)
├── gps: string (lat,lng)
├── location: string
├── note: string
├── auditStatus: string (待審核/已批准/已拒絕)
└── auditNote: string
```

### 會話記錄
```
sessions/{sessionToken}
├── userId: string
├── createdAt: timestamp
├── expiresAt: timestamp
├── lastUsedAt: timestamp
```

---

## 成本預估

### 月度成本對比

| 項目 | 現狀 (GAS) | Firestore | Cloud SQL |
|------|-----------|-----------|-----------|
| 基礎設施 | 免費 | 免費（< 5 萬次讀） | $3-10/月 |
| 超額費用 | 無 | ~$2-5/月（若超出） | 按使用量 |
| 總計 | 免費 | **免費-5元/月** | **$3-15/月** |

### 假設條件
- 100 名員工
- 每人每天 2 次打卡 = 200 次/天
- 查詢異常記錄 100 次/天

---

## 風險評估

| 風險 | 影響 | 緩解方案 |
|------|------|---------|
| 遷移期間數據丟失 | 高 | 雙寫驗證，灰度發佈 |
| Firestore 規則配置錯誤 | 中 | 詳細的安全測試 |
| 前端適配不完全 | 中 | 充分的集成測試 |
| 用戶習慣改變 | 低 | UI 無需改動 |

---

## 時間表

```
Week 1 (準備 + 數據遷移)
├─ Day 1: Firestore 配置與設計
├─ Day 2-3: 數據遷移與驗證
└─ Day 4-5: 預留緩衝

Week 2-3 (開發)
├─ Day 1-2: 後端重寫
├─ Day 3-4: 前端適配
└─ Day 5: 集成測試

Week 4 (灰度發佈)
├─ Day 1: 10% 灰度
├─ Day 2-3: 監控 & 修復
├─ Day 4-5: 100% 發佈
└─ Day 6-7: 驗證與文檔

總計: ~4 週
```

---

## 後續改進機會

### 短期（1-3 個月）
- [ ] 添加實時通知（Firestore 訂閱）
- [ ] 員工端自助申請假期
- [ ] 管理員端即時審核

### 中期（3-6 個月）
- [ ] 遷移至 Cloud SQL（如性能仍不滿足）
- [ ] 添加打卡統計分析
- [ ] 集成企業考勤系統

### 長期（6-12 個月）
- [ ] 遷移至完整的微服務架構
- [ ] 添加 AI 異常檢測
- [ ] 支持第三方集成 API

---

## 決策檢查清單

- [ ] 團隊是否願意投入 4 週開發時間？
- [ ] 是否可以接受遷移期間短暫的服務暫停（< 1 小時）？
- [ ] 是否願意學習 Firestore（相對簡單）？
- [ ] 預算是否允許（月成本 0-5 元）？
- [ ] 是否需要保留 GAS 作為備份？

---

## 聯繫與詢問

如有任何疑問，請詳細閱讀 Firestore 官方文檔：
- [Firestore 入門](https://firebase.google.com/docs/firestore)
- [Firestore 定價](https://firebase.google.com/pricing)
- [Firestore 安全規則](https://firebase.google.com/docs/firestore/security/start)

---

**文檔更新日期**: 2026-04-23  
**作者**: Claude Code  
**版本**: v1.0
