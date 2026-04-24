# 文件變更紀錄

> 本文件僅記錄 `docs/` 結構調整與主要文件搬移。
> 程式碼變更請參考 git log。

---

## 2026-04-24

### 階段一：清理與奠基

#### 新增
- `docs/專案架構與優化路徑.md` — 全專案架構分析與四階段優化路徑
- `docs/ChangeLog.md` — 本文件
- `docs/guides/`、`docs/plans/` 目錄

#### 搬移（保留 git 歷史）

**根目錄 → docs/**

| 原位置 | 新位置 |
|-------|-------|
| `ASYNC_NOTIFICATION_SYSTEM.md` | `docs/architecture/異步通知系統.md` |
| `FIRESTORE_COMPLETE_MIGRATION.md` | `docs/architecture/Firestore遷移計劃.md` |
| `PERFORMANCE_MIGRATION_PLAN.md` | `docs/issues/效能遷移計劃.md` |

**docs/ 根 → 分類子目錄**

| 原位置 | 新位置 |
|-------|-------|
| `docs/月曆格子顏色定義.md` | `docs/rules/月曆格子顏色定義.md` |
| `docs/異常記錄定義.md` | `docs/rules/異常記錄定義.md` |
| `docs/薪資與加班計算規則整理.md` | `docs/rules/薪資與加班計算規則整理.md` |
| `docs/LINE通知設置指南.md` | `docs/guides/LINE通知設置指南.md` |
| `docs/文檔組織守則.md` | `docs/guides/文檔組織守則.md` |
| `docs/security/前端實施指南.md` | `docs/guides/前端實施指南.md` |
| `docs/優化計劃書.md` | `docs/plans/優化計劃書.md` |
| `docs/Excel導出功能規劃.md` | `docs/plans/Excel導出功能規劃.md` |
| `docs/P2-3_HTML_Optimization_Summary.md` | `docs/plans/P2-3_HTML_Optimization_Summary.md` |

#### 刪除
- `src/main.js` 與 `src/` 目錄（確認 `index.html` 未引用，為聚合死碼）

#### 配置
- `.gitignore`：新增 `dist/`、`.vite/`、`coverage/`（`dist/` 既有追蹤檔案維持追蹤以支援 GitHub Pages 部署）

#### 引用同步
- `docs/security/測試指南-POST改進.md` → 修正「前端實施指南」連結至 `../guides/`
- `docs/plans/Excel導出功能規劃.md` → 修正「月曆格子顏色定義.md」路徑為 `/docs/rules/`
- `docs/專案架構與優化路徑.md` → 同步相關文件索引與階段一檢查清單

---

## 目錄結構（當前）

```
docs/
├── README.md
├── ChangeLog.md
├── 專案架構與優化路徑.md
├── architecture/    系統架構與遷移藍圖
├── guides/          開發與使用指南
├── issues/          問題分析與效能
├── plans/           功能規劃與優化計劃
├── rules/           業務規則定義
└── security/        安全審查
```
