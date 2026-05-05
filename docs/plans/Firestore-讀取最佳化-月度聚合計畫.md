# Firestore 讀取最佳化｜月度聚合層計畫

> 建立：2026-05-05
> 狀態：規劃中（P0）
> 動機：每日 Firestore reads 持續超過 5 萬次，懷疑為**結構性**問題（非單純流量或缺 cache）
> 相關檔案：[`firebase-functions/functions/src/_attendance.js`](../../firebase-functions/functions/src/_attendance.js)、[`firebase-functions/functions/src/getCalendarSummary.js`](../../firebase-functions/functions/src/getCalendarSummary.js)、[`firebase-functions/functions/src/punch.js`](../../firebase-functions/functions/src/punch.js)

---

## 一、問題盤點（依嚴重度排序）

### 🔴 P0：`attendance` 同時當「交易表」與「顯示來源」，缺聚合層

#### 現況
- `attendance` collection 是單一事實表：每筆打卡 = 1 doc
- **每次 UI 渲染月曆，後端都 query 原始 docs 並即時聚合**（`_attendance.js#getMonthlyAttendance` → `summarizeByDay`）
- in-process cache TTL 只有 5 分鐘，且 Cloud Functions 容器冷啟動後 cache 全失效

#### 讀取放大估算
| 操作 | 讀取次數 |
|------|---------|
| 1 員工 × 1 個月月曆 | ~50–60 docs（30 天 × 2 打卡 ± 申請） |
| 10 員工同時開 app | 10 × 60 = 600 reads |
| 上述 × 1 天 5 次 cache miss | 3,000 reads/天 |
| 管理員切員工＋切月份（5 員工 × 3 月 × 3 次） | 2,700 reads/操作 |
| **保守日總量**（10 員工 + 1 管理員） | **~10K reads/天 只在月曆** |

實際觀察 50K/天 時，等於**每讀一次月曆就在燒一份完整月份的 docs**——沒有任何「物化視圖」（materialized view）。

#### 結構性根因
**沒有「日 / 月聚合 doc」這一層**。前端要看的「每天有沒有打卡、上下班時間、是否異常」其實是**衍生資料**，每次都從 raw 重算等於把計算結果丟掉、再用 Firestore reads 換回來。

---

### 🟡 P1：四種「事件類型」混在 attendance，靠雙欄位區分

#### 現況
`attendance` 同時容納四種語意不同的紀錄：

| 類型 | `adjustmentType` | `audit` | 寫入端點 |
|------|------------------|---------|---------|
| 正常打卡 | `""` | `""` | `punch.js` |
| 補打卡申請 | `"補打卡"` | `"?"` → `v` / `x` | `adjustPunch.js` |
| 請假申請 | `"系統請假記錄"` | `"?"` → `v` / `x` | `submitLeave.js` |
| 休假申請 | （type=`"休假"`） | `"?"` → `v` / `x` | `submitLeave.js` |

#### 影響
- `getCalendarSummary` 每次月查詢都會把「待審核 / 已拒絕」的申請 docs 一起拉回來（雜訊 reads）
- `getReviewRequest` 即使有 `limit(200)` 也是掃 `attendance` 整個 collection（透過 index）

#### 證據
[`_helpers.js#L45-46`](../../firebase-functions/functions/src/_helpers.js) 已經宣告：
```js
REVIEW_REQUESTS: "reviewRequests",
NOTIFICATION_QUEUE: "notificationQueue",
```
**但兩個 collection 全程沒被用到**——表示原始設計就有「拆出 reviewRequests」的意圖，沒做完。

---

### 🟢 P2：`employees` doc 過胖

每次 `verifySession` 都會讀整顆 `employees/{userId}`（包含薪資、勞保等 admin-only 欄位）。Firestore 按 doc 計費不按欄位，所以**不是 read multiplier**，但：
- 薪資資料無謂地放進 `SESSION_CACHE`（記憶體佔用）
- 安全邊界模糊（任何握有 verifySession 結果的程式碼都看得到薪資）

