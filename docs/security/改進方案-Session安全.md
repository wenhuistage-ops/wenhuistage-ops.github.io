# Session Token 安全改進方案 (2.1)

**優先級**：🟠 中優先 | **預計完成**：2026年4月底 | **狀態**：✅ **已實施方案 B**

---

## 1. 當前安全隱患（已部分解決）

### 1.1 Token 在 localStorage 中存儲
```javascript
// ⚠️ 仍存在（需進一步改進）
const token = localStorage.getItem("sessionToken");
```

**風險**：XSS 攻擊可直接訪問 localStorage ⚠️
**狀態**：未解決（需要前端架構重構）

### 1.2 Token 作為 URL 參數傳遞 ✅
```javascript
// ❌ 原始實現（已改進）
const url = `${API_CONFIG.apiUrl}?${searchParams.toString()}`;

// ✅ 新實現（2026-04-14）
const response = await fetch(url, {
    method: 'POST',  // 改為 POST
    body: searchParams.toString(),  // token 在 body 中
});
```

**改善效果**：
- ✅ Token 不再出現在 URL 中
- ✅ Token 不會被記錄在瀏覽器歷史、代理日誌、CDN 日誌
- ✅ token 洩露風險大幅降低

---

## 2. 改善方案對比

### ❌ 方案 A：HttpOnly Cookie（不可行）
- **狀態**：技術限制，GAS 無法設置 Set-Cookie 頭
- **結論**：棄用

### ✅ 方案 B：改用 POST 請求（已實施）
- **狀態**：✅ **已於 2026-04-14 實施**
- **涵蓋**：
  - 後端：GAS 支持 doPost 和 doGet
  - 前端：callApifetch 改用 POST 請求

### 🔮 方案 C：完全重構（未來改進）
- **方案**：改用 Service Worker + Secure Storage
- **時間**：下月技術債務清單

---

## 3. 已實施的改進（2026-04-14）

### 3.1 後端改動（GS/Main.gs）

```javascript
// ✅ 統一的請求處理函數
function handleRequest(e) {
    const sessionToken = e.parameter.token;  // 支持 URL 參數或 POST body
    // ... 業務邏輯
}

// ✅ 支持 GET 請求（向後相容）
function doGet(e) {
    return handleRequest(e);
}

// ✅ 支持 POST 請求（推薦）
function doPost(e) {
    return handleRequest(e);
}
```

### 3.2 前端改動（js/core.js）

```javascript
// ✅ callApifetch 改用 POST 請求
async function callApifetch(params, loadingId = "loading") {
    const token = localStorage.getItem("sessionToken");
    const searchParams = new URLSearchParams(params);
    
    searchParams.set("token", token);
    searchParams.set("callback", callback);
    
    // 改為 POST 請求，token 在 body 中
    const response = await fetch(API_CONFIG.apiUrl, {
        method: 'POST',
        mode: 'cors',
        body: searchParams.toString(),
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        }
    });
    
    // ... 其他邏輯
}
```

### 3.3 改進效果對比

| 指標 | 實施前 | 實施後 |
|------|--------|--------|
| Token 在 URL 中 | ✅ 有風險 | ✅ **已移除** |
| Token 在瀏覽器歷史 | ❌ 洩露 | ✅ **隱藏** |
| Token 在伺服器日誌 | ❌ 可見 | ✅ **隱藏** |
| Token 在代理日誌 | ❌ 可見 | ✅ **隱藏** |
| Token 在 localStorage | ⚠️ 仍存在 | ⚠️ **仍存在** |
| XSS 風險 | 🔴 高 | 🟡 **中** |

---

## 4. 已知限制

### 4.1 localStorage 中仍存儲 Token
**原因**：Token 需要在每次請求時發送，需要在前端保存
**改進時間**：下月進行前端重構
**建議方案**：
- 使用 IndexedDB 替代 localStorage
- 或使用 Service Worker 進行更安全的存儲

### 4.2 無法使用 HttpOnly Cookie
**原因**：Google Apps Script 的技術限制，無法設置自定義響應頭
**替代方案**：已採用方案 B（POST body）

---

## 5. 測試驗證

