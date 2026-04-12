# 📚 0riginAttendance-System 文檔中心

歡迎來到 0riginAttendance-System 的完整文檔庫。本頁面提供導航和快速查詢。

---

## 🚀 快速開始

**👤 我是...**
- [**項目經理/管理人員**](#項目經理--管理人員) → 了解項目狀態與問題
- [**後端開發人員**](#後端開發人員) → 部署、API、編碼規範
- [**前端開發人員**](#前端開發人員) → 環境搭建、模塊結構
- [**安全審查者**](#安全審查者) → 安全隱患與改善方案
- [**新員工/實習生**](#新員工實習生) → 從這裡開始

---

## 📖 文檔分類導覽

### **💼 系統架構文檔** (`docs/architecture/`)

| 文檔 | 內容描述 | 適合讀者 |
|------|--------|--------|
| [專案架構.md](architecture/專案架構.md) | 整體系統設計、功能模塊、技術棧 | 所有人 |
| [資料架構.md](architecture/資料架構.md) | Google Sheets 資料模型、字段定義、資料流程 | 後端、全棧開發 |
| SYSTEM_FLOW.md（待建） | 業務流程圖：認證、打卡、補卡流程 | 架構師、PM |

### **📖 開發與部署指南** (`docs/guides/`)

| 文檔 | 內容描述 | 適合讀者 |
|------|--------|--------|
| SETUP.md（待建） | 本地開發環境搭建、依賴安裝 | 開發人員 |
| DEPLOYMENT.md（待建） | 前後端部署步驟、GAS 部署、GitHub Pages | DevOps、開發主管 |
| API_DOCUMENTATION.md（待建） | 完整的 API 參考、請求/響應示例 | 前端、移動端開發 |
| CODING_STANDARDS.md（待建） | JavaScript/GAS 編碼規範、命名慣例 | 開發團隊 |
| CONFIGURATION.md（待建） | config.js、Constants.gs 配置說明 | 開發人員 |

### **🚨 問題與改善方案** (`docs/issues/`)

| 文檔 | 內容描述 | 適合讀者 |
|------|--------|--------|
| [問題分析.md](issues/問題分析.md) | 完整問題列表、優先級、修復方案 | PM、開發主管 |
| SECURITY_ISSUES.md（待建） | 安全隱患詳細說明、PoC、修復建議 | 安全審查、後端 |
| PERFORMANCE_OPTIMIZATION.md（待建） | 性能瓶頸分析、優化方案 | 性能測試、後端 |
| REFACTORING_ROADMAP.md（待建） | 代碼重構計畫，優先級排序 | 開發主管、架構師 |

---

## 👥 按角色推薦閱讀

### **項目經理 & 管理人員**

**必讀**（15分鐘）
1. [專案架構.md](architecture/專案架構.md) - 📌 快速了解系統架構
2. [問題分析.md](issues/問題分析.md) - 🚨 當前項目狀況

**深度了解**（30分鐘）
3. [資料架構.md](architecture/資料架構.md) - 了解資料如何儲存和流轉

**參考資料**
- REFACTORING_ROADMAP.md（完成時）- 改進計畫與時間軸

---

### **後端開發人員**

**必讀**（1小時）
1. [專案架構.md](architecture/專案架構.md) - 系統概述
2. [資料架構.md](architecture/資料架構.md) - 資料模型詳解
3. [問題分析.md](issues/問題分析.md) - 已知 Bug 與安全隱患

**開發指南**
4. SETUP.md - 環境搭建
5. DEPLOYMENT.md - GAS 部署步驟
6. CODING_STANDARDS.md - 編碼規範
7. API_DOCUMENTATION.md - API 端點詳列

**深度研究**
8. SECURITY_ISSUES.md - 安全隱患深度分析
9. PERFORMANCE_OPTIMIZATION.md - 性能優化方案

---

### **前端開發人員**

**必讀**（45分鐘）
1. [專案架構.md](architecture/專案架構.md) - 系統概述
2. [數據架構 - API 端點清單部分](architecture/專案架構.md#-api-端點清單) - 了解 API

**開發指南**
3. SETUP.md - 環境搭建
4. API_DOCUMENTATION.md - API 詳細文檔
5. CODING_STANDARDS.md - 前端編碼規範
6. CONFIGURATION.md - config.js 配置

**問題參考**
7. [問題分析.md](../issues/問題分析.md) - 確認前端已知問題

---

### **新員工/實習生**

**第一天**（1小時）
1. README.md（項目根目錄）- 項目簡介
2. [PROJECT_ARCHITECTURE.md](architecture/PROJECT_ARCHITECTURE.md) - 整體架構

**第一週**
3. SETUP.md - 環境搭建
4. CODING_STANDARDS.md - 編碼規範
5. 選擇前後端路線，深入閱讀相關文檔

**第二週**
6. [DATA_ARCHITECTURE.md](architecture/DATA_ARCHITECTURE.md) - 資料模型
7. API_DOCUMENTATION.md - API 文檔
8. 在導師指導下進行第一個任務

---

### **安全審查者**

**必讀**（2小時）
1. [ISSUES_ANALYSIS.md](issues/ISSUES_ANALYSIS.md) - 完整問題清單
2. SECURITY_ISSUES.md（完成時）- 安全隱患詳解
3. [PROJECT_ARCHITECTURE.md - 安全與權限機制部分](architecture/PROJECT_ARCHITECTURE.md#-安全與權限機制)

**技術審查**
4. 逐一驗證 `GS/*.gs` 中的輸入驗證
5. 檢查前端 localStorage 使用情況

---

## 📊 文檔狀態

### 已完成 ✅
- PROJECT_ARCHITECTURE.md - 系統架構完整分析
- DATA_ARCHITECTURE.md - 資料模型詳細說明
- ISSUES_ANALYSIS.md - 問題與改善方案

### 進行中 ⏳
- SECURITY_ISSUES.md - 安全隱患深度分析
- SETUP.md - 開發環境搭建指南

### 待建立 📋
- DEPLOYMENT.md
- API_DOCUMENTATION.md
- CODING_STANDARDS.md
- CONFIGURATION.md
- SYSTEM_FLOW.md
- PERFORMANCE_OPTIMIZATION.md
- REFACTORING_ROADMAP.md

---

## 🎯 優先級文檔建立計畫

| 優先級 | 文檔 | 預估完成時間 |
|--------|------|----------|
| 🔴 高 | SECURITY_ISSUES.md | 本週 |
| 🔴 高 | SETUP.md | 本週 |
| 🔴 高 | DEPLOYMENT.md | 下週 |
| 🟠 中 | API_DOCUMENTATION.md | 2週內 |
| 🟠 中 | CODING_STANDARDS.md | 2週內 |
| 🟡 低 | SYSTEM_FLOW.md | 1月內 |
| 🟡 低 | PERFORMANCE_OPTIMIZATION.md | 1月內 |

---

## 🔍 快速查詢

### **我想了解...**

- ✅ **系統如何設計** → [PROJECT_ARCHITECTURE.md](architecture/PROJECT_ARCHITECTURE.md)
- ✅ **資料如何存儲** → [DATA_ARCHITECTURE.md](architecture/DATA_ARCHITECTURE.md)
- ✅ **當前有什麼問題** → [ISSUES_ANALYSIS.md](issues/ISSUES_ANALYSIS.md)
- ✅ **如何搭建開發環境** → SETUP.md（待建）
- ✅ **如何部署應用** → DEPLOYMENT.md（待建）
- ✅ **API 端點有哪些** → API_DOCUMENTATION.md（待建）
- ✅ **編碼規範是什麼** → CODING_STANDARDS.md（待建）
- ✅ **安全隱患詳情** → SECURITY_ISSUES.md（待建）
- ✅ **性能如何優化** → PERFORMANCE_OPTIMIZATION.md（待建）

---

## 📝 相關檔案位置

### **項目根目錄**
```
/
├── README.md              # 項目簡介（GPLv2、功能說明）
├── package.json           # 前端依賴
├── tailwind.config.js     # Tailwind CSS 配置
├── docs/                  # 📚 所有文檔在這裡
│   └── ...
├── js/                    # 前端 JavaScript
├── GS/                    # 後端 Google Apps Script
├── i18n/                  # 多語言翻譯
└── ...
```

### **快速命令**
```bash
# 查看文檔目錄
ls -la docs/

# 搜索文檔中的關鍵字
grep -r "API" docs/

# 打開文檔（macOS）
open docs/README.md
open docs/architecture/PROJECT_ARCHITECTURE.md
```

---

## 🤝 貢獻文檔

如果你:
- 發現了新的 Bug → 更新 [ISSUES_ANALYSIS.md](issues/ISSUES_ANALYSIS.md)
- 完成了功能 → 更新相關 API 文檔
- 改進了現有代碼 → 更新 CODING_STANDARDS.md
- 優化了性能 → 貢獻 PERFORMANCE_OPTIMIZATION.md

**文檔更新規範** → 查看 [DOCUMENTATION_STRUCTURE.md](DOCUMENTATION_STRUCTURE.md)

---

## 📞 聯繫與反饋

- 🐛 發現文檔錯誤？提出 Issue
- 💡 有改進建議？提交 PR
- 📧 其他問題？聯繫項目維護人

---

**最後更新**：2026年4月 | **文檔中心版本**：1.0  
**下一次計畫更新**：2026年7月

