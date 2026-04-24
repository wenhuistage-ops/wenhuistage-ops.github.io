/**
Copyright (C) 2025 0J (Lin Jie / 0rigin1856)

This file is part of 0riginAttendance-System.

0riginAttendance-System is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 2 of the License, or
(at your option) any later version.

0riginAttendance-System is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with 0riginAttendance-System. If not, see <https://www.gnu.org/licenses/>.
Please credit "0J (Lin Jie / 0rigin1856)" when redistributing or modifying this project.
 */
// config.js

const API_CONFIG = {
  // 正式環境的 API URL（GAS 後端）
  apiUrl: "https://script.google.com/macros/s/AKfycby28KblKy-ICEGstB7L-UK5rQ1awPokRiIIdqpJ49_7nVmS_oHYiA9qapWtOVo_UnEHbQ/exec",
  // 預設回呼網址（正式環境）
  redirectUrl: "https://wenhuistage-ops.github.io/",

  // ==========================================================================
  // 🔀 後端切換（分支 vs 主線策略，詳見 docs/plans/Firestore切換策略-分支vs主線.md）
  // ==========================================================================
  // 預設 false（走 GAS）。本分支可改為 true 強制走 Firestore。
  // 主線合併本分支時請保持 false，避免意外切換。
  useFirestore: false,

  // Firebase 專案配置（僅 useFirestore=true 才使用）
  // 由使用者於 Firebase Console → 專案設定 複製填入
  firebase: {
    apiKey: null,
    authDomain: null,
    projectId: null,
    region: "asia-southeast1"
  }
};

// --------------------------------------------------------------------------
// Runtime override：?backend=firestore|gas 或 localStorage.setItem('backend', ...)
// 方便開發時 A/B 測試，優先級高於 API_CONFIG.useFirestore 預設值
// --------------------------------------------------------------------------
(function applyBackendOverride() {
  try {
    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get("backend");
    if (fromUrl === "firestore") {
      API_CONFIG.useFirestore = true;
    } else if (fromUrl === "gas") {
      API_CONFIG.useFirestore = false;
    } else {
      const stored = localStorage.getItem("backend");
      if (stored === "firestore") {
        API_CONFIG.useFirestore = true;
      } else if (stored === "gas") {
        API_CONFIG.useFirestore = false;
      }
    }
    if (API_CONFIG.useFirestore) {
      console.log("🔥 後端模式：Firestore（Cloud Functions）");
    } else {
      console.log("📊 後端模式：Google Apps Script");
    }
  } catch (e) {
    console.warn("後端切換 override 失敗，使用預設值：", e);
  }
})();

/**
 * 根據當前頁面位置動態決定登入後的重定向 URL
 * @returns {string} - 回傳完整的回跳網址
 */
function getRedirectUrl() {
  const currentUrl = window.location.href;
  const protocol = window.location.protocol;
  const hostname = window.location.hostname;
  const port = window.location.port ? `:${window.location.port}` : '';

  // 判斷是本地測試環境還是正式環境
  const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1';

  if (isLocalhost) {
    // 本地測試環境（例如 http://127.0.0.1:5501）
    // 回跳到本地測試環境的首頁
    return `${protocol}//${hostname}${port}/index.html`;
  } else {
    // 正式環境（例如 https://wenhuistage-ops.github.io）
    // 回跳到正式環境的首頁
    return API_CONFIG.redirectUrl;
  }
}
