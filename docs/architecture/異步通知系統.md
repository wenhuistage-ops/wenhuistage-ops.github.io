# 異步通知系統實現指南

## 概述

當前補卡/異常申請的通知發送是同步執行，導致 API 超時（>10s）。改為異步批量發送，通過定時觸發器定期處理待發通知隊列。

**目標**：
- 打卡/補卡 API 耗時 < 3s（去掉通知發送）
- 通知在 5-60 分鐘內發送（取決於定時觸發器設置）

---

## 架構設計

### 通知流程

```
用戶補卡 → 寫入通知隊列 → 立即返回 (< 3s)
                ↓
         [定時觸發器]
         (每分鐘/小時)
                ↓
      批量發送待發通知 → 更新發送狀態
```

### 數據結構

新增一個工作表：`通知隊列` (SHEET_NOTIFICATION_QUEUE)

```
列 A: ID (自動遞增或 UUID)
列 B: 通知類型 (adjust_punch/leave/vacation/system)
列 C: 接收人 (userId 或 "admin")
列 D: 消息內容 (JSON 或純文本)
列 E: 優先級 (high/normal/low)
列 F: 創建時間 (timestamp)
列 G: 計劃發送時間 (timestamp)
列 H: 發送狀態 (pending/sent/failed/retrying)
列 I: 重試次數 (0-3)
列 J: 備註/錯誤信息
```

---

## 實現步驟

### Step 1: 創建通知隊列工作表

1. 在 Google Sheets 中新增工作表「通知隊列」
2. 添加表頭：
   ```
   ID | 通知類型 | 接收人 | 消息內容 | 優先級 | 創建時間 | 計劃時間 | 發送狀態 | 重試次數 | 備註
   ```
3. 在 DbOperations.gs 中定義常數：
   ```javascript
   const SHEET_NOTIFICATION_QUEUE = "通知隊列";
   ```

### Step 2: 添加通知入隊函數

```javascript
/**
 * 添加通知到隊列（異步）
 * @param {string} type - 通知類型 (adjust_punch/leave/vacation)
 * @param {string} recipient - 接收人 (admin)
 * @param {string} message - 通知消息
 * @param {string} priority - 優先級 (high/normal/low)
 */
function enqueueNotification(type, recipient, message, priority = 'normal') {
  try {
    const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NOTIFICATION_QUEUE);
    if (!sh) {
      Logger.log("警告: 通知隊列工作表未找到");
      return { ok: false, code: "QUEUE_NOT_FOUND" };
    }

    const now = new Date();
    const row = [
      Utilities.getUuid(), // ID
      type,                // 通知類型
      recipient,           // 接收人
      message,             // 消息內容
      priority,            // 優先級
      now,                 // 創建時間
      now,                 // 計劃發送時間
      'pending',           // 發送狀態
      0,                   // 重試次數
      ''                   // 備註
    ];

    sh.appendRow(row);
    Logger.log(`✓ 通知已加入隊列: ${type} -> ${recipient}`);
    return { ok: true };
  } catch (err) {
    Logger.log("添加通知失敗: " + err.message);
    return { ok: false, error: err.message };
  }
}
```

### Step 3: 修改補卡函數

```javascript
// 補打卡功能
function punchAdjusted(sessionToken, type, punchDate, lat, lng, note) {
  // ... 驗證和寫入邏輯 ...

  // 🚀 P5-3 優化：異步發送通知
  const notificationMessage = `🕒 新補打卡申請\n` +
    `👤 申請人: ${user.name}\n` +
    `📝 類型: 補打卡 (${type})\n` +
    // ... 其他信息 ...;

  // 添加通知到隊列而非立即發送
  enqueueNotification('adjust_punch', 'admin', notificationMessage, 'normal');

  return { ok: true, code: `ADJUST_PUNCH_SUCCESS`, params: { type: type } };
}
```

### Step 4: 添加批量發送函數

