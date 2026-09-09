# 📚 0riginAttendance-System 文件中心

本頁是 `docs/` 的導覽索引。**此處只列實際存在的檔案**，不列「待建」的計畫檔——
需要新文件時直接建立並回來補上連結即可。

> 系統現況：純靜態前端（GitHub Pages）+ Firebase Cloud Functions（asia-southeast1）+ Firestore。
> 2026 年前的 Google Apps Script 後端已停用，程式碼僅存於 [`legacy/`](legacy/) 供查閱。

---

## 📖 目錄一覽

### 🏗 系統架構（`architecture/`）

| 文件 | 內容 |
|------|------|
| [專案架構.md](architecture/專案架構.md) | 整體系統設計、目錄結構、技術棧、Cloud Functions 清單 |
| [資料架構.md](architecture/資料架構.md) | Firestore 資料模型與欄位定義 |
| [異步通知系統.md](architecture/異步通知系統.md) | LINE 推播與排程通知的流程 |

### 📐 業務規則（`rules/`）

| 文件 | 內容 |
|------|------|
| [薪資與加班計算規則整理.md](rules/薪資與加班計算規則整理.md) | 勞基法分段工時、倍率、月薪換時薪、勞健保費率 |
| [異常記錄定義.md](rules/異常記錄定義.md) | 什麼算「異常打卡」 |
| [異常清單顯示規則.md](rules/異常清單顯示規則.md) | 異常清單的篩選與呈現邏輯 |
| [月曆格子顏色定義.md](rules/月曆格子顏色定義.md) | 月曆各狀態的配色規範 |

### 🛠 指南（`guides/`）

| 文件 | 內容 |
|------|------|
| [LINE通知設置指南.md](guides/LINE通知設置指南.md) | LINE Login / Messaging API 的設定步驟 |
| [文檔組織守則.md](guides/文檔組織守則.md) | 文件放哪、怎麼命名、何時更新 |

### 🚀 部署

| 文件 | 內容 |
|------|------|
| [部署檢查清單.md](部署檢查清單.md) | 前端 push、後端 deploy、上線後驗證、rollback |

### 🔐 安全（`security/`）

| 文件 | 內容 |
|------|------|
| [後端檢查清單.md](security/後端檢查清單.md) | Cloud Functions 的授權與輸入驗證檢查項 |

### 🚨 問題與檢查報告（`issues/`）

| 文件 | 內容 |
|------|------|
| [2026-09-08-全面檢查報告-安全與UX.md](issues/2026-09-08-全面檢查報告-安全與UX.md) | **最新**：前後端安全、UX、技術債全面盤點與處理進度 |
| [2026-07-02-全面檢查報告-UX與設計原則.md](issues/2026-07-02-全面檢查報告-UX與設計原則.md) | 前一輪檢查報告（追蹤狀態見 09-08 報告） |
| [問題分析.md](issues/問題分析.md) | 長期技術債待辦清單 |

### 📋 實作計畫（`plans/`）

| 文件 | 內容 |
|------|------|
| [勞基法工時計算實作計畫.md](plans/勞基法工時計算實作計畫.md) | 分段工時功能的實作規劃 |
| [薪資結算月報與匯出實作計畫.md](plans/薪資結算月報與匯出實作計畫.md) | 薪資 Excel 匯出規劃（含未完成的 Phase M6） |
| [員工管理介面重設計計畫.md](plans/員工管理介面重設計計畫.md) | 管理員後台改版規劃 |
| [Firestore-讀取最佳化-月度聚合計畫.md](plans/Firestore-讀取最佳化-月度聚合計畫.md) | `attendanceMonthly` 聚合的設計 |

### 🗄 歷史封存（`legacy/`）

| 文件 | 內容 |
|------|------|
| [legacy/README.md](legacy/README.md) | 已停用的 GAS 後端說明（2026 年停用，僅供查閱） |

### 📜 變更紀錄

| 文件 | 內容 |
|------|------|
| [ChangeLog.md](ChangeLog.md) | 依時間排序的變更紀錄 |

