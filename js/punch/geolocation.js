/**
 * 地理位置模組（從 punch.js Region 1 抽出）
 *
 * 職責：
 * - Permissions API 查詢/請求
 * - 高精度 GPS 定位與重試
 * - 最近定位快取
 *
 * 依賴全域：showNotification、t、generalButtonState（core.js / i18n.js / ui.js）
 *
 * 載入順序：必須在 punch-flow.js 之前載入。
 */

// ===================================
// #region 地理位置常數與快取
// ===================================

let lastPunchPosition = null;
const PUNCH_GEOLOCATION_OPTIONS = {
    enableHighAccuracy: true,  // 改為高精確度模式
    timeout: 15000,            // 增加超時時間到15秒
    maximumAge: 300000         // 5 分鐘內的快取位置
};

// GPS 精確度閾值設定
const GPS_ACCURACY_THRESHOLDS = {
    EXCELLENT: 10,   // 10公尺以內 - 優秀
    GOOD: 25,        // 25公尺以內 - 良好
    FAIR: 50,        // 50公尺以內 - 一般
    POOR: 100        // 100公尺以上 - 較差
};

// 地理位置權限狀態快取
let geolocationPermissionStatus = null;

// ===================================
// #region 權限查詢與請求
// ===================================

// 檢查地理位置權限狀態
async function checkGeolocationPermission() {
    if (!navigator.permissions) {
        // 不支持 Permissions API 的瀏覽器
        return 'unknown';
    }

    try {
        const result = await navigator.permissions.query({ name: 'geolocation' });
        geolocationPermissionStatus = result.state;

        // 監聽權限變化
        result.addEventListener('change', () => {
            geolocationPermissionStatus = result.state;
            console.log('地理位置權限狀態變更:', result.state);
        });

        return result.state; // 'granted', 'denied', 'prompt'
    } catch (error) {
        console.warn('檢查地理位置權限失敗:', error);
        return 'unknown';
    }
}

// 請求地理位置權限（優化用戶體驗）
async function requestGeolocationPermission() {
    return new Promise((resolve) => {
        // 先檢查權限狀態
        checkGeolocationPermission().then(permission => {
            if (permission === 'granted') {
                // 權限已授予，直接解析
                resolve(true);
            } else if (permission === 'denied') {
                // 權限被拒絕
                resolve(false);
            } else {
                // 需要請求權限，嘗試獲取一次位置來觸發權限請求
                navigator.geolocation.getCurrentPosition(
                    () => resolve(true),  // 成功
                    (error) => {
                        // 只有「真的被拒絕」(code 1) 才當作沒有權限；
                        // GPS 抓不到 / 逾時 (code 2/3) 不是權限問題 —— 放行讓後續正式定位
                        // (getAccurateLocation) 顯示真正的錯誤，避免把訊號問題誤報成「使用者拒絕」。
                        if (error.code === error.PERMISSION_DENIED) {
                            resolve(false); // 使用者/系統拒絕
                        } else {
                            resolve(true);  // 非權限錯誤：放行，由正式定位流程回報真正原因
                        }
                    },
                    { timeout: 10000, enableHighAccuracy: false } // 快速檢查
                );
            }
        });
    });
}

// ===================================
// #region 精確定位（含重試）
// ===================================