```javascript
/**
 * 處理通知隊列 - 批量發送待發通知
 * 由定時觸發器調用（每分鐘或每小時）
 */
function processNotificationQueue() {
  try {
    const queueSh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NOTIFICATION_QUEUE);
    if (!queueSh) {
      Logger.log("通知隊列工作表未找到");
      return;
    }

    const values = queueSh.getDataRange().getValues();
    if (values.length <= 1) {
      Logger.log("通知隊列為空");
      return;
    }

    const headers = values[0];
    const now = new Date();
    let sentCount = 0;
    let failedCount = 0;

    // 按優先級排序（high -> normal -> low）
    const priorityOrder = { 'high': 1, 'normal': 2, 'low': 3 };

    // 遍歷隊列（跳過標題）
    for (let i = 1; i < values.length; i++) {
      const row = values[i];
      const status = row[7]; // 發送狀態
      const retryCount = row[8]; // 重試次數
      const notificationType = row[1]; // 通知類型
      const recipient = row[2]; // 接收人
      const message = row[3]; // 消息內容
      const planTime = new Date(row[6]); // 計劃發送時間

      // 跳過已發送或重試次數過多的通知
      if (status === 'sent' || retryCount >= 3) continue;

      // 檢查是否已到發送時間
      if (planTime > now) continue;

      // 發送通知
      try {
        const result = sendNotification(notificationType, recipient, message);
        
        if (result.ok) {
          // 標記為已發送
          queueSh.getRange(i + 1, 8).setValue('sent');
          queueSh.getRange(i + 1, 10).setValue(`已在 ${Utilities.formatDate(now, "Asia/Taipei", "HH:mm:ss")} 發送`);
          sentCount++;
        } else {
          // 標記為失敗並增加重試次數
          queueSh.getRange(i + 1, 8).setValue('retrying');
          queueSh.getRange(i + 1, 9).setValue(retryCount + 1);
          queueSh.getRange(i + 1, 10).setValue(result.error);
          failedCount++;
        }
      } catch (err) {
        Logger.log(`發送通知失敗 (行 ${i + 1}): ${err.message}`);
        failedCount++;
      }
    }

    Logger.log(`✓ 通知處理完成: ${sentCount} 已發送, ${failedCount} 失敗`);
  } catch (err) {
    Logger.log(`處理通知隊列出錯: ${err.message}`);
  }
}

/**
 * 實際發送通知的函數
 */
function sendNotification(type, recipient, message) {
  try {
    if (type === 'adjust_punch' || type === 'leave' || type === 'vacation') {
      // 發送給管理員
      return notifyAdmins(message);
    }
    return { ok: false, error: '未知的通知類型' };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
```

### Step 5: 設置定時觸發器

#### 方式 A：在 Google Apps Script 編輯器中設置（推薦）

1. 打開 Google Apps Script 編輯器
2. 左側菜單點擊 **⏱️ 觸發器**
3. 點擊 **建立觸發器**
4. 設置：
   - 要執行的函式：`processNotificationQueue`
   - 部署：最新版本
   - 事件來源：時間驅動
   - 觸發器類型：選擇：
     - ⏰ **每分鐘** - 優先級最高通知 < 1 分鐘發送
     - ⏰ **每小時** - 通常 < 1 小時發送（推薦，成本低）
     - ⏰ **每天** - 不推薦，延遲太長
   
5. 點擊 **儲存**

#### 方式 B：用代碼設置觸發器

```javascript
/**
 * 初始化定時觸發器
 * 在首次部署時運行一次
 */
function createNotificationTrigger() {
  // 刪除舊的觸發器
  const triggers = ScriptApp.getProjectTriggers();
  for (const trigger of triggers) {
    if (trigger.getHandlerFunction() === 'processNotificationQueue') {
      ScriptApp.deleteTrigger(trigger);
    }
  }

  // 創建新的每小時觸發器
  ScriptApp.newTrigger('processNotificationQueue')
    .timeBased()
    .everyHours(1)
    .create();

  Logger.log('✓ 通知隊列定時觸發器已創建（每小時）');
}
```

運行一次 `createNotificationTrigger()` 即可。

---

## 配置選項

### 發送頻率

| 頻率 | 優點 | 缺點 | 適用場景 |
|------|------|------|---------|
| **每分鐘** | 通知及時 | Apps Script 配額消耗快 | 高優先級、時間敏感 |
| **每小時** | 平衡，配額節省 | 延遲 < 1 小時 | **推薦** |
| **每天** | 配額最少 | 延遲最長 | 非實時場景 |

**推薦設置**：
- 正常情況：每小時發一次
- 如需更快：可設置每 15 分鐘發一次

### 優先級系統

```javascript
const PRIORITY_LEVELS = {
  'high': 1,      // 立即發送（5 分鐘內）
  'normal': 2,    // 標準（1 小時內）
  'low': 3        // 延遲（24 小時內）
};
```

