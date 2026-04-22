# 0rigin Attendance System - 優化計劃書

**生成日期**: 2026-04-22  
**版本**: 1.0  
**狀態**: 待執行

---

## 📊 優化項目概覽

| 優先級 | 項目 | 影響範圍 | 難度 | 預期收益 |
|--------|------|--------|------|---------|
| **P0** | 添加單元測試 | 核心邏輯 | 中 | 高 - 防止 bug、重構信心 |
| **P0** | 修復 XSS 安全漏洞 | 全應用 | 低 | 高 - 安全關鍵 |
| **P0** | 設置構建優化流程 | 整體 | 中 | 高 - 性能、可維護性 |
| **P1** | 代碼組織與模塊化 | 全應用 | 高 | 中 - 可維護性、擴展性 |
| **P1** | 依賴管理整合 | 外部資源 | 低 | 中 - 版本控制、更新 |
| **P1** | 統一 Cache 層設計 | 數據層 | 中 | 中 - 性能、代碼重用 |
| **P2** | 性能優化 (i18n、地圖) | 特定模塊 | 低 | 低 - 加載速度 |
| **P2** | 完善環境配置 | 部署 | 低 | 低 - 易部署性 |
| **P2** | HTML 結構優化 | 前端 | 中 | 低 - 代碼整潔性 |
| **P3** | 自動化 CI/CD 配置 | 部署流程 | 中 | 低 - 自動化 |

---

## 🔴 P0 優先級 (緊急 - 必須先做)

### P0-1: 添加單元測試框架與核心功能測試

**📌 概述**  
當前缺乏測試，導致代碼變更風險高。核心邏輯（日期計算、薪資計算、GPS 判斷）沒有保障。

**🔍 當前狀況**
- package.json 測試腳本為空
- 無任何測試文件
- 核心函數散佈在 punch.js、admin.js 中，無 test coverage

**📋 實施步驟**
1. 添加測試依賴：
   ```bash
   npm install --save-dev jest @testing-library/dom @testing-library/jest-dom
   ```
2. 創建測試文件結構：
   ```
   tests/
   ├── core.test.js          (i18n、日期、cache 邏輯)
   ├── punch.test.js         (打卡、GPS 驗證、異常判定)
   ├── admin.test.js         (薪資計算、權限校驗)
   └── fixtures/             (測試數據)
   ```
3. 配置 jest.config.js
4. 覆蓋核心函數測試：
   - `loadTranslations()`
   - `calculateSalary()` (薪資計算)
   - `verifyGPSLocation()` (定位驗證)
   - `checkAbnormalRecords()` (異常判定)

**📊 相關文件**
- `js/punch.js` (994 行 - 打卡核心邏輯)
- `js/admin.js` (2517 行 - 薪資計算、權限管理)
- `js/core.js` (347 行 - 翻譯、API 調用)

**⏱️ 預期時間**: 4-6 小時  
**難度**: 中  
**收益**: 高 (防止回歸 bug、支持重構)

---

### P0-2: 修復 XSS 安全漏洞

**📌 概述**  
多處使用 `innerHTML` 動態插入 HTML，可能導致 XSS 攻擊。

**🔍 當前狀況**
```javascript
// ❌ 不安全的模式 (共 10+ 處)
abnormalList.innerHTML = '';  // punch.js:486
li.innerHTML = `...`;         // punch.js:556
adjustmentFormContainer.innerHTML = formHtml;  // punch.js:705
```

**📋 實施步驟**
1. 審計所有 `innerHTML` 使用（已找到 10+ 處）
2. 替代方案：
   - 清空：用 `element.textContent = ''` 或 `element.replaceChildren()`
   - 插入 HTML：用 `element.innerHTML = DOMPurify.sanitize(html)` 或改用 DOM API
3. 安裝 DOMPurify：
   ```bash
   npm install dompurify
   ```
4. 逐個文件替換：
   - `js/punch.js` - 6 處
   - `js/admin.js` - 檢查
   - `js/ui.js` - 檢查

**📊 受影響文件**
- `js/punch.js` (異常列表、補打表單)
- `js/admin.js` (員工列表、表單)
- `js/ui.js` (UI 渲染)

**⏱️ 預期時間**: 2-3 小時  
**難度**: 低  
**收益**: 高 (安全關鍵)

---

### P0-3: 設置構建優化流程

