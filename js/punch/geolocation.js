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
                        if (error.code === error.PERMISSION_DENIED) {
                            resolve(false); // 用戶拒絕
                        } else {
                            resolve(false); // 其他錯誤
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
                    msg: `${err.message} (已重試 ${MAX_RETRIES} 次)`
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

console.log('✓ geolocation 模組已加載');

// CommonJS export（僅 Node.js/Jest，瀏覽器無影響）
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        PUNCH_GEOLOCATION_OPTIONS,
        GPS_ACCURACY_THRESHOLDS,
        checkGeolocationPermission,
        requestGeolocationPermission,
        getAccurateLocation,
    };
}