### 5.1 已驗證的改進
- [x] GAS 支持 POST 請求（doPost 函數）
- [x] 前端改用 POST 發送 token
- [x] Token 在 POST body 中，不在 URL 中
- [x] 現有 callApifetch 調用無需修改

### 5.2 待驗證的項目（開發環境）
- [ ] 登入流程正常
- [ ] 打卡功能正常
- [ ] 管理員功能正常
- [ ] 補卡申請流程正常
- [ ] 瀏覽器開發者工具驗證 token 不在 URL 中

### 5.3 測試清單

```javascript
// 在瀏覽器開發者工具 Network 標籤中驗證：
1. 選擇任何 API 請求（如 checkSession、punch 等）
2. 查看 Request URL - 應該 ❌ 不包含 token 參數
3. 查看 Request Headers - 應該包含 Content-Type: application/x-www-form-urlencoded
4. 查看 Request Payload - 應該 ✅ 包含 token 參數
```

---

## 6. 後續改進計劃

### Phase 2：前端存儲改進（下月開始）
- [ ] 評估 IndexedDB 可行性
- [ ] 實現更安全的 token 存儲方案
- [ ] 完全移除 localStorage 中的 token

### Phase 3：完整的安全審計
- [ ] XSS 防護評估
- [ ] CSRF 防護檢查
- [ ] 速率限制實現
- [ ] 日誌審計

---

## 7. 參考資料