可以延後處理，不在本計畫範圍。

---

## 二、目標（P0 範圍）

| 指標 | 目前 | 目標 |
|------|------|------|
| 1 員工 × 1 月月曆讀取次數 | 50–60 reads | **1 read** |
| 10 員工日讀取量（保守） | ~10K | **~200** |
| 全公司月度讀取（管理員報表） | ~3K | **~150** |
| **全公司月度 Excel 匯出**（30 員工 × 1 月，多 sheet） | ~1,800 reads | **30 reads** |
| **整體 reads 降幅** | — | **30×–60×** |

### 為什麼粒度選「per 員工 per 月」而不是「全公司 per 月」

雖然「全公司 per 月一個 doc」理論上 Excel 匯出只要 1 read，但實務上不可行：

| 問題 | per 員工 per 月（採用） | 全公司 per 月（**否決**） |
|------|------------------------|--------------------------|
| 寫入熱點 | 員工各自的 doc，無爭用 | 任何員工打卡都 transaction 同一 doc，30 人同步打卡會排隊 |
| Doc 大小 | ~30KB/doc，遠低於 1MB 上限 | 30 員工 × 30KB = 900KB，加員工或多打卡就炸 |
| 員工自查月曆 | 1 read 拿自己的 30KB | 1 read 拿全公司 900KB（白費頻寬 + 隱私問題） |
| 全員匯出 | 30 reads（multi-doc batch get） | 1 read |

**結論**：per-員工 per-月是唯一合理粒度。Excel 全員匯出 30 reads 已經比現況 1,800 reads 改善 60×，不需追求極端的 1 read。

---

## 三、設計草案

### 3.1 新 collection：`attendanceMonthly`

#### Schema

```
attendanceMonthly/{userId}_{YYYY-MM}
{
  userId: string,                    // 冗餘儲存方便 query
  month: string,                     // "YYYY-MM"，台北時區
  dailyStatus: [                     // 對應 summarizeByDay 輸出
    {
      date: "YYYY-MM-DD",
      reason: "STATUS_PUNCH_NORMAL" | "STATUS_BOTH_MISSING" | ...,
      hours: number,
      punchInTime: "HH:MM",
      punchOutTime: "HH:MM",
      isHoliday: boolean,
      record: [
        { time, type, location, note, audit, adjustmentType }
      ]
    }
  ],
  recordCount: number,               // 該月打卡筆數，方便 monitoring
  lastEventAt: Timestamp,            // 最後一次 mutation 時間（debug 用）
  schemaVersion: 1,                  // 未來欄位變更可漸進升級
  rebuiltAt: Timestamp,              // 上次完整 rebuild 時間
}
```

#### 為什麼選「月」不是「日」

| 粒度 | 寫成本 | 讀月曆成本 | 最大單 doc 大小 |
|------|--------|-----------|----------------|
| `attendanceDaily/{userId}_{date}` | 1 read + 1 write per punch | 30 reads/月 | < 5KB |
| **`attendanceMonthly/{userId}_{YYYY-MM}`**（採用） | 1 read + 1 write per punch | **1 read/月** | ~30KB（仍遠低於 1MB 上限） |

選月度的代價：每次 punch 要 read-modify-write 一個月文件，會產生輕微的併發爭用。但**單一員工同秒打兩次卡的機率極低**，可接受。

#### 寫入策略：交易（transaction）保證一致

```js
await db.runTransaction(async (tx) => {
  const monthRef = db.collection('attendanceMonthly').doc(`${userId}_${month}`);
  const snap = await tx.get(monthRef);
  const data = snap.exists ? snap.data() : { dailyStatus: [], recordCount: 0, schemaVersion: 1 };

  // 把這筆新打卡併入 dailyStatus
  upsertDayInStatus(data.dailyStatus, newPunch);
  data.recordCount += 1;
  data.lastEventAt = admin.firestore.FieldValue.serverTimestamp();

  tx.set(monthRef, data, { merge: true });
});
```

---

