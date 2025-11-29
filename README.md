[![License: GPL v2](https://img.shields.io/badge/License-GPL%20v2-blue.svg)](https://www.gnu.org/licenses/old-licenses/gpl-2.0.html)

# 0riginAttendance-System

**Copyright (C) 2025 0J (Lin Jie / 0rigin1856)**

0riginAttendance-System 是一個開源的考勤管理系統，幫助小型團隊輕鬆管理出勤與工時，提供直覺化介面與模組化功能。

---

## 授權聲明

本專案採用 **GNU General Public License v2 (GPLv2)** 授權。  
你可以自由地複製、修改與分發本程式碼，但必須遵守 GPLv2 的條款。  

請在重新分發或修改本專案時 **標註原作者**：  
`0J (Lin Jie / 0rigin1856)`  

完整條款請參考 [GPLv2 授權條款](https://www.gnu.org/licenses/old-licenses/gpl-2.0.html) 或專案 LICENSE.md。

---

## 貢獻指引

歡迎任何人為本專案提出改進與修正。  

貢獻方式：
1. Fork 本專案
2. 建立功能分支 (`git checkout -b feature/你的功能`)
3. 提交修改 (`git commit -m "新增功能描述"`)
4. Push 到分支 (`git push origin feature/你的功能`)
5. 開 Pull Request

請在修改中保留原作者標註與授權聲明。

---

## 簡介

這是一個基於 **LINE Login** 和 **Google Apps Script** 的簡易打卡系統。使用者可以透過 LINE 帳號登入，並使用手機 GPS 進行「上班」和「下班」打卡。打卡紀錄即時儲存在 Google 試算表中，方便管理與查詢。

---

## 主要功能

- **LINE 帳號登入**：透過 LINE Login 認證，確保使用者身份。未來可加入 Google Login 認證。
- **GPS 定位打卡**：利用瀏覽器地理位置 API 取得經緯度，進行上班與下班打卡。
- **補打卡功能**：可手動選擇日期時間，補登過去的打卡紀錄。
- **異常紀錄檢視**：自動檢查並標示異常打卡紀錄。
- **多國語系支援**：依瀏覽器語言自動切換介面語系（繁體中文、日文、英文等）。
- **即時訊息提示**：打卡成功或失敗都會有即時訊息回饋。
- **管理員分頁**：
  - 新增打卡地點
  - 審核員工補卡作業
  - 注意：目前管理員分頁暫時開放所有人使用，方便測試
- **定位分頁**：查看使用者定位與可打卡範圍

---

## 技術架構

### 前端 (Frontend)
- **HTML**：頁面結構
- **CSS**：使用 Flexbox 排版，確保 RWD 效果
- **JavaScript**：
  - 使用者介面互動
  - 呼叫後端 API 進行資料交換
  - 使用 `localStorage` 儲存登入狀態
  - 利用 `navigator.geolocation` 取得 GPS 資訊
  - 實現 i18n 多國語系翻譯功能

### 後端 (Backend)
- **Google Apps Script**：
  - 處理 API 請求
  - 實現 LINE Login OAuth 2.0 流程
  - 將打卡資料寫入 Google 試算表
  - 處理資料查詢與異常檢查

---

## 部署指南

### 1. Google Apps Script 設定
1. 複製後端 Google Apps Script 程式碼
2. 建立 Google 試算表，開啟 Apps Script
3. 貼上程式碼，設定專案屬性：**LINE Channel ID** 與 **Channel Secret**
4. 發佈為網頁應用程式 (Web App)

### 2. LINE Developers 設定
1. 登入 LINE Developers，建立 LINE Login 頻道
2. 記下 **Channel ID** 與 **Channel Secret**
3. 設定 Callback URL 為你的 Web App 部署網址

### 3. 前端部署
1. 複製前端程式碼 (`index.html`, `style.css`, `script.js`, `config.js` 等)
2. 在 `config.js` 設定 `apiUrl` 和 `redirectUrl` 為 Google Apps Script 網頁應用程式 URL
3. 部署至靜態網站託管服務（如 GitHub Pages 或 Vercel）

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
├── README.md         # 專案說明文件
└── LICENSE.md        # GPLv2 授權文件