**📌 概述**  
當前無 minification、無 bundling、無 code splitting，導致加載時間長。

**🔍 當前狀況**
- 8 個 JS 文件逐個加載（總 5.5KB 源碼，未壓縮）
- CSS 未 minify（style.css 364 行 + dist/compiled.css 52KB）
- 依賴通過 CDN 加載（Leaflet、XLSX、字體）
- 無構建步驟

**📋 實施步驟**
1. 選擇構建工具：**推薦 Vite**（輕量、快速開發迴圈）
   ```bash
   npm install --save-dev vite @vitejs/plugin-legacy
   ```

2. 創建 vite.config.js：
   ```javascript
   import { defineConfig } from 'vite'
   
   export default defineConfig({
     build: {
       target: 'es2015',
       minify: 'terser',
       sourcemap: false,
       outDir: 'dist',
     }
   })
   ```

3. 更新 package.json scripts：
   ```json
   {
     "scripts": {
       "dev": "vite",
       "build": "vite build",
       "preview": "vite preview",
       "test": "jest"
     }
   }
   ```

4. 遷移 JS 為 ES modules：
   - 將 `js/*.js` 改為 ES6 modules
   - 創建 `src/main.js` 作為入口點
   - 使用 `import` 代替 `<script>` 標籤

5. 配置 CSS：
   - 統一將 style.css、compiled.css 合併或遷移至 Tailwind
   - Vite 自動 minify

6. 外部資源優化：
   - Leaflet: 改用 npm 包
   - XLSX: 改用 npm 包
   - 字體: 內聯或使用 cdn (保持現狀)

**📊 相關文件**
- `index.html` (所有 <script> 標籤)
- `js/` (所有 .js 文件)
- `style.css`
- `dist/` (新輸出目錄)

**⏱️ 預期時間**: 6-8 小時  
**難度**: 中  
**收益**: 高 (性能、可維護性)

---

## 🟠 P1 優先級 (高優先 - 應在 P0 後進行)

### P1-1: 代碼組織與模塊化改進

**📌 概述**  
160+ 全局變數散佈在 state.js，缺乏命名空間，難以維護。

**🔍 當前狀況**
```javascript
// ❌ state.js 中的全局污染
let monthDataCache = {};
let detailMonthDataCache = {};
let monthCacheOrder = [];
let monthDetailLoadPromises = {};
let adminMonthNavigationHistory = [];
// ... 還有 100+ 個類似的全局變數
```

**📋 實施步驟**
1. 創建全局狀態命名空間：
   ```javascript
   // src/state/store.js
   const AppState = {
     user: {
       id: null,
       name: null,
       isAdmin: false,
       token: null
     },
     cache: {
       month: {},
       monthDetail: {},
       abnormalRecords: null,
       abnormalRecordsCacheTime: null
     },
     ui: {
       currentLang: 'zh-TW',
       currentMonthDate: new Date(),
       adminSelectedUserId: null
     }
   };
   ```

2. 遷移全局變數至命名空間

3. 將相關函數分組為對象：
   ```javascript
   const CacheManager = {
     getMonthData(month) { ... },
     setMonthData(month, data) { ... },
     clearCache() { ... }
   };
   ```

4. 創建模塊結構：
   ```
   src/
   ├── modules/
   │   ├── auth.js          (登錄、權限)
   │   ├── punch.js         (打卡邏輯)
   │   ├── admin.js         (管理員功能)
   │   ├── cache.js         (統一 cache 管理)
   │   ├── i18n.js          (翻譯)
   │   └── location.js      (地圖、定位)
   ├── state/
   │   └── store.js         (全局狀態)
   └── main.js              (入口)
   ```

**📊 相關文件**
- `js/state.js` (159 行 - 全局變數定義)
- 所有 `js/*.js` 文件

**⏱️ 預期時間**: 8-10 小時  
**難度**: 高  
**收益**: 中 (代碼可維護性、擴展性)

---

### P1-2: 依賴管理整合

**📌 概述**  
多個外部資源通過 CDN 加載，版本不可控，應納入 npm 依賴管理。

**🔍 當前狀況**
```html
<!-- 當前 CDN 方式 -->
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"></script>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700"></link>
```

**📋 實施步驟**
1. 添加 npm 依賴：
   ```bash
   npm install leaflet xlsx
   npm install --save-dev @types/leaflet  # TypeScript support (可選)
   ```