### 3.2 過渡期 fallback：聚合 doc 不存在時退回 raw

`getCalendarSummary.js` 改成：

```js
const monthRef = db.collection('attendanceMonthly').doc(`${userId}_${month}`);
const snap = await monthRef.get();

if (snap.exists) {
  return { ok: true, records: { dailyStatus: snap.data().dailyStatus } };
}

// Fallback：沒聚合 doc 就走舊路徑（讀 attendance + summarizeByDay）
//          並順便 backfill 一份聚合 doc
const records = await getMonthlyAttendance(month, effectiveUserId);
const dailyStatus = summarizeByDay(records);
await monthRef.set({
  userId: effectiveUserId,
  month,
  dailyStatus,
  recordCount: records.length,
  rebuiltAt: admin.firestore.FieldValue.serverTimestamp(),
  schemaVersion: 1,
}, { merge: true });

return { ok: true, records: { dailyStatus } };
```

這個 fallback 也是「lazy backfill」——任何沒有聚合 doc 的月份，第一次讀的時候自動建立。**不需要另外跑 backfill 腳本**。

---

### 3.3 mutation 觸發點清單

每次以下事件，都要更新對應的 `attendanceMonthly` doc：

| 事件 | 端點 | 影響月份 | 維護動作 |
|------|------|---------|---------|
| 員工打卡 | `punch.js` | 打卡所在月 | upsert dailyStatus |
| 自動定位失敗的補打卡 | `punchWithoutLocation.js` | 同上 | 同上 |
| 補打卡申請（待審核） | `adjustPunch.js` | 補卡指定月 | upsert（reason 變 STATUS_REPAIR_PENDING） |
| 補打卡申請被批准 | `approveReview.js` | 同上 | upsert（reason → STATUS_REPAIR_APPROVED） |
| 補打卡申請被拒絕 | `rejectReview.js` | 同上 | 從 dailyStatus 移除該筆 record |
| 請假申請（待審核） | `submitLeave.js` | 請假指定月 | upsert（reason → STATUS_LEAVE_PENDING） |
| 請假申請被批准 | `approveReview.js` | 同上 | reason → STATUS_LEAVE_APPROVED |
| 請假申請被拒絕 | `rejectReview.js` | 同上 | 從 dailyStatus 移除 |

**統一抽到 helper**：`_attendance.js` 新增 `applyEventToMonthly(userId, month, event)`，所有 mutation 端點呼叫這一個入口，避免邏輯分散。

---

### 3.4 cache 策略

聚合後 cache 設計簡化：

```
舊：MONTHLY_CACHE      key=`${userId}|${month}`，value=raw records，TTL 5 min
新：AGGREGATED_CACHE   key=`${userId}|${month}`，value=dailyStatus，TTL 5 min
```

**值得保留的點**：
- 同容器內 5 分鐘內重複讀取直接走 cache（不 read Firestore）
- mutation 端點仍呼叫 `invalidateMonthlyCacheForDate` 清同容器 cache（5 分鐘 TTL 處理跨容器）

---

### 3.5 粒度選擇的完整權衡（per 員工 vs per 員工 per 月 vs per 員工 per 日）

聚合 doc 的「時間切分粒度」是核心設計決策。三種選擇的權衡：

| 粒度 | 範例 doc id | 1 員工 5 年累積大小 | 月曆讀取 | 每次打卡寫入 |
|------|------------|-------------------|---------|-------------|
| 🔴 per 員工（無時間切分） | `attendanceByUser/U123` | ~900KB（逼近 1MB 上限） | 1 read，但下載 900KB | read+write 整顆 900KB |
| 🟢 **per 員工 per 月**（採用） | `attendanceMonthly/U123_2026-05` | 30KB（恆定） | 1 read，下載 30KB | read+write 30KB |
| 🟡 per 員工 per 日 | `attendanceDaily/U123_2026-05-05` | 500B/doc × 1825 docs | 30 reads / 月曆 | read+write 500B |

#### 為什麼 per 員工（無時間切分）不可行

