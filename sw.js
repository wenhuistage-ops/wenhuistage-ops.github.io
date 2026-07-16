/**
 * Service Worker — 文輝考勤系統 PWA
 *
 * 設計原則（重要）：
 * - 採「網路優先 + 逾時回退 (network-first, timeout → cache)」策略：
 *   線上且網路正常時一律拿最新檔案（避免「載到舊版 app.js」）；但網路
 *   「慢但沒斷」時，逾時後改用上次快取，避免整頁在弱網（工地 4G）卡住。
 * - 只處理「同源 GET」；跨網域請求（LINE 授權、Google APIs、CDN）一律放行不攔截，
 *   以免干擾 OAuth 登入與第三方資源。
 * - 不快取帶 code/state 的 OAuth 回跳網址（一次性、含授權碼），並限制 runtime
 *   快取數量避免無限成長。
 *
 * 改版時請更新 CACHE_VERSION，activate 時會清掉舊快取。
 */
const CACHE_VERSION = 'wh-v3';
const RUNTIME_CACHE = `runtime-${CACHE_VERSION}`;

// 離線備援的最小集合（首頁殼層）。其餘檔案改由執行時動態快取。
const OFFLINE_FALLBACK = '/index.html';
// 網路優先的逾時（毫秒）：超過就改用快取，避免弱網卡住。
const NETWORK_TIMEOUT_MS = 3000;
// runtime 快取上限（筆），超過就淘汰最舊的，避免無限成長。
const MAX_RUNTIME_ENTRIES = 60;

self.addEventListener('install', (event) => {
  // 立即接手，縮短更新延遲
  event.waitUntil(
    caches.open(RUNTIME_CACHE).then((cache) => cache.addAll([OFFLINE_FALLBACK]).catch(() => {}))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== RUNTIME_CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// fetch 加逾時：逾時或失敗都 reject，交由呼叫端回退快取
function fetchWithTimeout(req, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('network-timeout')), ms);
    fetch(req).then(
      (res) => { clearTimeout(timer); resolve(res); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
}

// 寫入 runtime 快取並淘汰最舊的（Cache.keys() 依插入順序）
async function putAndTrim(req, res) {
  try {
    const cache = await caches.open(RUNTIME_CACHE);
    await cache.put(req, res);
    const keys = await cache.keys();
    const overflow = keys.length - MAX_RUNTIME_ENTRIES;
    for (let i = 0; i < overflow; i++) {
      await cache.delete(keys[i]);
    }
  } catch (_) { /* ignore */ }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // 只處理同源 GET；其餘（POST API、LINE 授權、跨網域 CDN）一律不攔截
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // OAuth 回跳網址（帶一次性 code/state）：正常取用但「不快取」
  const isAuthCallback = url.searchParams.has('code') || url.searchParams.has('state');

  event.respondWith((async () => {
    const cached = await caches.match(req);
    try {
      // 網路優先（含逾時）
      const res = await fetchWithTimeout(req, NETWORK_TIMEOUT_MS);
      if (!isAuthCallback && res && res.status === 200 && res.type === 'basic') {
        putAndTrim(req, res.clone()); // 不 await，不阻塞回應
      }
      return res;
    } catch (e) {
      // 逾時或離線：有快取就用快取（弱網不卡頁）
      if (cached) return cached;
      // 無快取且只是逾時（網路可能還活著）→ 再等一次完整網路
      if (e && e.message === 'network-timeout') {
        try {
          const res2 = await fetch(req);
          if (!isAuthCallback && res2 && res2.status === 200 && res2.type === 'basic') {
            putAndTrim(req, res2.clone());
          }
          return res2;
        } catch (_) { /* 落到下方離線處理 */ }
      }
      // 真正離線的導覽請求 → 回退首頁殼層
      if (req.mode === 'navigate') {
        const shell = await caches.match(OFFLINE_FALLBACK);
        if (shell) return shell;
      }
      return Response.error();
    }
  })());
});