2. 檢查 tailwindcss 依賴：
   - 確認 @tailwindcss/forms 是否已安裝：
     ```bash
     npm list @tailwindcss/forms
     ```
   - tailwind.config.js 中已配置 `@tailwindcss/forms`，但 package.json 未列出，應添加

3. 更新 package.json：
   ```json
   {
     "dependencies": {
       "@tailwindcss/cli": "^4.1.16",
       "tailwindcss": "^4.1.16",
       "@tailwindcss/forms": "^0.5.x",
       "leaflet": "^1.9.x",
       "xlsx": "^0.18.x",
       "dompurify": "^3.x"
     }
   }
   ```

4. 在代碼中使用 import：
   ```javascript
   import L from 'leaflet';
   import * as XLSX from 'xlsx';
   import DOMPurify from 'dompurify';
   ```

5. 移除 HTML 中的 CDN 標籤

**📊 相關文件**
- `package.json`
- `index.html` (script/link CDN 標籤)
- `js/location.js` (Leaflet 使用)
- `js/admin.js` (XLSX 使用)

**⏱️ 預期時間**: 2-3 小時  
**難度**: 低  
**收益**: 中 (版本控制、依賴管理)

---

### P1-3: 統一 Cache 層設計

**📌 概述**  
多處 cache 邏輯重複（monthDataCache、detailMonthDataCache、abnormalRecordsCache），應統一管理。

**🔍 當前狀況**
```javascript
// ❌ 分散在各處的 cache 邏輯
let monthDataCache = {};
let monthCacheOrder = [];
const MAX_MONTH_CACHE_ENTRIES = 12;

let detailMonthDataCache = {};
let detailMonthCacheOrder = [];
const MAX_DETAIL_MONTH_CACHE_ENTRIES = 6;

let abnormalRecordsCache = null;
let abnormalRecordsCacheTime = null;
const ABNORMAL_RECORDS_CACHE_DURATION = 5 * 60 * 1000;
```

**📋 實施步驟**
1. 創建統一 Cache Manager：
   ```javascript
   // src/modules/cache.js
   class CacheManager {
     constructor() {
       this.caches = {};
       this.durations = {};
       this.maxSizes = {};
     }
     
     register(key, maxSize, duration) {
       this.caches[key] = {};
       this.maxSizes[key] = maxSize;
       this.durations[key] = duration;
     }
     
     get(key, subKey) { /* LRU 獲取 */ }
     set(key, subKey, data) { /* LRU 設置 */ }
     clear(key) { /* 清空指定 cache */ }
   }
   ```

2. 遷移現有 cache 邏輯：
   - monthDataCache → cacheManager.set('month', date, data)
   - detailMonthDataCache → cacheManager.set('monthDetail', date, data)
   - abnormalRecordsCache → cacheManager.set('abnormal', 'records', data)

3. 添加 cache 統計功能（開發用）

**📊 相關文件**
- `js/state.js` (cache 定義)
- `js/core.js` (API 調用)
- `js/punch.js` (月份數據加載)
- `js/admin.js` (管理員數據加載)

**⏱️ 預期時間**: 4-5 小時  
**難度**: 中  
**收益**: 中 (代碼重用、性能管理)

---

## 🟡 P2 優先級 (中優先 - 效果有限)

### P2-1: 性能優化 (i18n 預加載、地圖延遲加載)

**📌 概述**  
i18n 每次切換重新 fetch，地圖初始化時不必需要，可優化。

**🔍 當前狀況**
```javascript
// ❌ 每次都重新 fetch
async function loadTranslations(lang) {
    const res = await fetch(`https://wenhuistage-ops.github.io/i18n/${lang}.json`);
    translations = await res.json();
}

