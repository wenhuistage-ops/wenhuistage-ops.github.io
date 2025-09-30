# 零點考勤系統

## 簡介
這是一個基於 **LINE Login** 和 **Google Apps Script** 開發的簡易打卡系統。使用者可以透過 LINE 帳號登入，並使用手機 GPS 進行「上班」和「下班」打卡。打卡紀錄會即時儲存在 Google 試算表中，方便管理與查詢。

---

## 主要功能
- **LINE 帳號登入**  
  透過 LINE Login 認證，確保使用者身份。
  未來預計加入google Login認證使用者可選擇要用哪個

- **GPS 定位打卡**  
  利用瀏覽器地理位置 API 取得經緯度，進行上班與下班打卡。

- **補打卡功能**  
  可手動選擇日期時間，補登過去的打卡紀錄。

- **異常紀錄檢視**  
  自動檢查並標示出異常的打卡紀錄，方便使用者修正。

- **多國語系支援**  
  根據瀏覽器語言自動切換介面語系（繁體中文、日文、英文等）。-尚未完善[待整理]

- **即時訊息提示**  
  打卡成功或失敗都會有即時訊息回饋。
  
- **管理員分頁**  
  加入簡單新增地點功能。
  審核員工補卡作業。
 「注意目前管理員分頁 暫時開放所有人使用 讓大家可以自行新增打卡地點測試」
 - **定位分頁**  
   定位分頁-查看使用者定位與可打卡範圍
---

## 技術架構

### 前端 (Frontend)
- **HTML**：頁面結構
- **CSS**：使用 Flexbox 進行排版，確保 RWD 效果
- **JavaScript**：
  - 使用者介面互動
  - 呼叫後端 API 進行資料交換
  - 使用 `localStorage` 儲存登入狀態
  - 利用 `navigator.geolocation` 取得 GPS 資訊
  - 實現 i18n 多國語系翻譯功能

### 後端 (Backend)
- **Google Apps Script**：
  - 作為後端伺服器處理 API 請求
  - 實現 LINE Login OAuth 2.0 流程
  - 將打卡資料寫入 Google 試算表
  - 處理資料庫查詢與異常檢查邏輯

---

## 如何設定與部署

### 1. Google Apps Script 設定
1. 複製後端 Google Apps Script 程式碼
2. 在 Google 雲端硬碟中建立一個新的 Google 試算表，並在「擴充功能」中開啟 Apps Script
3. 將程式碼貼上，並在「專案屬性」中設定你的 **LINE Channel ID** 和 **Channel Secret**
4. 將專案發佈為一個網頁應用程式 (Web App)

### 2. LINE Developers 設定
1. 登入 **LINE Developers** 後台，建立一個 LINE Login 頻道
2. 在「基本設定」中，記下 **Channel ID** 和 **Channel Secret**
3. 在「網頁應用程式」的 **回呼網址 (Callback URL)** 中，設定你的專案部署網址（例如：`https://你的github.io網址`）

### 3. 前端部署
1. 複製前端程式碼 (`index.html`, `style.css`, `script.js`, `config.js` 等)
2. 在 `config.js` 中，將 `apiUrl` 和 `redirectUrl` 設定為你的 Google Apps Script 網頁應用程式 URL
3. 將所有前端檔案部署到靜態網站託管服務（例如 GitHub Pages 或 Vercel）

---

## 專案檔案結構

```text
LINE-Attendance-System/
├── index.html        # 網頁主頁
├── style.css         # 樣式表
├── script.js         # 前端主要邏輯
├── config.js         # API 和其他設定
├── i18n/             # 語系檔目錄
│   ├── en-US.json    # 英文語系
│   ├── ja-JP.json    # 日文語系
│   └── zh-TW.json    # 繁體中文語系
└── README.md         # 專案說明文件
