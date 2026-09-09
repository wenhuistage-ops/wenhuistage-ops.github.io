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
 * U-L9（2026-09-09）：安裝提示時機由「iOS 載入後 1.5 秒 / Android beforeinstallprompt
 * 一到就跳」改成「已登入 且 首次打卡成功之後」；關閉也不再是永久靜音，改為 7 天 snooze。
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
        (reg) => debugLog('✓ Service Worker 已註冊', reg.scope),
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
    // 非強制回應的通知，用 region 而非 dialog（dialog 會讓讀屏軟體把後面的頁面當成不可用）
    bannerEl.setAttribute('role', 'region');
    bannerEl.setAttribute('aria-label', tr('PWA_INSTALL_BTN', '安裝'));
    // U-L2：原本硬編 background:#ffffff; color:#1f2937，深色模式下白底突兀。
    // 配色改由 style.css 的 .pwa-banner（含 html.dark 版本）提供，這裡只留版面。
    bannerEl.className = 'pwa-banner';
    bannerEl.style.cssText = [
      'position:fixed', 'left:12px', 'right:12px', 'bottom:12px', 'z-index:9999',
      'border-radius:14px', 'box-shadow:0 8px 30px rgba(0,0,0,.18)',
      'padding:14px 16px', 'font-size:14px', 'line-height:1.6',
      'display:flex', 'align-items:center', 'gap:12px',
      'max-width:520px', 'margin:0 auto'
    ].join(';');

    const content = document.createElement('div');
    content.style.flex = '1';
    // 內容為自控的 i18n 字串，非使用者輸入；仍用 DOMPurify 保持與專案其他 innerHTML 一致。
    // DOMPurify 不可用（離線/被封鎖）時不回退為原始 HTML，改去標籤純文字降級（L7）。
    if (typeof DOMPurify !== 'undefined') content.innerHTML = DOMPurify.sanitize(html);
    else content.textContent = html.replace(/<[^>]*>/g, '');

    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:8px;align-items:center;flex-shrink:0';

    if (opts.actionLabel) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pwa-banner-action';
      btn.textContent = opts.actionLabel;
      // U-L1：min-height 44px，符合觸控面積下限
      btn.style.cssText = 'border:none;border-radius:10px;padding:8px 14px;min-height:44px;font-weight:700;font-size:14px;cursor:pointer';
      btn.onclick = () => { if (opts.onAction) opts.onAction(); };
      actions.appendChild(btn);
    }

    // U-L9：「稍後再說」取代原本「關掉就永遠不再出現」。文字按鈕，語意明確。
    const later = document.createElement('button');
    later.type = 'button';
    later.className = 'pwa-banner-later';
    later.textContent = tr('PWA_LATER', '稍後再說');
    later.style.cssText = 'border-radius:10px;padding:8px 12px;min-height:44px;font-size:14px;cursor:pointer';
    later.onclick = () => { dismissBanner(); if (opts.onDismiss) opts.onDismiss(); };
    actions.appendChild(later);

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'pwa-banner-close';
    close.setAttribute('aria-label', tr('PWA_LATER', '稍後再說'));
    close.textContent = '✕';
    close.style.cssText = 'background:transparent;border:none;font-size:16px;cursor:pointer;padding:4px 6px;min-width:44px;min-height:44px';
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

  // ---- U-L9：靜音策略 ----
  // 舊行為：關閉一次就寫 pwaInstallHintDismissed='1'，此後永久不再出現，
  // 使用者換手機／後來想裝也沒有第二次機會。改成「稍後再說 = 7 天內不再提示」。
  const SNOOZE_KEY = 'pwaInstallHintSnoozedUntil';
  const LEGACY_DISMISS_KEY = 'pwaInstallHintDismissed'; // 舊鍵，只做一次性遷移
  const SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;

  function hintDismissed() {
    try {
      // 舊使用者若曾永久關閉，遷移成一次 7 天 snooze，之後就回到正常節奏
      if (localStorage.getItem(LEGACY_DISMISS_KEY) === '1') {
        localStorage.removeItem(LEGACY_DISMISS_KEY);
        rememberDismiss();
      }
      const until = Number(localStorage.getItem(SNOOZE_KEY) || 0);
      return Number.isFinite(until) && Date.now() < until;
    } catch (_) { return false; }
  }
  function rememberDismiss() {
    try { localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_MS)); } catch (_) { /* ignore */ }
  }

  // ---- U-L9：提示的前置條件 = 已登入 + 至少成功打卡過一次 ----
  // 原本 iOS 是「頁面載入 1.5 秒」、Android 是「beforeinstallprompt 一到就跳」，
  // 兩者都可能在登入畫面就打斷使用者；新進員工第一次開這個網址就被要求「加入主畫面」，
  // 根本還不知道這是什麼。改成等他真的用過一次核心功能再提。
  const PUNCHED_KEY = 'pwaPunchedOnce';
  function isLoggedIn() {
    try { return !!localStorage.getItem('sessionToken'); } catch (_) { return false; }
  }
  function hasPunchedBefore() {
    try { return localStorage.getItem(PUNCHED_KEY) === '1'; } catch (_) { return false; }
  }
  function markPunched() {
    try { localStorage.setItem(PUNCHED_KEY, '1'); } catch (_) { /* ignore */ }
  }
  function canPrompt() {
    return !isStandalone() && !hintDismissed() && isLoggedIn() && hasPunchedBefore();
  }

  // ---- 2. Android：攔下 beforeinstallprompt，但先不顯示 ----
  let deferredPrompt = null;
  function setupAndroidInstall() {
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();        // 阻止瀏覽器預設小橫幅，改由我們控制時機
      deferredPrompt = e;
      // U-L9：不再「一收到就跳」，改交給 maybeShowInstallPrompt() 判斷時機
      maybeShowInstallPrompt();
    });

    window.addEventListener('appinstalled', () => {
      deferredPrompt = null;
      dismissBanner();
      debugLog('✓ PWA 已安裝');
    });
  }

  // ---- 3. 顯示安裝／加入主畫面提示（Android 與 iOS 共用同一道時機判斷）----
  let promptShown = false;
  function maybeShowInstallPrompt() {
    if (promptShown || !canPrompt()) return;

    // Android（有 beforeinstallprompt）：帶「安裝」按鈕，一鍵叫起系統安裝流程
    if (deferredPrompt) {
      promptShown = true;
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
          onDismiss: () => { rememberDismiss(); promptShown = false; }
        }
      );
      return;
    }

    // iOS Safari：沒有 beforeinstallprompt，只能給圖文步驟
    if (isIOSSafari) {
      promptShown = true;
      showBanner(
        tr(
          'PWA_IOS_INSTALL_HINT',
          '想要全螢幕 App 體驗？點下方工具列的「分享」<span style="display:inline-block;border:1px solid #cbd5e1;border-radius:4px;padding:0 5px;margin:0 2px">􀈂</span>，再選「加入主畫面」。建議直接從主畫面 App 內登入。'
        ),
        { onDismiss: () => { rememberDismiss(); promptShown = false; } }
      );
    }
  }

  // ---- U-L9：觸發點 ----
  // js/app.js 在 doPunch() 成功（今日紀錄多一筆）後發出 attendance:punch-success。
  // 第一次打卡成功後延遲 2.5 秒再提示，讓成功 toast 先講完話。
  function setupInstallTriggers() {
    window.addEventListener('attendance:punch-success', () => {
      markPunched();
      setTimeout(maybeShowInstallPrompt, 2500);
    });
    // 之後每次回訪：已登入且過去打過卡，載入穩定後再提一次（除非還在 snooze 期間）
    window.addEventListener('load', () => {
      setTimeout(maybeShowInstallPrompt, 3000);
    });
  }

  // 初始化
  markStandalone();
  registerSW();
  setupAndroidInstall();
  setupInstallTriggers();
})();
