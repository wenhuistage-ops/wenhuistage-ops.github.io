/**
 * PWA 整合模組
 *
 * 職責：
 * 1. 註冊 Service Worker（/sw.js）。
 * 2. 偵測是否以「主畫面 App（standalone 全螢幕）」開啟，並在 <html> 加上 class。
 * 3. Android：攔截 beforeinstallprompt，提供「安裝 App」按鈕。
 * 4. iOS Safari：iOS 沒有自動安裝提示，顯示「加入主畫面」引導。
 * 5. 回 App 引導：在一般瀏覽器（非全螢幕）提示使用者直接從主畫面 App 登入，
 *    因為 iOS 全螢幕 App 與 Safari 的登入狀態是各自獨立的，於 App 內登入體驗最佳。
 *
 * 註：登入採「同視窗跳轉」(window.location.href)，這在 iOS 全螢幕 App 下會留在
 * App 內完成 LINE 授權並跳回，登入狀態存於 App 自己的儲存空間 —— 這是關鍵設計。
 */
(function () {
  'use strict';

  // ---- 小工具 ----
  function tr(key, fallback) {
    try {
      if (typeof t === 'function') {
        const v = t(key);
        if (v && v !== key) return v;
      }
    } catch (_) { /* ignore */ }
    return fallback;
  }

  function isStandalone() {
    return (
      window.navigator.standalone === true ||
      (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)
    );
  }

  const ua = navigator.userAgent || '';
  const isIOS = /iphone|ipad|ipod/i.test(ua) ||
    // iPadOS 13+ 偽裝成 Mac，但有觸控
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  // iOS 上只有 Safari 能「加入主畫面」；排除 Chrome/Firefox/LINE 等內建瀏覽器
  const isIOSSafari = isIOS && /safari/i.test(ua) && !/crios|fxios|edgios|line/i.test(ua);

  // ---- 1. 註冊 Service Worker ----
  function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').then(
        (reg) => console.log('✓ Service Worker 已註冊', reg.scope),
        (err) => console.warn('Service Worker 註冊失敗:', err)
      );
    });
  }

  // ---- 標記全螢幕模式，方便 CSS/邏輯判斷 ----
  function markStandalone() {
    if (isStandalone()) {
      document.documentElement.classList.add('pwa-standalone');
    }
  }

  // ---- 共用：底部提示橫幅 ----
  let bannerEl = null;
  function showBanner(html, opts) {
    opts = opts || {};
    dismissBanner();
    bannerEl = document.createElement('div');
    bannerEl.setAttribute('role', 'dialog');
    bannerEl.style.cssText = [
      'position:fixed', 'left:12px', 'right:12px', 'bottom:12px', 'z-index:9999',
      'background:#ffffff', 'color:#1f2937', 'border:1px solid #e5e7eb',
      'border-radius:14px', 'box-shadow:0 8px 30px rgba(0,0,0,.18)',
      'padding:14px 16px', 'font-size:14px', 'line-height:1.6',
      'display:flex', 'align-items:center', 'gap:12px',
      'max-width:520px', 'margin:0 auto'
    ].join(';');

    const content = document.createElement('div');
    content.style.flex = '1';
    content.innerHTML = html;

    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:8px;align-items:center;flex-shrink:0';

    if (opts.actionLabel) {
      const btn = document.createElement('button');
      btn.textContent = opts.actionLabel;
      btn.style.cssText = 'background:#4f46e5;color:#fff;border:none;border-radius:10px;padding:8px 14px;font-weight:700;font-size:14px;cursor:pointer';
      btn.onclick = () => { if (opts.onAction) opts.onAction(); };
      actions.appendChild(btn);
    }

    const close = document.createElement('button');
    close.setAttribute('aria-label', 'close');
    close.textContent = '✕';
    close.style.cssText = 'background:transparent;border:none;color:#9ca3af;font-size:16px;cursor:pointer;padding:4px 6px';
    close.onclick = () => { dismissBanner(); if (opts.onDismiss) opts.onDismiss(); };
    actions.appendChild(close);

    bannerEl.appendChild(content);
    bannerEl.appendChild(actions);
    document.body.appendChild(bannerEl);
  }
  function dismissBanner() {
    if (bannerEl && bannerEl.parentNode) bannerEl.parentNode.removeChild(bannerEl);
    bannerEl = null;
  }

  const DISMISS_KEY = 'pwaInstallHintDismissed';
  function hintDismissed() {
    try { return localStorage.getItem(DISMISS_KEY) === '1'; } catch (_) { return false; }
  }
  function rememberDismiss() {
    try { localStorage.setItem(DISMISS_KEY, '1'); } catch (_) { /* ignore */ }
  }

  // ---- 2. Android：安裝提示 ----
  let deferredPrompt = null;
  function setupAndroidInstall() {
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();        // 阻止瀏覽器預設小橫幅，改由我們控制時機
      deferredPrompt = e;
      if (isStandalone() || hintDismissed()) return;
      showBanner(
        tr('PWA_INSTALL_HINT', '把「文輝考勤」加到主畫面，開啟即全螢幕、像 App 一樣使用。'),
        {
          actionLabel: tr('PWA_INSTALL_BTN', '安裝'),
          onAction: async () => {
            dismissBanner();
            if (!deferredPrompt) return;
            deferredPrompt.prompt();
            try { await deferredPrompt.userChoice; } catch (_) { /* ignore */ }
            deferredPrompt = null;
          },
          onDismiss: rememberDismiss
        }
      );
    });

    window.addEventListener('appinstalled', () => {
      deferredPrompt = null;
      dismissBanner();
      console.log('✓ PWA 已安裝');
    });
  }

  // ---- 3. iOS Safari：加入主畫面引導 ----
  function setupIOSHint() {
    if (!isIOSSafari || isStandalone() || hintDismissed()) return;
    // 等頁面穩定後再提示，避免干擾首屏
    setTimeout(() => {
      if (isStandalone() || hintDismissed()) return;
      showBanner(
        tr(
          'PWA_IOS_INSTALL_HINT',
          '想要全螢幕 App 體驗？點下方工具列的「分享」<span style="display:inline-block;border:1px solid #cbd5e1;border-radius:4px;padding:0 5px;margin:0 2px">􀈂</span>，再選「加入主畫面」。建議直接從主畫面 App 內登入。'
        ),
        { onDismiss: rememberDismiss }
      );
    }, 1500);
  }

  // 初始化
  markStandalone();
  registerSW();
  setupAndroidInstall();
  setupIOSHint();
})();