修改 `processNotificationQueue` 以支持優先級：

```javascript
// 只發送優先級 >= normal 且已過計劃時間的通知
const baseDelay = {
  'high': 5 * 60 * 1000,        // 5 分鐘
  'normal': 60 * 60 * 1000,     // 1 小時
  'low': 24 * 60 * 60 * 1000    // 24 小時
};

const priority = row[4];
const planTime = new Date(row[6]);
const allowedTime = new Date(planTime.getTime() + (baseDelay[priority] || 0));

if (allowedTime > now) continue; // 未到發送時間
```

---

## 監控和維護

### 查看隊列狀態

```javascript
/**
 * 獲取通知隊列統計
 */
function getQueueStats() {
  const queueSh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NOTIFICATION_QUEUE);
  const values = queueSh.getDataRange().getValues();

  let pending = 0, sent = 0, failed = 0, retrying = 0;

  for (let i = 1; i < values.length; i++) {
    const status = values[i][7];
    if (status === 'pending') pending++;
    else if (status === 'sent') sent++;
    else if (status === 'failed') failed++;
    else if (status === 'retrying') retrying++;
  }

  Logger.log(`📊 通知隊列統計:`);
  Logger.log(`   待發送: ${pending}`);
  Logger.log(`   已發送: ${sent}`);
  Logger.log(`   重試中: ${retrying}`);
  Logger.log(`   失敗: ${failed}`);

  return { pending, sent, retrying, failed };
}
```

### 清理舊通知

```javascript
/**
 * 清理 7 天前已發送的通知（釋放空間）
 */
function cleanupOldNotifications() {
  const queueSh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NOTIFICATION_QUEUE);
  const values = queueSh.getDataRange().getValues();

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  let deletedCount = 0;
  for (let i = values.length - 1; i > 0; i--) {
    const createTime = new Date(values[i][5]);
    const status = values[i][7];

    if (createTime < sevenDaysAgo && status === 'sent') {
      queueSh.deleteRow(i + 1);
      deletedCount++;
    }
  }

  Logger.log(`✓ 已清理 ${deletedCount} 條舊通知記錄`);
}
```

設置另一個定時觸發器（每天運行一次）來自動清理。

---

## 故障排查

### 問題 1: 通知沒有發送

**檢查清單**：
1. ✅ 通知隊列工作表是否存在？
2. ✅ 定時觸發器是否已創建？（查看 ⏱️ 觸發器列表）
3. ✅ `notifyAdmins` 函數是否正常工作？
4. ✅ 運行 `getQueueStats()` 檢查隊列狀態
5. ✅ 查看執行日誌（⏱️ 觸發器 > 執行日誌）

### 問題 2: 觸發器運行但未發送

**可能原因**：
- `notifyAdmins` 失敗（如 LINE API 超時）
- 重試次數達到上限（3 次）
- 消息格式錯誤

**解決方案**：
- 檢查備註欄位的錯誤信息
- 增加重試次數限制
- 添加備用通知方式（郵件）

---

## 成本估算

### Apps Script 配額

每個項目每天免費配額：
- 執行時間：6 小時
- Apps Script API 呼叫：20,000 次

**建議設置**：
- ⏰ 每小時運行 `processNotificationQueue` = 24 次/天
- 每次執行 < 5 秒 = 120 秒/天（遠低於 6 小時限制）
- **結論**：完全免費，無額外成本

---

## 實現時間表

| 步驟 | 工作項 | 預計時間 |
|------|--------|---------|
| 1 | 創建通知隊列工作表 | 10 分鐘 |
| 2 | 編寫入隊/批量發送函數 | 30 分鐘 |
| 3 | 修改補卡/異常申請邏輯 | 20 分鐘 |
| 4 | 設置定時觸發器 | 5 分鐘 |
| 5 | 測試和驗證 | 30 分鐘 |
| **總計** | | **95 分鐘（~1.5 小時）** |

---

## 下一步

1. ✅ 創建通知隊列工作表
2. ✅ 複制上述代碼到 DbOperations.gs
3. ✅ 修改補卡/異常申請函數
4. ✅ 設置定時觸發器
5. ✅ 測試通知發送
6. ✅ 監控隊列狀態（首次 24 小時）

---

**文檔版本**: v1.0  
**更新日期**: 2026-04-23  
**作者**: Claude Code