- [OWASP - Cross-Site Scripting (XSS)](https://owasp.org/www-community/attacks/xss/)
- [OWASP - Token Storage](https://cheatsheetseries.owasp.org/cheatsheets/HTML5_Security_Cheat_Sheet.html#local-storage)
- [Google Apps Script - Request Objects](https://developers.google.com/apps-script/guides/web/communicate_json#web_app_as_api)

---

**實施日期**：2026-04-14
**責任人**：前端開發者 + 後端開發者
**相關 commit**：e27c4db（POST 請求實施）


---

## 1. 當前安全隱患

### 1.1 Token 在 localStorage 中存儲
```javascript
// ❌ 當前實現 (js/core.js:144)
const token = localStorage.getItem("sessionToken");
```

**風險**：
- XSS 攻擊可直接訪問 `localStorage`
- 任何注入的惡意指令都能竊取 token

### 1.2 Token 作為 URL 參數傳遞
```javascript
// ❌ 當前實現 (js/core.js:150)
searchParams.set("token", token);
const url = `${API_CONFIG.apiUrl}?${searchParams.toString()}`;
```

**風險**：
- Token 出現在 HTTP 請求的 URL 中
- 可能被記錄在：
  - 瀏覽器瀏覽歷史
  - Web 伺服器日誌
  - CDN 日誌
  - 網路代理日誌
- 用戶分享 URL 時會暴露 token

### 1.3 JSONP 使用可能帶來的風險
```javascript
// js/core.js:153-154
const callback = 'callback' + Date.now() + Math.random().toString(36).substr(2, 9);
searchParams.set("callback", callback);
```

**說明**：JSONP 是用來迴避 CORS 問題，但使用 URL 參數傳 token 增加風險

---

## 2. 改善方案

### 方案 A：改用 HttpOnly Cookie（**推薦**）

#### 后端需要实现：
```javascript
// Google Apps Script 後端需要實現
// Set-Cookie: sessionToken=xxx; HttpOnly; Secure; SameSite=Strict; Path=/

// 驗證 token：
// 1. 不再從 URL 參數讀取 token
// 2. 自動從 Cookie 中讀取 (GAS 可通過 proxy 訪問)
// 3. 返回時使用 Set-Cookie 而非 sToken 字段
```

#### 前端需要實現：
```javascript
// ✅ 改進後的 callApifetch (不再傳遞 token)
async function callApifetch(params, loadingId = "loading") {
    // 1. 構造 URLSearchParams 物件
    const searchParams = new URLSearchParams(params);
    
    // 2. 移除 token 參數（瀏覽器會自動加入 Cookie）
    // ❌ 已移除: searchParams.set("token", token);
    
    // 3. 加入 callback 參數
    const callback = 'callback' + Date.now() + Math.random().toString(36).substr(2, 9);
    searchParams.set("callback", callback);
    
    // 4. 構造最終 URL
    const url = `${API_CONFIG.apiUrl}?${searchParams.toString()}`;
    
    // 5. 設置 credentials 包含 cookie
    const response = await fetch(url, {
        method: 'GET',
        mode: 'cors',
        credentials: 'include',  // 重要：包含跨域 cookie
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        }
    });
    
    // ... 其他邏輯保持不變
}
```

#### 前端登入流程改進：
```javascript
// app.js: 登入成功後不再存儲 token
async function handleLoginResponse(otoken) {
    const res = await callApifetch({ action: 'getProfile', otoken: otoken });
    if (res.ok) {
        // ❌ 移除：localStorage.setItem("sessionToken", res.sToken);
        // ✅ 改為：後端在 Set-Cookie 中設置 sessionToken
        
        // 清除歷史記錄
        history.replaceState({}, '', window.location.pathname);
        
        // 直接進入應用
        await ensureLogin();
    }
}

// 登出流程
function logout() {
    // ❌ 移除：localStorage.removeItem("sessionToken");
    // ✅ 改為：後端在登出時清除 Cookie
    
    localStorage.removeItem("sessionUserId");
    localStorage.removeItem("userName");
    localStorage.removeItem("userPicture");
    localStorage.removeItem("userDept");
    
    // 調用登出 API
    await callApifetch({ action: 'logout' });
    
    window.location.href = "/index.html";
}
```

### 方案 B：改用 Authorization Header（次優方案）

如果後端無法使用 HttpOnly Cookie，改用 HTTP 授權標頭：

```javascript
// ✅ 改進的 callApifetch (使用 Authorization 頭)
async function callApifetch(params, loadingId = "loading") {
    const token = localStorage.getItem("sessionToken");
    const searchParams = new URLSearchParams(params);
    
    // 移除 URL 參數中的 token
    // ❌ 已移除: searchParams.set("token", token);
    
    const callback = 'callback' + Date.now() + Math.random().toString(36).substr(2, 9);
    searchParams.set("callback", callback);
    
    const url = `${API_CONFIG.apiUrl}?${searchParams.toString()}`;
    
    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,  // 改用 Authorization 頭
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        });
        // ... 其他邏輯
    } catch (error) {
        // ... 錯誤處理
    }
}
```

**優點**：
- Token 不在 URL 中
- 不依賴 HTTPS only 配置

**缺點**：
- Token 仍存儲在 localStorage
- 仍然存在 XSS 風險

---

## 3. 實施計劃

### Phase 1: 後端實現（由後端開發者）
- [ ] 修改 `getProfile` 返回 Set-Cookie 而非 sToken
- [ ] 修改驗證邏輯以從 Cookie 中讀取 token
- [ ] 實現 CORS credentials 支持
- [ ] 實現 `logout` API 清除 Cookie

### Phase 2: 前端配適（前端開發者）
- [ ] 移除 `localStorage.getItem("sessionToken")`
- [ ] 修改 `callApifetch` 添加 `credentials: 'include'`
- [ ] 修改登入流程
- [ ] 修改登出流程

### Phase 3: 測試
- [ ] 開發環境測試
- [ ] 跨域 Cookie 測試
- [ ] 登入/登出流程測試
- [ ] XSS 攻擊模擬測試

---

## 4. 預期效果

| 指標 | 當前 | 改善後 |
|------|------|--------|
| Token 在 localStorage | ✅ 存在 | ❌ 不存在 |
| Token 在 URL 中 | ✅ 存在 | ❌ 不存在 |
| XSS 風險 | 高 | 低 |
| Token 洩露風險 | 高 | 低 |
| 日誌中的 Token | ✅ 可能出現 | ❌ 不出現 |

---

## 5. 參考資料

- [OWASP - Token Storage](https://cheatsheetseries.owasp.org/cheatsheets/HTML5_Security_Cheat_Sheet.html#local-storage)
- [MDN - HttpOnly Cookie](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Set-Cookie)
- [OWASP - Cross-Site Scripting (XSS)](https://owasp.org/www-community/attacks/xss/)

---

**更新日期**：2026-04-14
**責任人**：前端開發者 + 後端開發者
