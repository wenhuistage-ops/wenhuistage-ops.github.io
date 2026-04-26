/**
 * 打卡流程模組（從 punch.js Region 1 抽出）
 *
 * 職責：
 * - 打卡主入口 doPunch（含 GPS 快取邏輯、API 提交、效能紀錄）
 * - 權限被拒絕時的降級流程
 * - 無定位打卡（管理員權限）
 *
 * 依賴全域：
 * - state.js：punchInBtn、punchOutBtn
 * - core.js：callApifetch、showNotification、verifyAdminPermission
 * - i18n.js：t
 * - ui.js：generalButtonState
 * - geolocation.js：requestGeolocationPermission、getAccurateLocation、
 *                   lastPunchPosition、PUNCH_GEOLOCATION_OPTIONS、
 *                   GPS_ACCURACY_THRESHOLDS、geolocationPermissionStatus
 *
 * 載入順序：必須在 geolocation.js 之後、punch.js 之前。
 */

// ===================================
// #region 主打卡流程
// ===================================

async function doPunch(type) {
    const punchButtonId = type === '上班' ? 'punch-in-btn' : 'punch-out-btn';

    // 🌟 修正點：使用全域變數，而非 document.getElementById 🌟
    // punchInBtn 和 punchOutBtn 已在 state.js 宣告並在 app.js 中賦值
    const button = (punchButtonId === 'punch-in-btn' ? punchInBtn : punchOutBtn);
    const loadingText = t('LOADING') || '處理中...';

    if (!button) return;

    // 🚀 P5-1 性能計時：記錄打卡開始時間
    const punchStartTime = performance.now();
    const punchMetrics = { start: punchStartTime };

    // A. 進入處理中狀態 (generalButtonState 來自 ui.js)
    generalButtonState(button, 'processing', loadingText);

    // B. 檢查地理位置權限
    const hasPermission = await requestGeolocationPermission();
    if (!hasPermission) {
        // 權限被拒絕，提供降級方案
        await handleLocationPermissionDenied(button);
        return;
    }

    const submitPunch = async (lat, lng, accuracy, geoTime) => {
        try {
            const apiStart = performance.now();
            const res = await callApifetch({
                action: 'punch',
                type: type,
                lat: lat,
                lng: lng,
                note: `精確度: ${Math.round(accuracy)}m | ${navigator.userAgent}`
            });
            const apiEnd = performance.now();
            const apiTime = apiEnd - apiStart;

            const msg = t(res.code || "UNKNOWN_ERROR", res.params || {});
            showNotification(msg, res.ok ? "success" : "error");
            generalButtonState(button, 'idle');

            if (res.ok) {
                const totalTime = apiEnd - punchStartTime;
                // 🚀 P5-1 性能統計輸出
                console.log(`✅ 打卡成功！`);
                console.log(`   總耗時: ${totalTime.toFixed(0)}ms`);
                console.log(`   ├─ GPS獲取: ${geoTime.toFixed(0)}ms`);
                console.log(`   ├─ API提交: ${apiTime.toFixed(0)}ms`);
                console.log(`   └─ 其他: ${(totalTime - geoTime - apiTime).toFixed(0)}ms`);

                // 🚀 P5-3 優化：顯示後端詳細計時
                if (res.backend_timings) {
                    console.log(`\n🔍 後端耗時分析:`);
                    console.log(`   ├─ checkSession: ${res.backend_timings.session}ms`);
                    console.log(`   ├─ validateCoordinates: ${res.backend_timings.validate}ms`);
                    console.log(`   ├─ getLocationsCached: ${res.backend_timings.locations}ms`);
                    console.log(`   ├─ 距離計算: ${res.backend_timings.distance}ms`);
                    console.log(`   └─ appendRow: ${res.backend_timings.append}ms`);
                }
            }
        } catch (err) {
            console.error(err);
            generalButtonState(button, 'idle');
        }
    };

    // 檢查快取位置是否仍然有效
    const canUseCachedPosition = lastPunchPosition &&
        (Date.now() - lastPunchPosition.timestamp < PUNCH_GEOLOCATION_OPTIONS.maximumAge) &&
        lastPunchPosition.accuracy <= GPS_ACCURACY_THRESHOLDS.FAIR;

    if (canUseCachedPosition) {
        // 🚀 P5-1 優化：使用快取位置時，立即提交（最快路徑）
        await submitPunch(lastPunchPosition.latitude, lastPunchPosition.longitude, lastPunchPosition.accuracy, 0);
        return;
    }

    // 記錄 GPS 獲取時間
    const geoStart = performance.now();

    // 獲取新位置
    await getAccurateLocation(async (lat, lng, accuracy) => {
        const geoEnd = performance.now();
        const geoTime = geoEnd - geoStart;
        await submitPunch(lat, lng, accuracy, geoTime);
    }, button);
}

// ===================================
// #region 權限拒絕降級
// ===================================

// 處理地理位置權限被拒絕的情況
async function handleLocationPermissionDenied(button) {
    // 顯示權限被拒絕的通知
    const permissionMsg = t('LOCATION_PERMISSION_DENIED_DETAIL') ||
        '地理位置權限已被拒絕。請在瀏覽器設定中允許此網站存取您的位置，或聯繫管理員進行手動打卡。';

    showNotification(permissionMsg, "warning");

    // 提供重新請求權限的選項
    const retryPermission = confirm(t('RETRY_LOCATION_PERMISSION') ||
        '是否要重新請求地理位置權限？');

    if (retryPermission) {
        // 清除權限快取並重試
        geolocationPermissionStatus = null;
        // 重新載入頁面來重置權限狀態（某些瀏覽器需要）
        window.location.reload();
        return;
    }

    // 詢問是否要進行無定位打卡（管理員功能）
    const proceedWithoutLocation = confirm(t('PROCEED_WITHOUT_LOCATION') ||
        '是否要進行無定位打卡？（需要管理員權限）');

    if (proceedWithoutLocation) {
        await submitPunchWithoutLocation(button);
    } else {
        generalButtonState(button, 'idle');
    }
}

// ===================================
// #region 無定位打卡（管理員）
// ===================================

// 無定位打卡功能（管理員專用）
async function submitPunchWithoutLocation(button) {
    try {
        // 🌟 修正點 (問題1.1)：使用新的驗證函數
        const isAdmin = await verifyAdminPermission();
        if (!isAdmin) {
            showNotification(t('ADMIN_ONLY_FEATURE') || '此功能僅限管理員使用', "error");
            generalButtonState(button, 'idle');
            return;
        }

        // 獲取打卡類型
        const punchType = button === punchInBtn ? '上班' : '下班';

        // 提交無定位打卡
        const res = await callApifetch({
            action: 'punchWithoutLocation',
            type: punchType,
            note: '管理員手動授權 - 無GPS定位 | ' + navigator.userAgent
        });

        const msg = t(res.code || "UNKNOWN_ERROR", res.params || {});
        showNotification(msg, res.ok ? "success" : "error");
        generalButtonState(button, 'idle');

        if (res.ok) {
            // 🚀 P5-3 優化：移除無定位打卡後的異常記錄檢查，減少 API 調用
        }
    } catch (err) {
        console.error('無定位打卡失敗:', err);
        showNotification(t('PUNCH_FAILED') || '打卡失敗', "error");
        generalButtonState(button, 'idle');
    }
}
// #endregion

console.log('✓ punch-flow 模組已加載');

// CommonJS export（僅 Node.js/Jest，瀏覽器無影響）
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        doPunch,
        handleLocationPermissionDenied,
        submitPunchWithoutLocation,
    };
}