**🔴 1. Firestore 1MB 硬上限**

Firestore 規則：單 doc 最大 1,048,576 bytes。超過寫入失敗。

```
1 天打卡 ≈ 500 bytes
1 月  ≈ 15-30KB
1 年  ≈ 180KB
3 年  ≈ 540KB
5 年  ≈ 900KB ⚠️ 危險區
6 年  ≈ 1.08MB ❌ 寫入失敗
```

外籍員工有些做 3-5 年以上，這是**時間炸彈**——某天打卡突然失敗，可能 silent fail 造成資料遺失。

**🔴 2. 寫入放大（每次打卡讀寫整顆 doc）**

Firestore transaction 是 read-modify-write。5 年資歷員工每次打卡：

```
read attendanceByUser/U123 → 載入 900KB 進記憶體
push 一筆新紀錄
write 整個 900KB 回去
```

對比 per-月只要動 30KB，**30× 的寫入頻寬差距**。

**🔴 3. 歷史月份永遠在被改寫**

per-員工 設計下，員工今天打的卡會把 2024 年的資料一起改寫。per-月 設計下舊月份天然成為 read-only——這個叫 **time-based sharding**（時間分片），是 NoSQL 的標準模式：寫入熱點集中在當月，舊月份永不爭用。

**🟡 4. 員工自查月曆下載多餘資料**

員工要看 5 月月曆，per-員工 必須下載 900KB 全部歷史，JS 過濾出 30KB。30× 的網路頻寬浪費 + 隱私問題。

#### 為什麼 per 日 也不選

per-日 雖然安全（每 doc 500B 永遠不爆），但讀月曆要 30 reads，跟 per-月的 1 read 差 30 倍，失去聚合層的核心價值。

#### 結論

per-員工 per-月 是「**夠細到不會撞 1MB、夠粗到月曆只要 1 read**」的甜蜜點。

---

### 3.6 為什麼保留原 `attendance` collection

P0 上線後 `attendance` 不再被 UI 讀取，會有人問「乾脆刪掉節省成本？」答案是 **強烈建議保留**。

#### 角色定位（事件來源 + 物化視圖 = Event Sourcing）

| Collection | 角色 | 寫入 | 讀取 |
|-----------|------|------|------|
| `attendance` | **Source of truth**（事件來源） | 每次打卡 / 申請仍寫入 | 平常不讀，僅用於對帳 / 修復 / 法規 |
| `attendanceMonthly` | **Materialized view**（物化視圖） | 每次打卡同步聚合 | 所有 UI / 匯出走這裡 |

`attendanceMonthly` 本質是 cache，所有內容衍生自 `attendance`。

#### 為什麼一定要留

**1. 聚合 bug 的修復路徑（最關鍵）**

| 有 `attendance` 的世界 | 沒 `attendance` 的世界 |
|----------------------|----------------------|
| 對帳腳本發現 5 月某員工少 2 筆 → 從 raw 重建該月聚合 | 永久遺失，無從追溯 |
| Schema 演進加 `overtimeMinutes` 欄位 → 從 raw 重算所有歷史 | 只能往前算新資料，舊月永遠沒這個欄位 |
| 「為什麼 5/3 顯示 3 次打卡？」→ query raw 看時間戳記 | 只看得到聚合結果，bug 會 silent fail |

**2. 法規 / 勞檢需要原始紀錄**

勞基法第 30 條第 5 項要求保存出勤紀錄 **5 年**，內容須能逐筆稽核（時間、地點、備註）。聚合的 dailyStatus 不夠，勞檢要看原始事件。

**3. 偵錯能力**

員工申訴「我 5/3 有打卡，怎麼月曆顯示沒打？」
- 有 `attendance`：query 原始事件看時間戳記、GPS、是否有寫入 timestamp
- 沒 `attendance`：只能信聚合結果，但聚合 bug 會 silent fail

#### 儲存成本估算（幾乎為 0）

