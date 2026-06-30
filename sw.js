/**
 * Service Worker — 文輝考勤系統 PWA
 *
 * 設計原則（重要）：
 * - 採「網路優先 (network-first)」策略，線上時一律拿最新檔案，避免出現
 *   「載到舊版 app.js」這類快取問題；只有在離線時才回退到上次快取。
 * - 只處理「同源 GET」；跨網域請求（LINE 授權、Google APIs、CDN）一律放行不攔截，
 *   以免干擾 OAuth 登入與第三方資源。
 *
 * 改版時請更新 CACHE_VERSION，activate 時會清掉舊快取。
 */
const CACHE_VERSION = 'wh-v1';
const RUNTIME_CACHE = `runtime-${CACHE_VERSION}`;

// 離線備援的最小集合（首頁殼層）。其餘檔案改由執行時 network-first 動態快取。
const OFFLINE_FALLBACK = '/index.html';

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

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // 只處理同源 GET；其餘（POST API、LINE 授權、跨網域 CDN）一律不攔截
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // 網路優先：成功就更新快取並回傳；失敗（離線）才回退快取
  event.respondWith(
    fetch(req)
      .then((res) => {
        // 僅快取正常回應
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          caches.open(RUNTIME_CACHE).then((cache) => cache.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(async () => {
        const cached = await caches.match(req);
        if (cached) return cached;
        // 導覽請求離線時回退到首頁殼層
        if (req.mode === 'navigate') {
          const shell = await caches.match(OFFLINE_FALLBACK);
          if (shell) return shell;
        }
        return Response.error();
      })
  );
});
