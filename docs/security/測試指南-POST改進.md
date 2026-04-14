# 改進 2.1 測試指南（POST 請求改進）

**實施日期**：2026-04-14
**涉及文件**：GS/Main.gs、js/core.js
**測試環境**：Browser DevTools Network 標籤

---

## 快速測試（5 分鐘）

### 步驟 1：打開瀏覽器開發者工具
```
Chrome：F12 或 Cmd+Option+I（Mac）
Firefox：F12 或 Cmd+Option+I（Mac）
Edge：F12
```

### 步驟 2：進入 Network 標籤
- 選擇 "Network" 標籤
- 勾選 "Preserve log"（保留日誌）
- 如有需要，設置 Filter 為 `XHR` 或 `Fetch`

### 步驟 3：登入應用
1. 打開應用首頁
2. 點擊「登入」按鈕
3. 完成 LINE 登入流程

### 步驟 4：檢查請求
1. 找到 第一個 API 請求（應該是 `getProfile`）
2. **關鍵檢查**：
   - ✅ **Request URL** 中 **不應該包含** `token=...` 參數
   - ✅ **Request Method** 應該是 **POST**
   - ✅ **Request Payload** 中 **應該包含** `token=...`

---

## 詳細測試清單

### ✅ 測試 1：登入流程驗證

**目標**：驗證登入時 token 不在 URL 中

**步驟**：
```
1. 清除 localStorage：
   - DevTools > Console
   - 輸入：localStorage.clear()
   - 刷新頁面

2. 點擊「登入」按鈕
   
3. 完成 LINE 驗證（會重定向回來）

4. 等待頁面加載完成

5. 檢查 Network 標籤中的請求
```

**驗證檢查清單**：

| 請求名稱 | 應該的方法 | URL 中有 token? | Payload 中有 token? | 狀態 |
|---------|---------|---------|---------|------|
| getLoginUrl | POST | ❌ 否 | ❌ 否 | ✅ |
| getProfile | POST | ❌ 否 | ✅ 是 | ✅ |
| checkSession | POST | ❌ 否 | ✅ 是 | ✅ |

**預期結果**：
```javascript
// Request URL 範例
https://script.google.com/macros/s/[ID]/exec

// Request Payload 範例（看 "Request" 標籤）
action=checkSession&callback=callback1713000000123abc&token=abc123...
```

### ✅ 測試 2：打卡功能驗證

**目標**：驗證打卡請求使用 POST

**步驟**：
```
1. 完成登入
2. 找到「打卡」按鈕
3. 點擊「打卡」（或「無定位打卡」）
4. 觀察 Network 標籤
```

**驗證檢查清單**：

| 項目 | 預期 | 實際 |
|------|------|------|
| 請求方法 | POST | ☐ |
| URL 中包含 token | ❌ 否 | ☐ |
| Payload 包含 token | ✅ 是 | ☐ |
| Payload 包含 action=punch | ✅ 是 | ☐ |
| 響應 ok: true | ✅ 是 | ☐ |

### ✅ 測試 3：管理員功能驗證

**目標**：驗證管理員操作（補卡審核）使用 POST

**步驟**：
```
1. 以管理員賬號登入
2. 進入「管理員」標籤
3. 點擊「審核」中的「批准」或「拒絕」按鈕
4. 觀察 Network 標籤
```

**驗證檢查清單**：

| 請求 | 應該的方法 | URL 中有 token? | Payload 中有 token? |
|------|---------|---------|---------|
| approveReview | POST | ❌ 否 | ✅ 是 |
| rejectReview | POST | ❌ 否 | ✅ 是 |

### ✅ 測試 4：登出流程驗證

**目標**：驗證登出清除 token

**步驟**：
```
1. 點擊「登出」按鈕
2. 檢查 localStorage 中是否清除了 token
   - DevTools > Console
   - 輸入：localStorage.getItem('sessionToken')
   - 應該返回：null
```

**驗證檢查清單**：
- [ ] localStorage 中的 sessionToken 被清除
- [ ] 頁面回到登入屏幕
- [ ] 刷新後仍需重新登入

---

## 進階驗證（可選）

### 驗證 5：檢查 Request Headers

