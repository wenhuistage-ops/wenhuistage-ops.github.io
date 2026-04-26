# LINE 通知設置指南

## 概述

系統支持在員工提交請假、休假或補打卡申請時，自動發送 LINE 通知給管理員。

## 設置步驟

### 1. 創建 LINE 官方帳號

1. 前往 [LINE Developers](https://developers.line.biz/)
2. 創建 Provider 和 Channel
3. 選擇 "Messaging API" 類型
4. 完成帳號設定

### 2. 獲取必要憑證

在 LINE Developers 控制台中獲取：
- **Channel ID**: 用於用戶登入驗證
- **Channel Secret**: 用於用戶登入驗證
- **Channel Access Token**: 用於發送推送消息

### 3. 設置 Google Apps Script 屬性

在 Google Apps Script 編輯器中：

1. 點擊「專案設定」→「指令碼屬性」
2. 添加以下屬性：

| 屬性名稱 | 值 | 說明 |
|---------|-----|------|
| `LINE_CHANNEL_ID` | 你的 Channel ID | 用於用戶登入 |
| `LINE_CHANNEL_SECRET` | 你的 Channel Secret | 用於用戶登入 |
| `LINE_CHANNEL_ACCESS_TOKEN` | 你的 Channel Access Token | 用於發送通知 |

### 4. 設置員工表

在「員工名單」工作表中添加兩個新欄位：

| 欄位名稱 | 說明 | 範例 |
|---------|------|------|
| 管理員標記 | 標記是否為管理員 | `admin` 或空白 |
| LINE 用戶 ID | 管理員的 LINE 用戶 ID | `U1234567890abcdef...` |

**注意**: 只有標記為 `admin` 且有 LINE 用戶 ID 的員工才會收到通知。

### 5. 獲取管理員的 LINE 用戶 ID

有兩種方式獲取用戶的 LINE ID：

#### 方法一：從登入記錄獲取
當管理員登入系統時，系統會記錄 LINE 用戶 ID，可以從員工表中查看。

#### 方法二：使用 LINE API 獲取
```javascript
// 在瀏覽器控制台執行
// 先登入 LINE 帳號，然後執行：
console.log("你的 LINE 用戶 ID 是: " + userId);
```

## 通知內容

### 請假/休假通知範例
```
📋 新申請通知
👤 申請人: 王小明
📝 類型: 請假
📅 日期: 2026-04-15
📋 原因: 病假
🕒 申請時間: 2026-04-14 15:30
📍 部門: 技術部
```

### 補打卡通知範例
```
🕒 新補打卡申請
👤 申請人: 李小華
📝 類型: 補打卡 (上班)
📅 補打卡時間: 2026-04-13 09:00
🕒 申請時間: 2026-04-14 16:45
📍 部門: 業務部
📋 備註: 忘記打卡
```

## 故障排除

### 通知發送失敗
1. 檢查 `LINE_CHANNEL_ACCESS_TOKEN` 是否正確設置
2. 確認管理員的 LINE 用戶 ID 正確
3. 查看 Google Apps Script 的執行日誌

### 管理員沒有收到通知
1. 確認員工表中管理員標記為 `admin`
2. 確認有正確的 LINE 用戶 ID
3. 檢查管理員是否封鎖了官方帳號

## 安全注意事項

- Channel Access Token 具有發送消息的權限，請妥善保管
- 定期輪換 Access Token 以確保安全性
- 不要在代碼中硬編碼憑證信息