[![License: GPL v2](https://img.shields.io/badge/License-GPL%20v2-blue.svg)](https://www.gnu.org/licenses/old-licenses/gpl-2.0.html)

# 0riginAttendance-System

**Copyright (C) 2025 0J (Lin Jie / 0rigin1856)**

0riginAttendance-System 是一個開源的考勤管理系統，幫助小型團隊輕鬆管理出勤與工時，提供直覺化介面與模組化功能。

正式站台：<https://wenhuistage-ops.github.io/>

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

這是一個以 **LINE Login** 認證、**GPS 定位打卡**為核心的考勤系統。員工用 LINE 帳號登入，
在手機上完成上下班打卡；打卡紀錄即時寫入 **Cloud Firestore**，管理員可線上審核補卡與請假、
檢視勞基法分段工時，並匯出薪資 Excel。

前端是**不需建置的純靜態網站**，直接由 GitHub Pages 提供；所有資料存取都經過
**Firebase Cloud Functions**，Firestore 本身對用戶端完全鎖住。

> **歷史沿革**：2026 年之前的後端是 Google Apps Script + Google 試算表，現已完全停用。
> 舊程式碼僅供查閱，保留在 [`docs/legacy/`](docs/legacy/)。前端已鎖死走 Cloud Functions，
> 不提供切回舊後端的開關。

---

## 主要功能

- **LINE 帳號登入**：LINE Login OAuth 2.0，state 由後端產生、10 分鐘有效、交易式一次性消費。
- **GPS 定位打卡**：`navigator.geolocation` 取得座標，比對打卡地點與允許半徑。支援高精確度模式、自動重試與精確度品質評估。
- **補打卡功能**：可選日期時間補登過去的打卡紀錄，需管理員審核。
- **請假 / 休假申請**：線上提交，支援病假證明上傳；未核准的補卡不計入工時。
- **異常紀錄檢視**：自動標示漏打卡、缺上/下班等異常。
- **勞基法工時計算**：平日 normal / ot1 / ot2、休息日三段、國定假日、例假日分段時數與等價時數。
- **薪資與勞健保**：月薪換時薪（÷240）、勞保投保級距推算、勞健保與勞退自付額試算、詳細薪資 Excel 匯出。
- **LINE 通知系統**：員工提交申請時通知管理員；每日排程檢查漏打卡並依員工語言推播。
- **管理員後台**：員工設定（權限、薪資、勞保）、打卡地點與休息時段管理、表單審核、員工報表與圖表。
- **多國語系**：繁體中文、英文、日文、越南文、印尼文共 5 語系。
- **PWA**：可加到主畫面，Service Worker 快取靜態資源（API 不經 SW）。
- **深色模式**：跟隨系統或手動切換。

---

## 技術架構

```
┌──────────────────────────────────────────────────────────┐
│  前端（純靜態，無 build step）                            │
│  index.html + js/*.js + compiled.css                     │
│  GitHub Pages 託管 → wenhuistage-ops.github.io           │
└───────────────────────────┬──────────────────────────────┘
                            │ httpsCallable（Firebase SDK，走 CDN ES module）
                            ▼
┌──────────────────────────────────────────────────────────┐
│  Firebase Cloud Functions（asia-southeast1）              │
│  30 餘個 onCall / 排程 function，授權集中於此             │
│  專案：wenhui-check-in-system                             │
└───────────────────────────┬──────────────────────────────┘
                            │ Admin SDK
                            ▼
┌──────────────────────────────────────────────────────────┐
│  Cloud Firestore                                          │
│  employees / attendance / attendanceMonthly / sessions /  │
│  locations / settings / oauthStates …                     │
│  firestore.rules 全鎖：用戶端不可直接讀寫                  │
└──────────────────────────────────────────────────────────┘
         ▲                                    ▲
         │ OAuth 2.0                          │ Messaging API
   ┌─────┴──────┐                      ┌──────┴──────┐
   │ LINE Login │                      │ LINE 推播    │
   └────────────┘                      └─────────────┘
```

### 前端
| 技術 | 用途 |
|------|------|
| Vanilla JavaScript（無框架、無打包） | UI 邏輯與 API 呼叫，以 `<script defer>` 逐檔載入 |
| Tailwind CSS 4 | 樣式；`style.css` → `compiled.css`（唯一的建置步驟） |
| Leaflet + OpenStreetMap | 地圖與打卡範圍顯示 |
| DOMPurify（自託管） | innerHTML 消毒，搭配 `escapeHtml()` 兩層防護 |
| SheetJS (xlsx) | 前端產生薪資 / 月曆 Excel |
| Geolocation API | GPS 定位 |
| localStorage | session token 與顯示用快取 |
| Service Worker + manifest.json | PWA 離線快取與安裝 |

### 後端
| 技術 | 用途 |
|------|------|
| Firebase Cloud Functions（Node.js） | 全部業務邏輯與授權檢查 |
| Cloud Firestore | 資料持久化 |
| Firebase `defineSecret` | LINE Channel Secret 等機密，不進 git |
| Cloud Scheduler | 每日漏打卡提醒、虛擬打卡、過期 session 清理 |
| LINE Login / Messaging API | 認證與推播 |

**授權模型**：`firestore.rules` 全鎖，所有讀寫都經 Cloud Functions；管理員端點在後端查
`employees.dept === "管理員"`，不信任前端傳的角色。

---

## 專案結構

```text
wenhuistage-ops.github.io/
├── index.html              # 單頁應用進入點（所有畫面都在這裡）
├── style.css               # Tailwind 原始碼
├── compiled.css            # Tailwind 產出（已入版控，index.html 直接引用）
├── manifest.json / sw.js   # PWA
├── icons/                  # PWA 圖示
├── js/
│   ├── app.js              # 啟動流程、登入狀態、路由
│   ├── config.js           # Firebase 專案設定與回跳網址
│   ├── core.js             # 通知、確認框、escapeHtml 等共用工具
│   ├── firestore-client.js # Cloud Functions 呼叫封裝
│   ├── ui.js               # 月曆與主畫面 DOM
│   ├── admin.js            # 管理員後台
│   ├── labor-hours.js      # 勞基法分段工時、勞健保、薪資換算
│   ├── holidays-client.js  # 國定假日 / 日別判定
│   ├── location.js         # 地圖與定位
│   ├── weekly-chart.js     # 週工時圖
│   ├── punch/              # 打卡流程、補卡、定位、異常紀錄
│   ├── modules/            # i18n、月曆、狀態、UI 管理
│   └── vendor/             # 自託管第三方（DOMPurify 等）
├── i18n/                   # zh-TW / en-US / ja / vi / id 五語系
├── firebase-functions/     # 後端（獨立部署單位）
│   ├── functions/src/      # 各 Cloud Function（一檔一端點）
│   ├── firestore.rules     # 全鎖規則
│   ├── firebase.json
│   └── scripts/            # 維運腳本（借用 functions/node_modules）
├── tests/                  # Jest 測試
├── scripts/deploy.sh       # 一鍵：前端 push + 後端 deploy
├── docs/                   # 文件中心（架構、規則、計畫、issues、legacy）
├── package.json
└── LICENSE
```

---

## 開發與部署

### 本機開發

前端**沒有 build step**，也不需要 dev server 打包：用任何靜態伺服器開啟根目錄即可。

```bash
git clone https://github.com/wenhuistage-ops/wenhuistage-ops.github.io.git
cd wenhuistage-ops.github.io
npm install                  # 只為了 Tailwind CLI 與 Jest

npx serve .                  # 或 python3 -m http.server 5501
# 開 http://127.0.0.1:5501/index.html
```

> `js/config.js` 的 `getRedirectUrl()` 會偵測 localhost 並回跳到本機首頁，
> 但該網址仍須先在 LINE Developers 主控台登記為 Callback URL 才能完成登入。

改動 `style.css` 之後要重新產生 CSS：

```bash
npm run build:css            # tailwindcss -i style.css -o compiled.css --minify
```

執行測試：

```bash
npm test                     # jest
npm run test:coverage
```

### 部署

**前端**：把 `main` 推上 GitHub，GitHub Pages 直接提供**根目錄**的檔案，1～2 分鐘生效。
沒有打包、沒有 CI、沒有 `dist/`——你 push 什麼，線上就是什麼（**記得先 `npm run build:css`**）。

```bash
git push origin main
```

**後端**：Cloud Functions 需要另外部署，push 不會自動更新後端。

```bash
cd firebase-functions
firebase deploy --only functions --project wenhui-check-in-system
```

**兩者一起**：

```bash
scripts/deploy.sh            # 前端必推；firebase-functions/ 有改動才 deploy 後端
```

詳細步驟與上線後驗證項目見 [docs/部署檢查清單.md](docs/部署檢查清單.md)。

---

## 相關文件

- [docs/README.md](docs/README.md) — 文件中心導覽
- [docs/architecture/專案架構.md](docs/architecture/專案架構.md) — 系統架構
- [docs/architecture/資料架構.md](docs/architecture/資料架構.md) — Firestore 資料模型
- [docs/rules/薪資與加班計算規則整理.md](docs/rules/薪資與加班計算規則整理.md) — 勞基法工時與薪資規則
- [docs/部署檢查清單.md](docs/部署檢查清單.md) — 部署與驗證清單
- [docs/issues/2026-09-08-全面檢查報告-安全與UX.md](docs/issues/2026-09-08-全面檢查報告-安全與UX.md) — 最新全面檢查報告