// 獲取精確位置的函數，包含精確度檢查和重試機制
async function getAccurateLocation(onSuccess, button, retryCount = 0) {
    const MAX_RETRIES = 1; // 🚀 P5-1 優化：只在完全失敗時重試一次
    const RETRY_DELAY = 500; // 500ms 快速重試

    return new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(
            async (pos) => {
                const accuracy = pos.coords.accuracy;
                const lat = pos.coords.latitude;
                const lng = pos.coords.longitude;

                // 儲存位置資訊
                lastPunchPosition = {
                    latitude: lat,
                    longitude: lng,
                    accuracy: accuracy,
                    timestamp: Date.now()
                };

                // 🚀 P5-1 優化：移除精確度檢查，直接使用獲取的位置
                // 精確度驗證交由後端處理（後端知道公司位置和允許範圍）
                // 評估精確度品質（僅用於通知，不影響是否提交）
                let quality;
                if (accuracy <= GPS_ACCURACY_THRESHOLDS.EXCELLENT) {
                    quality = 'excellent';
                } else if (accuracy <= GPS_ACCURACY_THRESHOLDS.GOOD) {
                    quality = 'good';
                } else if (accuracy <= GPS_ACCURACY_THRESHOLDS.FAIR) {
                    quality = 'fair';
                } else {
                    quality = 'poor';
                }

                // 只在精確度太差時提示，但仍然提交
                if (quality === 'poor') {
                    const accuracyMsg = t('GPS_ACCURACY_WARNING', {
                        accuracy: Math.round(accuracy),
                        quality: t(`GPS_QUALITY_${quality.toUpperCase()}`) || quality
                    }) || `GPS精確度: ${Math.round(accuracy)}m (${quality})，將由後端驗證`;
                    showNotification(accuracyMsg, "info");
                }

                // 呼叫成功回調
                await onSuccess(lat, lng, accuracy);
                resolve();
            },
            (err) => {
                // 🚀 P5-1 優化：只在網路錯誤時重試，不在精確度差時重試
                if (retryCount < MAX_RETRIES) {
                    const retryMsg = t('GPS_RETRY_ON_ERROR', {
                        error: err.message,
                        retry: retryCount + 1,
                        max: MAX_RETRIES
                    }) || `GPS獲取失敗，正在重試 (${retryCount + 1}/${MAX_RETRIES})...`;

                    showNotification(retryMsg, "warning");

                    setTimeout(() => {
                        getAccurateLocation(onSuccess, button, retryCount + 1)
                            .then(resolve)
                            .catch(reject);
                    }, RETRY_DELAY);
                    return;
                }

                // 達到最大重試次數，顯示錯誤
                const errorMsg = t("ERROR_GEOLOCATION", {
                    msg: `${err.message || ''} [code ${err.code}] (已重試 ${MAX_RETRIES} 次)`
                });
                showNotification(errorMsg, "error");
                generalButtonState(button, 'idle');
                reject(err);
            },
            PUNCH_GEOLOCATION_OPTIONS
        );
    });
}
// #endregion

// ===================================
// #region 定位權限引導（被拒絕 code 1 時的友善說明）
// ===================================

let _geoHelpEl = null;