// ❌ 地圖在頁面加載時初始化（location tab 可能不用）
```

**📋 實施步驟**
1. i18n 預加載：
   - 構建時將 i18n JSON 文件內聯至 JS
   - 或在應用啟動時預加載所有語言

2. 地圖延遲加載：
   - 只在用戶點擊 "定位" Tab 時初始化 Leaflet
   - 減少首頁加載時間

3. 添加性能指標監測：
   ```javascript
   console.time('i18n-load');
   console.timeEnd('i18n-load');
   ```

**⏱️ 預期時間**: 2-3 小時  
**難度**: 低  
**收益**: 低 (邊際性能提升)

---

### P2-2: 環境配置優化

**📌 概述**  
API URL、重定向 URL 硬寫在 config.js，應支持環境變數。

**🔍 當前狀況**
```javascript
// config.js
const API_CONFIG = {
  apiUrl: "https://script.google.com/macros/s/AKfycby28KblKy-...",
  redirectUrl: "https://wenhuistage-ops.github.io/"
};
```

**📋 實施步驟**
1. 創建 `.env.example` 和 `.env` 文件：
   ```
   VITE_API_URL=https://script.google.com/macros/s/...
   VITE_REDIRECT_URL=https://wenhuistage-ops.github.io/
   ```

2. 配置 Vite 環境變數讀取：
   ```javascript
   const API_CONFIG = {
     apiUrl: import.meta.env.VITE_API_URL,
     redirectUrl: import.meta.env.VITE_REDIRECT_URL
   };
   ```

3. 更新 .gitignore：
   ```
   .env
   .env.local
   ```

**⏱️ 預期時間**: 1-2 小時  
**難度**: 低  
**收益**: 低 (易部署性)

---

### P2-3: HTML 結構優化

**📌 概述**  
index.html 744 行，包含大量重複 HTML，可提取為模板。

**🔍 當前狀況**
- 多個相似的 card/form 結構重複
- 難以維護和修改樣式

**📋 實施步驟**
1. 識別重複結構（card、form、list）
2. 創建 HTML template：
   ```html
   <template id="card-template">
     <div class="card">...</div>
   </template>
   ```
3. 用 JS 克隆和填充模板

或更進一步，遷移至 Web Components 或前端框架（如 Vue.js）

**⏱️ 預期時間**: 3-4 小時  
**難度**: 中  
**收益**: 低 (代碼整潔性)

---

## 🔵 P3 優先級 (低優先 - 可選)

### P3-1: 自動化 CI/CD 配置

**📌 概述**  
添加 GitHub Actions 自動構建和部署。

**📋 實施步驟**
1. 創建 `.github/workflows/build-deploy.yml`
2. 配置步驟：
   - 安裝依賴
   - 運行測試
   - 執行構建
   - 部署至 GitHub Pages

**⏱️ 預期時間**: 2-3 小時  
**難度**: 中  
**收益**: 低 (自動化)

---

## 📅 優化執行計劃

### 階段一 (第 1-2 周) - 安全與構建基礎
1. **P0-2**: 修復 XSS 漏洞 (2-3h)
2. **P0-3**: 設置構建優化流程 (6-8h)
3. **P0-1**: 添加單元測試框架 (4-6h)

**里程碑**: 代碼可以安全地構建和測試

### 階段二 (第 3-4 周) - 代碼整潔
4. **P1-2**: 依賴管理整合 (2-3h)
5. **P1-3**: 統一 Cache 層設計 (4-5h)
6. **P1-1**: 代碼組織與模塊化 (8-10h)

**里程碑**: 代碼架構清晰、可維護

### 階段三 (第 5 周) - 性能與自動化
7. **P2-1**: 性能優化 (2-3h)
8. **P2-2**: 環境配置優化 (1-2h)
9. **P3-1**: CI/CD 配置 (2-3h)

**里程碑**: 完整的開發工作流

### 可選
- **P2-3**: HTML 結構優化 (3-4h) - 非關鍵

---

## 🎯 成功指標

| 項目 | 前 | 後 | 指標 |
|------|-----|-----|------|
| **代碼可維護性** | 160+ 全局變數 | <30 全局變數 | 降低 80% 全局污染 |
| **安全性** | 10+ innerHTML 漏洞 | 0 | 消除 XSS 風險 |
| **構建產物** | 5.5KB 源 | <20KB 壓縮 | 減少 >80% 最終大小 |
| **測試覆蓋** | 0% | >70% | 核心邏輯有保障 |
| **依賴管理** | 6 個 CDN | 1 個 npm | 統一版本控制 |
| **部署流程** | 手動 | 自動化 | 提高部署效率 |

---

## 📝 備註

- 執行順序不能變更，後期項目依賴前期完成
- 每個階段結束前應進行回歸測試
- 優化過程中保持 git 提交清晰，便於追蹤變更
- 定期檢查控制台警告，確保無新增問題

