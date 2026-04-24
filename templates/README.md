# templates/ — HTML 模板片段

## 目的

本目錄存放可重用的 HTML 模板片段，目前作為**未來擴展的素材庫**。

## 目前狀態

- `ui-components.html`：5 個 UI 元件 `<template>`（Tab Button、Info Item、Toggle Setting、Card Wrapper、Form Input Group）
  - **未被任何 JS 使用**
  - 原放置於 `index.html` 內嵌 `<div id="templates">`，於 2026-04-24 抽出
  - 配套的 `js/template-loader.js`（TemplateLoader 模組）同日刪除，因完全未被呼叫

## 為什麼保留

1. **歷史素材**：原 P2-3 HTML 優化計畫的設計成果，保留可供參考
2. **未來可沿用**：若重啟「外部模板載入」機制（build-time include、runtime fetch、或 Vite HTML plugin），這些片段即可重新接入

## 目前實際使用的元件生成方式

`js/ui-component-generator.js` 的 `UIComponentGenerator` 採用**純 JS `document.createElement`** 方式動態生成，**不依賴** `<template>` 元素。

目前實際被呼叫的產生器：
- `UIComponentGenerator.createInfoItem(config)` — admin.js 中使用
- `UIComponentGenerator.createToggleSetting(config)` — admin.js 中使用
- `UIComponentGenerator.createFormInput(config)` — 未使用

## 若要重新啟用這些 `<template>`

需要同時提供：
1. **載入機制**（三選一）：
   - Build-time：Vite plugin 將 `ui-components.html` 內容 inline 進 `dist/index.html`
   - Runtime fetch：頁面啟動時 `fetch('./templates/ui-components.html')` 後 `innerHTML` 到隱藏容器，再讓 app init 等待
   - Import as string：`import html from './templates/ui-components.html?raw'`（需 Vite 設定）

2. **讀取 API**：恢復 `js/template-loader.js`（可從 git 歷史找回 commit 前版本）

3. **改造消費者**：目前 UIComponentGenerator 用 createElement，可改為 `TemplateLoader.cloneAndFill(id, data)`