```
1 筆打卡 ≈ 500 bytes
30 員工 × 4 次/天 × 365 天 × 5 年 = 219,000 筆
總儲存 ≈ 110 MB
Firestore 單價 $0.18/GB/月 → ≈ $0.02/月
```

**5 年累積花費 < $1 USD**，相對於資料遺失的修復成本完全不成比例。

#### `attendance` 上線後的讀取頻率（不影響 reads 配額）

| 情境 | 頻率 |
|------|------|
| Phase 2 lazy backfill | 每員工每月一次（之後永遠 cache hit） |
| Phase 4 對帳腳本（每天凌晨） | 1 次/天，讀昨天約 80 docs |
| 偵錯查單筆 | 罕見 |
| 勞檢法規查詢 | 一年 0-2 次 |
| 全歷史匯出 | 一年 1-2 次 |

正常營運下幾乎不讀，對 reads 配額幾乎無影響。

#### 5-10 年後的選項：冷熱分離（不在本計畫範圍）

如果未來真的覺得 `attendance` 太大：

```
近 1 年：留 Firestore（熱資料，對帳 + 偵錯）
1 年以上：dump 成 JSON.gz 上 GCS（便宜 100×）
3 年以上：歸檔到 GCS Coldline（更便宜）
```

不必現在處理。

---

## 四、實作步驟

### Phase 1：聚合 doc 寫入（單向，shadow write）
**目標：先讓 mutation 端點寫聚合 doc，但讀取端不切換**——這樣可以驗證寫入邏輯正確性，零風險。

- [ ] **1.1** 新增 `_attendance.js#applyEventToMonthly(userId, month, event, { type: 'punch'|'adjust'|'leave', auditState })` helper
- [ ] **1.2** `punch.js` 寫入 attendance 後，呼叫 `applyEventToMonthly`（fire-and-forget，失敗只 log 不阻擋）
- [ ] **1.3** `punchWithoutLocation.js` 同上
- [ ] **1.4** `adjustPunch.js` 同上（type='adjust', auditState='?'）
- [ ] **1.5** `submitLeave.js` 同上（type='leave', auditState='?'）
- [ ] **1.6** `approveReview.js` 寫入後 → `applyEventToMonthly(..., auditState='v')`
- [ ] **1.7** `rejectReview.js` → 從 dailyStatus 移除對應記錄
- [ ] **1.8** 在 staging 環境跑 1–2 天，驗證 `attendanceMonthly` doc 的內容與 `summarizeByDay(getMonthlyAttendance(...))` 完全一致

**Phase 1 結束點**：聚合 doc 內容已正確、但仍走舊讀取路徑（reads 沒降）。

---

### Phase 2：讀取端切換 + lazy backfill
- [ ] **2.1** `getCalendarSummary.js` 改用 §3.2 的 fallback 邏輯：先讀 `attendanceMonthly`，沒有再退回舊路徑並 backfill
- [ ] **2.2** `getCompleteAttendanceRecords.js` 同上（雖前端已不呼叫，仍維護向後相容）
- [ ] **2.3** Deploy → 監測 1 週 reads 數字
- [ ] **2.4** 確認 `attendanceMonthly` 已自動 backfill 過去 N 個月（或寫一次性腳本主動 backfill）

**Phase 2 結束點**：reads 應該掉到 1/30 ~ 1/50。

---

### Phase 3：清理 raw query 路徑
- [ ] **3.1** `getMonthlyAttendance` 標記為 `@deprecated`，只保留 backfill / 異常排查用
- [ ] **3.2** 移除 `getAbnormalRecords.js`（已標 deprecated 且前端不再呼叫）
- [ ] **3.3** 把 `MONTHLY_CACHE`（raw 版）拿掉，只保留 `AGGREGATED_CACHE`

---

### Phase 4（選做）：監測與壓力測試
- [ ] **4.1** 在 `applyEventToMonthly` 加 metric：`event_type / userId / monthKey / latency`
- [ ] **4.2** 寫一個對帳腳本：每天凌晨跑一次，把 `attendanceMonthly` 與重算 `summarizeByDay(getMonthlyAttendance(...))` 比對，若不一致發通知
- [ ] **4.3** 模擬 30 員工同時打卡，確認 transaction 沒有衝突放大讀寫成本

