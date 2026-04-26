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
/**
 * 🚀 P2-1 優化：地圖延遲加載
 * 在用戶實際需要地圖時才進行初始化，而不是在頁面加載時立即初始化
 */

// 延遲初始化標誌
let _mapInitialized = false;

/**
 * 確保地圖已初始化，如果未初始化則進行初始化
 * 供其他模塊調用（如 ui.js 的 switchTab）
 */
function ensureMapInitialized() {
    console.log('🔍 [DEBUG] ensureMapInitialized() 被調用，_mapInitialized =', _mapInitialized);
    if (_mapInitialized) {
        console.log('📍 地圖已初始化，復用實例');
        return;
    }

    console.log('📍 開始初始化地圖...');
    _mapInitialized = true;
    initLocationMap();
}

/**
 * 從後端取得所有打卡地點，並將它們顯示在地圖上。
 */
async function fetchAndRenderLocationsOnMap() {
    try {
        //const res = await callApifetch("getLocations");
        const res = await callApifetch({
            action: 'getLocations' // 使用 endpoint 變數的值作為 action
        });
        // 清除舊的地點標記和圓形
        locationMarkers.clearLayers();
        locationCircles.clearLayers();

        if (res.ok && Array.isArray(res.locations)) {
            // 遍歷所有地點並在地圖上放置標記和圓形
            res.locations.forEach(loc => {
                // 如果沒有容許誤差，則預設為 50 公尺
                const punchInRadius = loc.scope || 50;

                // 加入圓形範圍
                const locationCircle = L.circle([loc.lat, loc.lng], {
                    color: 'red',
                    fillColor: '#f03',
                    fillOpacity: 0.2,
                    radius: punchInRadius
                });
                locationCircle.bindPopup(`<b>${loc.name}</b><br>可打卡範圍：${punchInRadius}公尺`);
                locationCircles.addLayer(locationCircle);
            });

            // 將所有地點標記和圓形一次性加到地圖上
            locationMarkers.addTo(mapInstance);
            locationCircles.addTo(mapInstance);

            console.log("地點標記和範圍已成功載入地圖。");
        } else {
            showNotification(t("MSG_FETCH_LOCATIONS_FAILED", { msg: res.msg || "" }), "error");
            console.error("Failed to fetch locations:", res.msg);
        }
    } catch (error) {
        showNotification(t("MSG_FETCH_LOCATIONS_NETWORK_ERROR"), "error");
        console.error("Failed to fetch locations:", error);
    } finally {
        // 確保地圖加載文本被隱藏（即使 API 失敗）
        if (mapLoadingText) {
            mapLoadingText.style.display = 'none';
            console.log('✅ 地圖加載文本已隱藏（在 fetchAndRenderLocationsOnMap 中）');
        }
    }
}
// 初始化地圖並取得使用者位置
function initLocationMap(forceReload = false) {
    console.log('🔍 [DEBUG] initLocationMap() 被調用，forceReload =', forceReload);
    const mapContainer = document.getElementById('map-container');
    const statusEl = document.getElementById('location-status');
    const coordsEl = document.getElementById('location-coords');

    console.log('🔍 [DEBUG] mapContainer =', mapContainer, ', statusEl =', statusEl, ', coordsEl =', coordsEl);

    // 取得載入文字元素
    if (!mapLoadingText) {
        mapLoadingText = document.getElementById('map-loading-text');
        console.log('🔍 [DEBUG] 獲取 mapLoadingText =', mapLoadingText);
    }

    // 檢查地圖實例是否已存在
    if (mapInstance) {
        // 如果已經存在，並且沒有被要求強制重新載入，則直接返回
        if (!forceReload) {
            mapInstance.invalidateSize();
            return;
        }

        // 如果被要求強制重新載入，則先徹底銷毀舊的地圖實例
        mapInstance.remove();
        mapInstance = null;
    }

    // 顯示載入中的文字（安全檢查）
    if (mapLoadingText) {
        mapLoadingText.style.display = 'block';
        console.log('✅ 地圖載入文本已顯示');
    } else {
        console.warn('⚠️ [警告] mapLoadingText 元素未找到！');
    }

    // 建立地圖
    mapInstance = L.map('map-container', {
        center: [25.0330, 121.5654], // 預設中心點為台北市
        zoom: 13
    });

    // 加入 OpenStreetMap 圖層
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(mapInstance);

    // 🐛 P2-1 修複：初始化 locationMarkers 和 locationCircles (FeatureGroup)
    // 這些變數在 state.js 中宣告但未初始化，會導致 fetchAndRenderLocationsOnMap() 調用時出錯
    if (!locationMarkers) {
        locationMarkers = L.featureGroup().addTo(mapInstance);
        console.log('✅ locationMarkers FeatureGroup 已初始化');
    }
    if (!locationCircles) {
        locationCircles = L.featureGroup().addTo(mapInstance);
        console.log('✅ locationCircles FeatureGroup 已初始化');
    }

    // 讓地圖在完成載入後隱藏載入中的文字
    mapInstance.whenReady(() => {
        if (mapLoadingText) {
            mapLoadingText.style.display = 'none';
        }
        // 確保地圖的尺寸正確
        mapInstance.invalidateSize();
    });

    // 🐛 P2-1 修複：在地圖容器變為可見時重新計算大小
    // 因為初始化時容器可能還是 display:none，導致 Leaflet 無法正確計算大小
    const observer = new MutationObserver(() => {
        if (mapContainer && mapContainer.offsetWidth > 0 && mapContainer.offsetHeight > 0) {
            mapInstance.invalidateSize();
            console.log('✅ 地圖容器尺寸已重新計算');
        }
    });
    if (mapContainer) {
        observer.observe(mapContainer, {
            attributes: true,
            attributeFilter: ['style'],
            attributeOldValue: true
        });
    }

    // 也直接隐藏加载文本（以防 whenReady 没有触发）
    setTimeout(() => {
        if (mapLoadingText && mapLoadingText.style.display !== 'none') {
            mapLoadingText.style.display = 'none';
            console.log('✓ 地圖加載文本已隱藏');
        }
    }, 1000);

    // 確保即使地圖初始化失敗也會隱藏加載文本
    setTimeout(() => {
        const loadingEl = document.getElementById('map-loading-text');
        if (loadingEl) {
            loadingEl.style.display = 'none';
            console.log('✓ 強制隱藏地圖加載文本');
        }
    }, 3000);

    // 顯示載入狀態
    //mapContainer.innerHTML = t("MAP_LOADING");
    statusEl.textContent = t('DETECTING_LOCATION');
    coordsEl.textContent = t('UNKNOWN_LOCATION');

    // 取得使用者地理位置
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            (position) => {
                const { latitude, longitude } = position.coords;
                currentCoords = [latitude, longitude];

                // 更新狀態顯示
                statusEl.textContent = t('DETECTION_SUCCESS');
                coordsEl.textContent = `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;

                // 設定地圖視圖
                mapInstance.setView(currentCoords, 18);

                // 在地圖上放置標記
                if (marker) mapInstance.removeLayer(marker);
                marker = L.marker(currentCoords).addTo(mapInstance)
                    .bindPopup(t('CURRENT_LOCATION'))
                    .openPopup();


            },
            (error) => {
                // 處理定位失敗
                statusEl.textContent = t('ERROR_GEOLOCATION_PERMISSION_DENIED');
                console.error("Geolocation failed:", error);

                let message;
                switch (error.code) {
                    case error.PERMISSION_DENIED:
                        message = t('ERROR_GEOLOCATION_PERMISSION_DENIED');
                        break;
                    case error.POSITION_UNAVAILABLE:
                        message = t('ERROR_GEOLOCATION_UNAVAILABLE');
                        break;
                    case error.TIMEOUT:
                        message = t('ERROR_GEOLOCATION_TIMEOUT');
                        break;
                    case error.UNKNOWN_ERROR:
                        message = t('ERROR_GEOLOCATION_UNKNOWN');
                        break;
                }
                showNotification(t("MSG_GEOLOCATION_FAILED", { message: message || "" }), "error");
            }
        );
        // 成功取得使用者位置後，載入所有打卡地點
        fetchAndRenderLocationsOnMap();
    } else {
        showNotification(t('ERROR_BROWSER_NOT_SUPPORTED'), "error");
        statusEl.textContent = '不支援定位';
    }
}

// 將 admin map 初始化抽成可重入函式（只執行一次）
let _adminMapInitialized = false;
function initAdminAddLocationMapIfNeeded() {
    if (_adminMapInitialized) return;
    const mapContainer = document.getElementById('admin-add-location-map');
    if (!mapContainer) return;
    // 若容器尚不可見（display:none 或 0 寬度），跳過，等 MutationObserver 觸發
    const visible = mapContainer.offsetWidth > 0 && mapContainer.offsetHeight > 0;
    if (!visible) return;

    _adminMapInitialized = true;

    // 原本的初始化程式碼（縮短顯示，請確保這裡包含你的 adminMap 變數使用）
    // Leaflet init
    let adminMap, adminMarker, adminCircle;
    let adminRadius = 50; // default meters

    const latInput = document.getElementById('location-lat');
    const lngInput = document.getElementById('location-lng');
    const nameInput = document.getElementById('location-name');
    const radiusSlider = document.getElementById('location-radius-slider');
    const radiusDisplay = document.getElementById('location-radius-display');
    const addBtn = document.getElementById('add-location-btn');
    const getLocBtn = document.getElementById('get-location-btn');

    // 初始化 radius UI
    if (radiusSlider && radiusDisplay) {
        adminRadius = parseInt(radiusSlider.value, 10) || adminRadius;
        radiusDisplay.textContent = `${adminRadius} m`;
        radiusSlider.addEventListener('input', (e) => {
            adminRadius = parseInt(e.target.value, 10) || adminRadius;
            radiusDisplay.textContent = `${adminRadius} m`;
            // 若已放置圓圈，更新半徑
            if (adminCircle) adminCircle.setRadius(adminRadius);
        });
    }

    function enableAddIfReady() {
        if (nameInput && nameInput.value.trim() !== '' && latInput.value && lngInput.value) {
            addBtn.disabled = false;
        } else {
            addBtn.disabled = true;
        }
    }

    function updateInputsAndEnable(lat, lng) {
        if (latInput) latInput.value = lat.toFixed ? lat.toFixed(6) : lat;
        if (lngInput) lngInput.value = lng.toFixed ? lng.toFixed(6) : lng;
        enableAddIfReady();
    }

    function placeMarker(latlng) {
        if (!adminMap) return;
        if (adminMarker) {
            adminMarker.setLatLng(latlng);
        } else {
            adminMarker = L.marker(latlng).addTo(adminMap);
        }
        adminMap.setView(latlng, 16);
        updateInputsAndEnable(latlng.lat, latlng.lng);

        // 建立或更新範圍圓形
        if (adminCircle) {
            adminCircle.setLatLng(latlng);
            adminCircle.setRadius(adminRadius);
        } else {
            adminCircle = L.circle(latlng, {
                radius: adminRadius,
                color: '#10b981',
                fillColor: '#10b981',
                fillOpacity: 0.15,
                weight: 2
            }).addTo(adminMap);
        }
    }
    // 若使用者只改變半徑且尚未放置 marker，將圓心設為地圖中心（預覽）
    function ensurePreviewCircle() {
        if (!adminMap) return;
        const center = adminMap.getCenter();
        if (adminCircle) {
            adminCircle.setRadius(adminRadius);
        } else {
            adminCircle = L.circle(center, {
                radius: adminRadius,
                color: '#10b981',
                fillColor: '#10b981',
                fillOpacity: 0.08,
                weight: 1
            }).addTo(adminMap);
        }
    }

    // initialize map with a default center
    adminMap = L.map('admin-add-location-map', { attributionControl: false }).setView([23.5, 121], 8);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19
    }).addTo(adminMap);

    adminMap.whenReady(() => {
        const loadingEl = document.getElementById('admin-map-loading');
        if (loadingEl) loadingEl.style.display = 'none';
        adminMap.invalidateSize();
        // 建立初始預覽圓（若使用者尚未點選地圖）
        ensurePreviewCircle();
    });

    // on map click, place marker and update inputs
    adminMap.on('click', function (e) {
        placeMarker(e.latlng);
    });

    // Get current position -> place marker
    if (getLocBtn) {
        getLocBtn.addEventListener('click', () => {
            if (!navigator.geolocation) {
                alert(t('MSG_GEOLOCATION_UNSUPPORTED'));
                return;
            }
            getLocBtn.disabled = true;
            getLocBtn.textContent = t('LOADING') || '取得中…';
            navigator.geolocation.getCurrentPosition((pos) => {
                const lat = pos.coords.latitude;
                const lng = pos.coords.longitude;
                placeMarker({ lat, lng });
                // 若有圓形，確保半徑同步
                if (adminCircle) adminCircle.setRadius(adminRadius);
                getLocBtn.disabled = false;
                getLocBtn.textContent = t('GET_LOCATION_BTN') || '取得當前位置';
            }, (err) => {
                console.error(err);
                alert(t('MSG_GEOLOCATION_ERROR', { message: err.message || err.code || '' }));
                getLocBtn.disabled = false;
                getLocBtn.textContent = t('GET_LOCATION_BTN') || '取得當前位置';
            }, { enableHighAccuracy: true, timeout: 10000 });
        });
    }

    // enable add button when name changed and lat/lng present
    if (nameInput) {
        nameInput.addEventListener('input', enableAddIfReady);
    }

    // If lat/lng already present (e.g., restored), place marker
    if (latInput && lngInput && latInput.value && lngInput.value) {
        const lat = parseFloat(latInput.value);
        const lng = parseFloat(lngInput.value);
        if (!isNaN(lat) && !isNaN(lng)) {
            placeMarker({ lat, lng });
        }
    }

    // 在 adminMap 初始化或 whenReady 之後加入地標搜尋邏輯
    // --- Admin 地圖地標搜尋功能 ---
    const searchInput = document.getElementById('admin-map-search-input');
    const searchResultsEl = document.getElementById('admin-map-search-results');
    const searchClearBtn = document.getElementById('admin-map-search-clear');

    function debounce(fn, wait = 300) {
        let t = null;
        return (...args) => {
            clearTimeout(t);
            t = setTimeout(() => fn(...args), wait);
        };
    }

    async function nominatimSearch(q) {
        if (!q || q.trim().length === 0) return [];
        const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=6&addressdetails=1`;
        try {
            const res = await fetch(url, { headers: { 'Accept-Language': (typeof currentLang !== 'undefined' ? currentLang : 'zh-TW') } });
            if (!res.ok) return [];
            const data = await res.json();
            return Array.isArray(data) ? data : [];
        } catch (e) {
            console.error('Nominatim search error', e);
            return [];
        }
    }

    function renderSearchResults(items) {
        // ✅ XSS防護：使用 replaceChildren() 替代 innerHTML
        searchResultsEl.replaceChildren();
        if (!items || items.length === 0) {
            searchResultsEl.style.display = 'none';
            return;
        }
        searchResultsEl.style.display = 'block';
        items.forEach((it, idx) => {
            const li = document.createElement('li');
            li.tabIndex = 0;
            li.setAttribute('role', 'option');
            li.dataset.lat = it.lat;
            li.dataset.lon = it.lon;
            li.dataset.display = it.display_name || '';
            // ✅ XSS防護：使用 DOMPurify 淨化 HTML
            li.innerHTML = DOMPurify.sanitize(`<div>${it.display_name}</div><small>${it.type || ''} ${it.class || ''}</small>`);
            li.addEventListener('click', () => {
                const lat = parseFloat(li.dataset.lat);
                const lon = parseFloat(li.dataset.lon);
                placeMarker({ lat, lng: lon, latlng: { lat, lng: lon } } /* normalized for placeMarker */);
                // set inputs
                if (latInput) latInput.value = lat.toFixed(6);
                if (lngInput) lngInput.value = lon.toFixed(6);
                // optionally fill name field if empty
                if (nameInput && (!nameInput.value || nameInput.value.trim() === '')) {
                    nameInput.value = it.display_name.split(',')[0] || it.display_name;
                }
                clearSearchResults();
            });
            li.addEventListener('keydown', (ev) => {
                if (ev.key === 'Enter') li.click();
            });
            searchResultsEl.appendChild(li);
        });
    }

    function clearSearchResults() {
        searchResultsEl.replaceChildren();
        searchResultsEl.style.display = 'none';
        if (searchClearBtn) searchClearBtn.style.display = 'none';
    }

    const doSearch = debounce(async (q) => {
        if (!q || q.trim() === '') {
            clearSearchResults();
            return;
        }
        const items = await nominatimSearch(q);
        renderSearchResults(items);
        if (searchClearBtn) searchClearBtn.style.display = 'block';
    }, 300);

    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            const q = e.target.value;
            doSearch(q);
        });
        // Enter: 選第一個結果（若存在）
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                const first = searchResultsEl.querySelector('li');
                if (first) first.click();
            } else if (e.key === 'Escape') {
                clearSearchResults();
            }
        });
    }
    if (searchClearBtn) {
        searchClearBtn.addEventListener('click', () => {
            if (searchInput) searchInput.value = '';
            clearSearchResults();
            searchInput && searchInput.focus();
        });
    }
    // 點擊外部關閉結果
    document.addEventListener('click', (ev) => {
        if (!searchInput) return;
        if (!ev.target.closest || (!ev.target.closest('#admin-map-search') && !ev.target.closest('#admin-map-search-results'))) {
            clearSearchResults();
        }
    });
    // 若 map 尚未初始化時輸入搜尋，嘗試初始化 admin map
    if (searchInput) {
        searchInput.addEventListener('focus', () => {
            // 嘗試初始化 admin map（若使用延遲初始化機制）
            if (typeof initAdminAddLocationMapIfNeeded === 'function') {
                initAdminAddLocationMapIfNeeded();
            }
        });
    }
    // --- end admin search ---
}

// 在 DOMContentLoaded 時設置一次性的觀察器，當容器變為可見時初始化
document.addEventListener('DOMContentLoaded', () => {
    const mapContainer = document.getElementById('admin-add-location-map');
    if (!mapContainer) return;

    // 立刻嘗試初始化（如果已可見）
    initAdminAddLocationMapIfNeeded();

    if (!_adminMapInitialized) {
        const observer = new MutationObserver(() => {
            initAdminAddLocationMapIfNeeded();
            if (_adminMapInitialized) observer.disconnect();
        });
        observer.observe(mapContainer, { attributes: true, childList: false, subtree: false });
        // 另外監聽容器尺寸變化（更可靠）
        const ro = new ResizeObserver(() => {
            initAdminAddLocationMapIfNeeded();
            if (_adminMapInitialized) ro.disconnect();
        });
        ro.observe(mapContainer);
    }
});