**打開某個 API 請求 > Request Headers**

```javascript
// 應該看到這些頭
POST /macros/s/[ID]/exec HTTP/1.1
Host: script.google.com
Content-Type: application/x-www-form-urlencoded
Content-Length: [某個數字]
Origin: https://wenhuistage-ops.github.io
// ... 其他頭

// ✅ 不應該看到
Authorization: Bearer ...   // (如果有，說明錯誤地用了 Authorization 頭)
```

### 驗證 6：檢查 Response Headers

**打開某個 API 請求 > Response Headers**

```javascript
// 應該看到
Content-Type: application/json
// 或
Content-Type: text/javascript  // (JSONP)

// 不應該看到
Set-Cookie: ...  // (GAS 不支持設置 Cookie)
```

### 驗證 7：用 curl 命令行測試

```bash
# 獲取有效的 token（登入後從 DevTools 複製）
TOKEN="your_actual_token_here"

# POST 請求測試
curl -X POST \
  "https://script.google.com/macros/s/[YOUR_GAS_ID]/exec" \
  -d "action=checkSession&token=$TOKEN&callback=test" \
  -H "Content-Type: application/x-www-form-urlencoded"

# 應該返回
# test({"ok":true,"user":{...}})
```

---

## 故障排除

### 問題 1：收到 CORS 錯誤

**症狀**：Console 中出現 CORS 錯誤

**可能原因**：
- GAS 端點未啟用 CORS（但 POST 應該支持）
- 考慮檢查 GAS 部署設置

**解決方案**：
```
1. 檢查 GAS 部署 URL 是否正確
2. 確認 Main.gs 中的 doPost 函數存在
3. 重新部署 GAS 應用（New Deployment）
```

### 問題 2：Token 仍然出現在 URL 中

**症狀**：在 Network > Request URL 中看到 `token=...`

**可能原因**：
- js/core.js 未正確更新
- 瀏覽器使用了快取的舊版本

**解決方案**：
```
1. 在 DevTools 中手動清除快取：
   - 右鍵刷新按鈕 > Empty Cache and Hard Refresh
   
2. 或者：
   - DevTools > Application > Clear Site Data
   
3. 重新整理頁面
```

### 問題 3：打卡失敗，顯示「CONNECTION_FAILED」

**症狀**：顯示「連接失敗」錯誤訊息

**可能原因**：
- GAS 端點配置不正確
- doPost 函數未正確實現

**解決方案**：
```
1. 檢查 GAS Main.gs 是否包含 doPost 函數
2. 檢查 browser console 中的詳細錯誤訊息
3. 在 GAS 中添加日誌：
   Logger.log("POST request received: " + JSON.stringify(e.parameter));
4. 檢查 GAS 的 Executions 日誌
```

---

## 測試報告模板

完成測試後，使用此模板記錄結果：

```markdown
# 改進 2.1 測試報告

**測試日期**：2026-04-14
**測試者**：[您的名字]
**環境**：[Chrome/Firefox/Edge] v[版本號]

## 快速測試
- [ ] 登入成功，Network 顯示 POST 請求
- [ ] token 不在 URL 中
- [ ] token 在 Payload 中

## 詳細測試
- [ ] 測試 1：登入流程 - PASS / FAIL
- [ ] 測試 2：打卡功能 - PASS / FAIL
- [ ] 測試 3：管理員功能 - PASS / FAIL
- [ ] 測試 4：登出流程 - PASS / FAIL

## 進階驗證
- [ ] Request Headers 正確
- [ ] Response Headers 正確
- [ ] curl 命令可用

## 出現的問題
1. [描述任何發現的問題]
2. [如何重現該問題]
3. [建議的修復方案]

## 總體評分
- 安全性：⭐⭐⭐⭐⭐ / 5
- 功能性：⭐⭐⭐⭐⭐ / 5
- 性能：⭐⭐⭐⭐⭐ / 5
```

---

## 相關文檔

- 📄 [改進方案 - Session 安全](./改進方案-Session安全.md)
- 📄 [前端實施指南](./前端實施指南.md)
- 📄 [後端檢查清單](./後端檢查清單.md)

---

**預期完成時間**：完成後請回報測試結果
