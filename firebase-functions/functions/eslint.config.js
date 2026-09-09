/**
 * ESLint 設定（B-L13）
 *
 * 原本 package.json 的 lint script 是 `echo 'no lint configured'`，
 * firebase.json 的 predeploy 因此永遠通過 —— 打錯的變數名、忘記 require 的模組
 * 都會一路部署上線，等到員工打卡時才炸成 500。
 *
 * 規則刻意從寬：只抓「語法錯誤」與「未定義變數」，不做風格檢查
 * （這份程式碼庫沒有既定風格規範，一次導入 recommended 會產生數百個雜訊）。
 */

// Node.js 執行環境的全域變數。不引入 globals 套件，避免為了 lint 多一個相依。
const nodeGlobals = {
  require: "readonly",
  module: "writable",
  exports: "writable",
  process: "readonly",
  console: "readonly",
  Buffer: "readonly",
  __dirname: "readonly",
  __filename: "readonly",
  global: "readonly",
  fetch: "readonly",
  setTimeout: "readonly",
  clearTimeout: "readonly",
  setInterval: "readonly",
  clearInterval: "readonly",
  setImmediate: "readonly",
  URL: "readonly",
  URLSearchParams: "readonly",
  TextEncoder: "readonly",
  TextDecoder: "readonly",
  structuredClone: "readonly",
};

module.exports = [
  {
    ignores: ["node_modules/**"],
  },
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "commonjs",
      globals: nodeGlobals,
    },
    rules: {
      // 未定義變數（打錯名字、忘了 require）—— 本規則就是加 lint 的主要理由
      "no-undef": "error",
      // 重複宣告 / 重複的物件 key：多半是複製貼上時漏改，會靜默覆蓋
      "no-redeclare": "error",
      "no-dupe-keys": "error",
      "no-dupe-args": "error",
      "no-unreachable": "error",
      // 意外的 `if (a = b)`
      "no-cond-assign": "error",
      // 風格類一律關閉
      "no-unused-vars": "off",
      "no-empty": "off",
    },
  },
];