function _detectGeoPlatform() {
    const ua = navigator.userAgent || '';
    const isIOS = /iphone|ipad|ipod/i.test(ua) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const isAndroid = /android/i.test(ua);
    const isStandalone = window.navigator.standalone === true ||
        (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
    return { isIOS, isAndroid, isStandalone };
}

function _closeGeoHelp() {
    if (_geoHelpEl && _geoHelpEl.parentNode) _geoHelpEl.parentNode.removeChild(_geoHelpEl);
    _geoHelpEl = null;
}

/**
 * 顯示「如何開啟定位權限」引導彈窗（平台對應步驟 + 重新嘗試）
 * @param {Object} [opts]
 * @param {Function} [opts.onRetry] - 點「重新嘗試」時呼叫
 * @param {{label:string, onClick:Function}} [opts.secondary] - 次要動作（如管理員手動打卡）
 */
function showLocationPermissionHelp(opts) {
    opts = opts || {};
    if (_geoHelpEl) return; // 避免重複開啟
    const { isIOS, isAndroid, isStandalone } = _detectGeoPlatform();

    let steps;
    if (isIOS) {
        const appName = isStandalone ? '「文輝考勤」' : '「Safari 網站」';
        steps = [
            '開啟 iPhone 的「設定」App',
            '點「隱私權與安全性」→「定位服務」，確認最上方總開關為開啟',
            `往下找到 ${appName}，點進去選「使用 App 期間」，並開啟「精確位置」`,
            '回到本頁，點下方「重新嘗試」',
        ];
    } else if (isAndroid) {
        steps = [
            '開啟手機「設定」→「位置」，確認定位已開啟',
            '在瀏覽器點網址列左側的鎖頭圖示 →「權限」→「位置」→ 改為「允許」',
            '（或：Chrome 選單 →「設定」→「網站設定」→「位置」→ 允許）',
            '回到本頁，點下方「重新嘗試」',
        ];
    } else {
        steps = [
            '點瀏覽器網址列旁的鎖頭／資訊圖示',
            '找到「位置」權限，改為「允許」',
            '重新整理頁面後再試一次',
        ];
    }

    // 遮罩
    const overlay = document.createElement('div');
    overlay.style.cssText = [
        'position:fixed', 'inset:0', 'z-index:10000',
        'background:rgba(0,0,0,.45)', 'display:flex',
        'align-items:center', 'justify-content:center', 'padding:16px'
    ].join(';');

    // 卡片
    const card = document.createElement('div');
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    card.style.cssText = [
        'background:#fff', 'color:#1f2937', 'border-radius:16px',
        'max-width:440px', 'width:100%', 'padding:22px',
        'box-shadow:0 20px 60px rgba(0,0,0,.3)',
        'max-height:90vh', 'overflow:auto', 'font-size:15px', 'line-height:1.6'
    ].join(';');

    const title = document.createElement('div');
    title.textContent = tr_geo('LOCATION_HELP_TITLE', '需要開啟定位權限');
    title.style.cssText = 'font-size:18px;font-weight:800;margin-bottom:6px';

    const intro = document.createElement('div');
    intro.textContent = tr_geo('LOCATION_HELP_INTRO', '打卡需要您的位置，但目前定位權限被關閉了。請依下列步驟開啟：');
    intro.style.cssText = 'color:#4b5563;margin-bottom:14px';

    const ol = document.createElement('ol');
    ol.style.cssText = 'margin:0 0 18px 0;padding-left:22px;display:flex;flex-direction:column;gap:8px';
    steps.forEach((s) => {
        const li = document.createElement('li');
        li.textContent = s; // textContent：避免任何 XSS
        ol.appendChild(li);
    });

    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;flex-direction:column;gap:10px';

    const retryBtn = document.createElement('button');
    retryBtn.textContent = tr_geo('LOCATION_HELP_RETRY', '重新嘗試');
    retryBtn.style.cssText = 'background:#4f46e5;color:#fff;border:none;border-radius:12px;padding:12px;font-weight:700;font-size:15px;cursor:pointer';
    retryBtn.onclick = () => { _closeGeoHelp(); if (typeof opts.onRetry === 'function') opts.onRetry(); };
    btnRow.appendChild(retryBtn);

    if (opts.secondary && typeof opts.secondary.onClick === 'function') {
        const secBtn = document.createElement('button');
        secBtn.textContent = opts.secondary.label || '其他方式';
        secBtn.style.cssText = 'background:#f3f4f6;color:#374151;border:none;border-radius:12px;padding:11px;font-weight:600;font-size:14px;cursor:pointer';
        secBtn.onclick = () => { _closeGeoHelp(); opts.secondary.onClick(); };
        btnRow.appendChild(secBtn);
    }

    const closeBtn = document.createElement('button');
    closeBtn.textContent = tr_geo('LOCATION_HELP_CLOSE', '關閉');
    closeBtn.style.cssText = 'background:transparent;color:#6b7280;border:none;padding:6px;font-size:14px;cursor:pointer';
    closeBtn.onclick = _closeGeoHelp;
    btnRow.appendChild(closeBtn);

    card.appendChild(title);
    card.appendChild(intro);
    card.appendChild(ol);
    card.appendChild(btnRow);
    overlay.appendChild(card);
    // 點遮罩空白處關閉
    overlay.addEventListener('click', (e) => { if (e.target === overlay) _closeGeoHelp(); });
    document.body.appendChild(overlay);
    _geoHelpEl = overlay;
}

// 取翻譯（無 i18n 時用中文 fallback）
function tr_geo(key, fallback) {
    try {
        if (typeof t === 'function') {
            const v = t(key);
            if (v && v !== key) return v;
        }
    } catch (_) { /* ignore */ }
    return fallback;
}
// #endregion

console.log('✓ geolocation 模組已加載');

// CommonJS export（僅 Node.js/Jest，瀏覽器無影響）
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        PUNCH_GEOLOCATION_OPTIONS,
        GPS_ACCURACY_THRESHOLDS,
        checkGeolocationPermission,
        requestGeolocationPermission,
        getAccurateLocation,
        showLocationPermissionHelp,
    };
}
