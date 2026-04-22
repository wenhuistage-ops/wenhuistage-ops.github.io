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
  // 正式環境的 API URL
  apiUrl: "https://script.google.com/macros/s/AKfycby28KblKy-ICEGstB7L-UK5rQ1awPokRiIIdqpJ49_7nVmS_oHYiA9qapWtOVo_UnEHbQ/exec",
  // 預設回呼網址（正式環境）
  redirectUrl: "https://wenhuistage-ops.github.io/"
  // 你也可以在這裡加入其他設定，例如：
  // timeout: 5000,
  // version: 'v1.0'
};

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
