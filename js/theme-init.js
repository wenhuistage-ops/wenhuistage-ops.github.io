/**
 * 主題初始化 + 前端事件綁定（原本內嵌於 index.html 的 inline script / on* 屬性）
 *
 * 為什麼獨立成檔：搭配 CSP，script-src 不放 'unsafe-inline'，才能真正擋住
 * 注入型 inline script / on* 事件處理器（XSS 縱深防禦，M8）。本檔為同源外部
 * 腳本，CSP 'self' 即涵蓋。
 *
 * 載入方式：於 <head> 以非 defer 方式載入 —— 立即套用深色 class 避免 FOUC；
 * DOMContentLoaded 後再綁定切換按鈕與表單（此時 admin.js 等 defer 腳本已執行，
 * window.handleSalaryProfileSubmit 已存在）。
 */

// 1) 立即套用主題（避免深色模式閃爍 FOUC）
(function applyThemeEarly() {
  try {
    if (localStorage.getItem('theme') === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  } catch (_) { /* localStorage 不可用時忽略 */ }
})();

// 2) DOM 就緒後綁定互動
document.addEventListener('DOMContentLoaded', () => {
  const htmlElement = document.documentElement;

  // --- 主題切換按鈕 ---
  const toggleButton = document.getElementById('theme-toggle');
  const themeIcon = document.getElementById('theme-icon');
  const updateThemeIcon = () => {
    if (themeIcon) themeIcon.textContent = htmlElement.classList.contains('dark') ? '☀️' : '🌙';
  };
  updateThemeIcon();
  if (toggleButton) {
    toggleButton.addEventListener('click', () => {
      htmlElement.classList.toggle('dark');
      try {
        localStorage.setItem('theme', htmlElement.classList.contains('dark') ? 'dark' : 'light');
      } catch (_) { /* ignore */ }
      updateThemeIcon();
    });
  }

  // --- 薪資制度表單（原 onsubmit="return handleSalaryProfileSubmit(event)"）---
  // handleSalaryProfileSubmit 自身會 e.preventDefault()，直接綁定即可。
  const salaryForm = document.getElementById('form-salary-profile');
  if (salaryForm && typeof window.handleSalaryProfileSubmit === 'function') {
    salaryForm.addEventListener('submit', window.handleSalaryProfileSubmit);
  }

  // --- 打卡政策表單（原 onsubmit="handlePunchPolicyUpdate(event)"）---
  // ⚠️ handlePunchPolicyUpdate 目前全專案未定義（既有半成品）；先擋原生提交避免頁面
  // 帶 query 重載。待實作儲存邏輯後於此改綁真正的 handler。
  const policyForm = document.getElementById('form-punch-policy');
  if (policyForm) {
    policyForm.addEventListener('submit', (e) => {
      e.preventDefault();
      if (typeof window.handlePunchPolicyUpdate === 'function') {
        window.handlePunchPolicyUpdate(e);
      }
    });
  }
});