---

## 五、風險與回滾

| 風險 | 機率 | 影響 | 緩解 |
|------|------|------|------|
| transaction 寫入失敗 → punch 卡住 | 低 | 高 | Phase 1 用 fire-and-forget，失敗只 log |
| 聚合 doc 與 raw 不一致 | 中 | 中 | Phase 4 對帳腳本 + lazy backfill 補救 |
| dailyStatus 陣列變超大 | 極低 | 低 | 30 天每天 ~5 records = 150 entries，遠低於 doc 1MB 上限 |
| 補打卡 / 請假 reject 後沒清乾淨 | 中 | 中 | reject 端點明確調用「移除」操作；對帳腳本兜底 |
| 一次性 backfill 失敗 | 低 | 低 | lazy 設計自動處理；不存在「全部失敗」場景 |

**回滾策略**：每個 Phase 都可獨立回滾——Phase 1 拔掉 fire-and-forget call、Phase 2 拔掉聚合 read 改回舊路徑、聚合 doc 留著當 dead data 不影響系統。

---

## 六、驗證與量測

### 上線前
- [ ] 在 staging 對 5 個歷史月份各跑一次：`summarizeByDay(getMonthlyAttendance(月))` 結果 deep-equal `attendanceMonthly` doc 的 `dailyStatus`
- [ ] 模擬一個員工在當月 punch / adjust / leave / approve / reject 各一次，最終 dailyStatus 與 raw 計算完全一致

### 上線後
| 指標 | 監測方式 | 目標 |
|------|---------|------|
| `getCalendarSummary` 平均 reads/call | Cloud Functions metric + Firestore usage | < 2（fallback 命中時 = 60，正常 = 1） |
| `attendanceMonthly` doc 數量 | Firestore Console | 約等於「員工數 × 活躍月數」 |
| 整體日 reads | Firestore Usage | **< 5K**（從 50K+） |
| 異常通報數 | 對帳腳本（Phase 4） | 0 |

---

## 七、附錄：相關檔案 checklist

需要動到的檔案：
- [ ] `firebase-functions/functions/src/_attendance.js`（新增 `applyEventToMonthly`）
- [ ] `firebase-functions/functions/src/_helpers.js`（COLLECTIONS 加上 `ATTENDANCE_MONTHLY: "attendanceMonthly"`）
- [ ] `firebase-functions/functions/src/punch.js`
- [ ] `firebase-functions/functions/src/punchWithoutLocation.js`
- [ ] `firebase-functions/functions/src/adjustPunch.js`
- [ ] `firebase-functions/functions/src/submitLeave.js`
- [ ] `firebase-functions/functions/src/approveReview.js`
- [ ] `firebase-functions/functions/src/rejectReview.js`
- [ ] `firebase-functions/functions/src/getCalendarSummary.js`
- [ ] `firebase-functions/functions/src/getCompleteAttendanceRecords.js`
- [ ] `firebase-functions/firestore.indexes.json`（不需新 index，aggregateMonthly 是 doc-by-id 取）
- [ ] `docs/architecture/資料架構.md`（Phase 2 完成後更新文件）
- [ ] `docs/ChangeLog.md`（每 Phase 上線記一筆）

不需動到的：
- 前端 JS（`getCalendarSummary` 介面不變）
- Firestore rules（同 collection 安全模型）
- `attendance` 原 collection 結構（保留作為 source of truth）

---

## 八、後續延伸（不在本計畫）

完成本計畫後可繼續：
1. **P1**：把 `reviewRequests` 拆出獨立 collection，`getReviewRequest` 不再掃 attendance
2. **P2**：`employees` doc 拆 private subcollection 放薪資 / 勞保
3. **冷啟動**：對熱門 function（`punch` / `checkSession` / `getCalendarSummary`）加 `minInstances: 1`，每月 +$0.06 idle cost 換 cache 永久存活