---

## 👥 按角色推薦

**新加入的開發者**
1. 專案根目錄 [README.md](../README.md) — 系統簡介、架構圖、本機開發與部署
2. [架構/專案架構.md](architecture/專案架構.md) — 目錄結構與模組職責
3. [issues/2026-09-08-全面檢查報告-安全與UX.md](issues/2026-09-08-全面檢查報告-安全與UX.md) — 目前已知問題

**要動薪資 / 工時計算的人**
1. [rules/薪資與加班計算規則整理.md](rules/薪資與加班計算規則整理.md) — 規則來源
2. `js/labor-hours.js` — 實作
3. `tests/labor-hours.test.js` — 行為測試（改動計算邏輯前先跑 `npm test`）

**要部署的人**
1. [部署檢查清單.md](部署檢查清單.md)
2. `scripts/deploy.sh` — 一鍵前端 push + 後端 deploy

**做安全審查的人**
1. [issues/2026-09-08-全面檢查報告-安全與UX.md](issues/2026-09-08-全面檢查報告-安全與UX.md) 第 1、2 節
2. [security/後端檢查清單.md](security/後端檢查清單.md)
3. 逐一檢視 `firebase-functions/functions/src/*.js` 的授權與輸入驗證
   （授權集中在 `_helpers.js`；`firestore.rules` 全鎖，用戶端不可直接讀寫）
4. 檢查前端 `localStorage` 使用情況（session token 仍存於此）

---

## 🔍 快速查詢

| 我想知道… | 去哪看 |
|---|---|
| 系統怎麼設計的 | [architecture/專案架構.md](architecture/專案架構.md) |
| 資料存成什麼樣子 | [architecture/資料架構.md](architecture/資料架構.md) |
| 加班費怎麼算 | [rules/薪資與加班計算規則整理.md](rules/薪資與加班計算規則整理.md) |
| 怎麼部署 | [部署檢查清單.md](部署檢查清單.md) |
| 目前有什麼問題 | [issues/2026-09-08-全面檢查報告-安全與UX.md](issues/2026-09-08-全面檢查報告-安全與UX.md) |
| 有哪些 API 端點 | `firebase-functions/functions/src/`（一個檔案一個端點） |
| 前端設定在哪 | `js/config.js` |
| 舊的 GAS 程式碼 | [legacy/](legacy/) |

---

## 📝 專案結構速覽

```text
/
├── README.md               # 專案簡介、架構、部署方式
├── index.html              # 單頁應用進入點
├── style.css               # Tailwind 原始碼
├── compiled.css            # Tailwind 產出（入版控，直接被 index.html 引用）
├── manifest.json / sw.js   # PWA
├── package.json            # 前端相依與 npm scripts（build:css / test）
├── jest.config.js
├── js/                     # 前端 JavaScript（無打包，<script defer> 逐檔載入）
├── i18n/                   # 5 語系：zh-TW / en-US / ja / vi / id
├── icons/                  # PWA 圖示
├── firebase-functions/     # 後端 Cloud Functions（獨立部署）
├── tests/                  # Jest 測試
├── scripts/deploy.sh       # 一鍵部署
└── docs/                   # 本文件中心
```

> **沒有 build step。** 前端不經打包，GitHub Pages 直接提供根目錄檔案。
> 唯一的產生步驟是 `npm run build:css`（Tailwind CLI → `compiled.css`）。

### 常用命令

```bash
npm run build:css       # 改完 style.css 後重新產生 compiled.css
npm test                # 跑 Jest
scripts/deploy.sh       # 前端 push + 後端（有改才）deploy
```

---

## 🤝 維護文件

- 發現新問題 → 記到 [issues/問題分析.md](issues/問題分析.md) 或最新的檢查報告
- 改了架構 / 目錄 → 同步更新 [architecture/專案架構.md](architecture/專案架構.md) 與本頁
- 命名與擺放規則 → 見 [guides/文檔組織守則.md](guides/文檔組織守則.md)

---

**最後更新**：2026-09-09（清理已下線架構的殘留描述）
