// ==UserScript==
// @name         YouTube Scroll Miniplayer
// @namespace    Citizen.youtube.scroll-miniplayer
// @version      5.21
// @description  Floats the active YouTube player with compact queue context, YouTube-style controls, and synchronised corner selection across open windows.
// @author       Citizen
// @homepageURL  https://github.com/noswimmingplease/youtube-scroll-miniplayer
// @supportURL   https://github.com/noswimmingplease/youtube-scroll-miniplayer/issues
// @updateURL    https://raw.githubusercontent.com/noswimmingplease/youtube-scroll-miniplayer/main/youtube-scroll-miniplayer.user.js
// @downloadURL  https://raw.githubusercontent.com/noswimmingplease/youtube-scroll-miniplayer/main/youtube-scroll-miniplayer.user.js
// @match        https://www.youtube.com/*
// @run-at       document-idle
// @grant        none
// @noframes
// ==/UserScript==

(() => {
  "use strict";

  const CONFIG = {
    enabled: true,
    sizeMode: "dynamic", // "dynamic", "fixed", or "column"
    width: 720,
    portraitWidth: 480,
    minWidth: 320,
    maxWidth: 800,
    portraitMaxWidth: 560,
    maxViewportWidthRatio: 0.38,
    minDynamicWidth: 320,
    aspectRatio: 16 / 9,
    edgeOffsetPx: 16,
    mastheadGapPx: 12,
    triggerOffsetPx: 0,
    position: "top-right",
    showCompactQueueInfo: true,
    enterTransitionMs: 70,
    exitTransitionMs: 0,
  };

  const STYLE_ID = "ytsmp-style";
  const ACTIVE_CLASS = "ytsmp-scroll-miniplayer-active";
  const EXITING_CLASS = "ytsmp-scroll-miniplayer-exiting";
  const CLOSE_BUTTON_ID = "ytsmp-close-button";
  const CORNER_CONTROL_ID = "ytsmp-corner-control";
  const CORNER_BUTTON_ID = "ytsmp-corner-button";
  const CORNER_MENU_ID = "ytsmp-corner-menu";
  const CORNER_OPTION_CLASS = "ytsmp-corner-option";
  const CORNER_STORAGE_KEY = "yt-master-suite.scroll-miniplayer.corner.v1";
  const VALID_CORNERS = Object.freeze([
    "top-right",
    "bottom-right",
    "bottom-left",
    "top-left",
  ]);
  const CORNER_LABELS = Object.freeze({
    "top-right": "top right",
    "bottom-right": "bottom right",
    "bottom-left": "bottom left",
    "top-left": "top left",
  });
  const CORNER_ICON_ROTATIONS = Object.freeze({
    "top-right": 0,
    "bottom-right": 90,
    "bottom-left": 180,
    "top-left": 270,
  });
  const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
  const CLOSE_ICON_PATH =
    "M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z";
  const MOVE_ICON_PATH =
    "M10 9h4V6h3l-5-5-5 5h3v3z M9 10H6V7l-5 5 5 5v-3h3v-4z M15 10h3V7l5 5-5 5v-3h-3v-4z M14 15h-4v3H7l5 5 5-5h-3v-3z";
  const CORNER_ICON_PATH =
    "M9 5v2h6.59L5 17.59 6.41 19 17 8.41V15h2V5z";
  const QUEUE_INFO_ID = "ytsmp-compact-queue-info";
  const PLACEHOLDER_ID = "ytsmp-player-placeholder";
  const PLAYER_RECOVERY_HOST_ID = "ytsmp-player-recovery-host";
  const WATCH_PATHS = ["/watch", "/live/"];
  const WATCH_ROOT_SELECTOR = "ytd-watch-flexy";
  const TRIGGER_ANCHOR_SELECTOR = "#single-column-container";
  const PLAYER_VIEWPORT_ANCHOR_SELECTORS = [
    "#player-container-outer",
    "#player-container",
    "#player",
    "ytd-player",
  ];
  const MOVIE_PLAYER_ID = "movie_player";
  const MOVIE_PLAYER_SELECTOR = `#${MOVIE_PLAYER_ID}`;
  const HTML5_PLAYER_SELECTOR = ".html5-video-player";
  const PLAYER_HOST_SELECTOR = "ytd-player";
  const VIDEO_SELECTOR = "video";
  const MASTHEAD_SELECTOR = "ytd-masthead";
  const NATIVE_MINIPLAYER_SELECTOR = "ytd-miniplayer";
  const QUEUE_PANEL_SELECTOR = [
    "ytd-playlist-panel-renderer",
    "yt-playlist-panel-renderer",
  ].join(",");
  const QUEUE_ITEM_SELECTOR = [
    "ytd-playlist-panel-video-renderer",
    "yt-playlist-panel-video-renderer",
  ].join(",");
  const QUEUE_INDEX_SELECTOR = [
    "#publisher-container #index-message",
    "#header-description #index-message",
    "#index-message",
  ].join(",");
  const QUEUE_ITEM_TITLE_SELECTOR = "#video-title";
  const QUEUE_ITEM_TITLE_FALLBACK_SELECTOR = ".yt-core-attributed-string";
  const WATCH_TITLE_SELECTOR = [
    "ytd-watch-metadata h1 yt-formatted-string",
    "ytd-watch-metadata h1 .yt-core-attributed-string",
    "#title h1 yt-formatted-string",
  ].join(",");
  const DIRECT_BOX_CLASS = "box";
  const SINGLE_COLUMN_BOX_SELECTOR = `${TRIGGER_ANCHOR_SELECTOR} > .box`;
  const FILLED_COLUMN_BOX_SELECTOR = ".box.ytd-watch-flexy, #columns .box";
  const COLUMNS_SELECTOR = "#columns";
  const BODY_BOX_VAR_NAMES = [
    "--ytsmp-width",
    "--ytsmp-height",
    "--ytsmp-top",
    "--ytsmp-bottom",
    "--ytsmp-left",
    "--ytsmp-right",
  ];
  const QUEUE_VISIBILITY_STATE_ATTRIBUTES = [
    "aria-hidden",
    "class",
    "hidden",
    "style",
  ];
  const QUEUE_PANEL_STATE_ATTRIBUTES = [
    "aria-current",
    "aria-selected",
    "selected",
    ...QUEUE_VISIBILITY_STATE_ATTRIBUTES,
  ];
  const NAVIGATION_RECOVERY_CHECK_DELAYS_MS = [1500, 5000, 10000];
  const NAVIGATION_RECOVERY_HARD_CAP_MS = 20000;
  const PLAYER_RESTORE_RETRY_DELAYS_MS = [50, 250, 1000, 3000, 8000, 15000];
  const PLAYER_ORPHAN_FINALISE_GRACE_MS = 20000;

  let scrollSyncFrame = 0;
  let routeSyncFrame = 0;
  let queueInfoSyncFrame = 0;
  let fadeOutTimer = 0;
  let navigationStartUrl = "";
  let navigationStartPlayerVideoId = "";
  let suppressedUntilVisible = false;
  let navigationInProgress = false;
  let navigationFinishPending = false;
  let mutationObserverActive = false;
  let playerAdoptionObserverActive = false;
  let playerAdoptionObserverTarget = null;
  let playerOrphanFinaliseTimer = 0;
  const navigationRecoveryTimers = new Set();
  const queuePanelObservers = new Map();
  const playerRestoreRetryTimers = new Set();
  let floatedPlayer = null;
  let playerPlaceholder = null;
  let restoreParent = null;
  let restoreNextSibling = null;
  let currentCorner = readStoredCorner();

  function isValidCorner(value) {
    return VALID_CORNERS.includes(value);
  }

  function readStoredCorner() {
    const defaultCorner = isValidCorner(CONFIG.position)
      ? CONFIG.position
      : "top-right";

    try {
      const storedCorner = localStorage.getItem(CORNER_STORAGE_KEY);
      return isValidCorner(storedCorner) ? storedCorner : defaultCorner;
    } catch {
      return defaultCorner;
    }
  }

  function persistCorner(corner) {
    if (!isValidCorner(corner)) return false;

    try {
      localStorage.setItem(CORNER_STORAGE_KEY, corner);
      return true;
    } catch {
      return false;
    }
  }

  function isEligiblePath() {
    return location.pathname === WATCH_PATHS[0] || location.pathname.startsWith(WATCH_PATHS[1]);
  }

  function queryFirst(selectors, root = document) {
    for (const selector of selectors) {
      const el = root.querySelector(selector);
      if (el) return el;
    }
    return null;
  }

  function isBodyActive() {
    return Boolean(document.body && document.body.classList.contains(ACTIVE_CLASS));
  }

  function isBodyFloating() {
    return Boolean(
      document.body &&
      (
        document.body.classList.contains(ACTIVE_CLASS) ||
        document.body.classList.contains(EXITING_CLASS)
      )
    );
  }

  function isRenderedWatchRoot(root) {
    if (
      !root?.isConnected ||
      root.hidden ||
      root.getAttribute("aria-hidden") === "true"
    ) {
      return false;
    }

    try {
      const style = getComputedStyle(root);
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        style.visibility === "collapse"
      ) {
        return false;
      }
    } catch {
      return false;
    }

    return (
      typeof root.getClientRects !== "function" ||
      root.getClientRects().length > 0
    );
  }

  function getWatchRoot() {
    const playerRoot = document
      .querySelector(`#${MOVIE_PLAYER_ID}`)
      ?.closest?.(WATCH_ROOT_SELECTOR);
    if (playerRoot?.isConnected) return playerRoot;

    const placeholderRoot = document
      .querySelector(`#${PLACEHOLDER_ID}`)
      ?.closest?.(WATCH_ROOT_SELECTOR);
    if (placeholderRoot?.isConnected) return placeholderRoot;

    const roots = Array.from(document.querySelectorAll(WATCH_ROOT_SELECTOR));
    return (
      roots.find(isRenderedWatchRoot) ||
      roots.find((root) => root.isConnected) ||
      null
    );
  }

  function getTriggerAnchor() {
    const watchRoot = getWatchRoot();
    if (!watchRoot) return null;

    return watchRoot.querySelector(TRIGGER_ANCHOR_SELECTOR);
  }

  function getPlayerViewportAnchor() {
    if (playerPlaceholder && document.documentElement.contains(playerPlaceholder)) return playerPlaceholder;

    const watchRoot = getWatchRoot();
    if (!watchRoot) return null;

    return queryFirst(PLAYER_VIEWPORT_ANCHOR_SELECTORS, watchRoot);
  }

  function isUsableBox(el) {
    if (!el) return false;

    const rect = el.getBoundingClientRect();
    return rect.width > 240 && rect.height > 40;
  }

  function getFilledColumnBox() {
    const watchRoot = getWatchRoot();
    if (!watchRoot) return null;

    const directBox = Array.from(watchRoot.children)
      .find((el) => el.classList && el.classList.contains(DIRECT_BOX_CLASS));
    if (isUsableBox(directBox)) return directBox;

    const singleColumnBox = watchRoot.querySelector(SINGLE_COLUMN_BOX_SELECTOR);
    if (isUsableBox(singleColumnBox)) return singleColumnBox;

    return Array.from(watchRoot.querySelectorAll(FILLED_COLUMN_BOX_SELECTOR))
      .find(isUsableBox) || null;
  }

  function getRemainingColumnBox() {
    const watchRoot = getWatchRoot();
    if (!watchRoot) return null;

    const columns = watchRoot.querySelector(COLUMNS_SELECTOR);
    const filledBox = getFilledColumnBox();
    if (!columns || !filledBox) return null;

    const columnsRect = columns.getBoundingClientRect();
    const filledRect = filledBox.getBoundingClientRect();
    const right = Math.min(columnsRect.right, innerWidth);
    const left = Math.max(columnsRect.left, filledRect.right);
    const width = Math.floor(right - left);

    if (width < CONFIG.minDynamicWidth) return null;

    return {
      width,
      right: Math.max(0, Math.round(innerWidth - right)),
    };
  }

  function getWatchHostPlayer(excludedPlayer = null) {
    const watchRoot = getWatchRoot();
    if (!watchRoot?.isConnected) return null;

    const candidates = [
      ...watchRoot.querySelectorAll(MOVIE_PLAYER_SELECTOR),
      ...watchRoot.querySelectorAll(HTML5_PLAYER_SELECTOR),
    ].filter(
      (player) => player.isConnected && player !== excludedPlayer,
    );
    const uniqueCandidates = Array.from(new Set(candidates));
    const urlVideoId = getVideoIdFromUrl(location.href);
    if (urlVideoId) {
      const exactCandidate = uniqueCandidates.find(
        (player) => getPlayerVideoIdFromPlayer(player) === urlVideoId,
      );
      if (exactCandidate) return exactCandidate;
    }

    return uniqueCandidates[0] || null;
  }

  function getPlayer() {
    const hostedPlayer = getWatchHostPlayer();

    return (
      hostedPlayer ||
      (floatedPlayer && document.documentElement.contains(floatedPlayer) ? floatedPlayer : null) ||
      document.getElementById(MOVIE_PLAYER_ID) ||
      document.querySelector(HTML5_PLAYER_SELECTOR)
    );
  }

  function getPlayerVideo() {
    const player = getPlayer();
    return player ? player.querySelector(VIDEO_SELECTOR) : null;
  }

  function getPlayerVideoIdFromPlayer(player) {
    try {
      return normaliseText(player?.getVideoData?.()?.video_id);
    } catch {
      return "";
    }
  }

  function getPlayerVideoId() {
    return getPlayerVideoIdFromPlayer(getPlayer());
  }

  function clearNavigationRecoveryTimers() {
    navigationRecoveryTimers.forEach((timerId) => clearTimeout(timerId));
    navigationRecoveryTimers.clear();
  }

  function navigationHasSettledOrCancelled(allowUnchangedIdentity = false) {
    if (!isEligiblePath()) return true;

    const urlVideoId = getVideoIdFromUrl(location.href);
    const playerVideoId = getPlayerVideoId();
    if (urlVideoId && playerVideoId) {
      return urlVideoId === playerVideoId;
    }

    return allowUnchangedIdentity && (
      location.href === navigationStartUrl &&
      playerVideoId === navigationStartPlayerVideoId
    );
  }

  function finishNavigationLock() {
    clearNavigationRecoveryTimers();
    navigationStartUrl = "";
    navigationStartPlayerVideoId = "";
    navigationInProgress = false;
    navigationFinishPending = false;
    suppressedUntilVisible = false;
    scheduleRouteSync();
  }

  function finishNavigationLockIfSettled() {
    if (!navigationInProgress) {
      navigationFinishPending = false;
      scheduleRouteSync();
      return true;
    }

    if (!navigationHasSettledOrCancelled()) return false;
    finishNavigationLock();
    return true;
  }

  function scheduleNavigationRecoveryCheck(
    delay,
    { allowUnchangedIdentity = false, hardCap = false } = {},
  ) {
    const timerId = setTimeout(() => {
      navigationRecoveryTimers.delete(timerId);
      if (!navigationInProgress) return;

      if (
        hardCap ||
        navigationHasSettledOrCancelled(allowUnchangedIdentity)
      ) {
        finishNavigationLock();
      }
    }, delay);
    navigationRecoveryTimers.add(timerId);
  }

  function beginNavigationLock() {
    clearNavigationRecoveryTimers();
    clearPlayerOrphanFinaliseTimer();
    navigationStartUrl = location.href;
    navigationStartPlayerVideoId = getPlayerVideoId();
    navigationInProgress = true;
    navigationFinishPending = false;
    NAVIGATION_RECOVERY_CHECK_DELAYS_MS.forEach((delay, index, delays) => {
      scheduleNavigationRecoveryCheck(delay, {
        allowUnchangedIdentity: index === delays.length - 1,
      });
    });
    scheduleNavigationRecoveryCheck(NAVIGATION_RECOVERY_HARD_CAP_MS, {
      hardCap: true,
    });
  }

  function getMastheadHeight() {
    const masthead = document.querySelector(MASTHEAD_SELECTOR);
    const rect = masthead ? masthead.getBoundingClientRect() : null;
    return rect && rect.height > 0 ? rect.height : 56;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function isFullscreen() {
    const watchRoot = getWatchRoot();
    const player = getPlayer();

    return Boolean(
      document.fullscreenElement ||
      (watchRoot && watchRoot.hasAttribute("fullscreen")) ||
      (player && player.classList.contains("ytp-fullscreen"))
    );
  }

  function isNativeMiniplayerVisible() {
    const miniplayer = document.querySelector(NATIVE_MINIPLAYER_SELECTOR);
    if (!miniplayer) return false;
    if (miniplayer.hidden || miniplayer.hasAttribute("hidden") || miniplayer.getAttribute("aria-hidden") === "true") return false;

    const style = getComputedStyle(miniplayer);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;

    const rect = miniplayer.getBoundingClientRect();
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      rect.bottom > 0 &&
      rect.right > 0 &&
      rect.top < innerHeight &&
      rect.left < innerWidth
    );
  }

  function canFloatPlayer() {
    if (!CONFIG.enabled || !isEligiblePath() || isFullscreen() || isNativeMiniplayerVisible()) return false;

    const video = getPlayerVideo();
    if (!video || video.ended) return false;

    const player = getPlayer();
    return Boolean(player && !player.classList.contains("ended-mode"));
  }

  function buildCss() {
    const defaultHeight = Math.round(CONFIG.width / CONFIG.aspectRatio);

    return `
      body.${ACTIVE_CLASS} ${MOVIE_PLAYER_SELECTOR}:not(.ytp-fullscreen),
      body.${EXITING_CLASS} ${MOVIE_PLAYER_SELECTOR}:not(.ytp-fullscreen) {
        position: fixed !important;
        top: var(--ytsmp-top, 68px) !important;
        right: var(--ytsmp-right, auto) !important;
        bottom: var(--ytsmp-bottom, auto) !important;
        left: var(--ytsmp-left, 16px) !important;
        z-index: 2147483647 !important;
        width: var(--ytsmp-width, ${CONFIG.width}px) !important;
        height: var(--ytsmp-height, ${defaultHeight}px) !important;
        min-width: 0 !important;
        min-height: 0 !important;
        margin: 0 !important;
        border-radius: 8px !important;
        overflow: hidden !important;
        background: #000 !important;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.55) !important;
        transition:
          opacity ${CONFIG.enterTransitionMs}ms ease-out,
          transform ${CONFIG.enterTransitionMs}ms ease-out !important;
      }

      body.${ACTIVE_CLASS} ${MOVIE_PLAYER_SELECTOR}:not(.ytp-fullscreen) {
        opacity: 1 !important;
        transform: translateZ(0) scale(1) !important;
      }

      body.${EXITING_CLASS} ${MOVIE_PLAYER_SELECTOR}:not(.ytp-fullscreen) {
        opacity: 0 !important;
        pointer-events: none !important;
        transform: translateZ(0) scale(0.985) !important;
      }

      body.${ACTIVE_CLASS} ${MOVIE_PLAYER_SELECTOR}:not(.ytp-fullscreen) video.html5-main-video,
      body.${ACTIVE_CLASS} ${MOVIE_PLAYER_SELECTOR}:not(.ytp-fullscreen) .ytp-iv-video-content,
      body.${EXITING_CLASS} ${MOVIE_PLAYER_SELECTOR}:not(.ytp-fullscreen) video.html5-main-video,
      body.${EXITING_CLASS} ${MOVIE_PLAYER_SELECTOR}:not(.ytp-fullscreen) .ytp-iv-video-content {
        top: 0 !important;
        left: 0 !important;
        width: var(--ytsmp-width, ${CONFIG.width}px) !important;
        height: var(--ytsmp-height, ${defaultHeight}px) !important;
        margin-left: 0 !important;
      }

      body.${ACTIVE_CLASS} ${MOVIE_PLAYER_SELECTOR}:not(.ytp-fullscreen) .ytp-chrome-bottom {
        left: 12px !important;
        width: calc(100% - 24px) !important;
      }

      body.${ACTIVE_CLASS} ${MOVIE_PLAYER_SELECTOR}:not(.ytp-fullscreen) .ytp-gradient-bottom {
        height: 96px !important;
      }

      body.${ACTIVE_CLASS} ${MOVIE_PLAYER_SELECTOR}:not(.ytp-fullscreen) .ytp-ce-element,
      body.${ACTIVE_CLASS} ${MOVIE_PLAYER_SELECTOR}:not(.ytp-fullscreen) .ytp-paid-content-overlay {
        display: none !important;
      }

      body.${ACTIVE_CLASS} ${MOVIE_PLAYER_SELECTOR}:not(.ytp-fullscreen) .ytp-playlist-menu,
      body.${ACTIVE_CLASS} ${MOVIE_PLAYER_SELECTOR}:not(.ytp-fullscreen) .ytp-queue-menu,
      body.${EXITING_CLASS} ${MOVIE_PLAYER_SELECTOR}:not(.ytp-fullscreen) .ytp-playlist-menu,
      body.${EXITING_CLASS} ${MOVIE_PLAYER_SELECTOR}:not(.ytp-fullscreen) .ytp-queue-menu {
        display: none !important;
        opacity: 0 !important;
        pointer-events: none !important;
      }

      #${CLOSE_BUTTON_ID},
      #${CORNER_CONTROL_ID} {
        display: none !important;
      }

      body.${ACTIVE_CLASS} ${MOVIE_PLAYER_SELECTOR}:not(.ytp-fullscreen) #${CLOSE_BUTTON_ID},
      body.${ACTIVE_CLASS} ${MOVIE_PLAYER_SELECTOR}:not(.ytp-fullscreen) #${CORNER_BUTTON_ID},
      body.${ACTIVE_CLASS} ${MOVIE_PLAYER_SELECTOR}:not(.ytp-fullscreen) .${CORNER_OPTION_CLASS} {
        appearance: none !important;
        align-items: center !important;
        background: rgba(0, 0, 0, 0.72) !important;
        border: 0 !important;
        border-radius: 999px !important;
        box-sizing: border-box !important;
        box-shadow: 0 1px 2px rgba(0, 0, 0, 0.65) !important;
        color: #fff !important;
        cursor: pointer !important;
        display: flex !important;
        flex: 0 0 28px !important;
        height: 28px !important;
        justify-content: center !important;
        padding: 0 !important;
        position: relative !important;
        transition: background-color 100ms ease-out, transform 80ms ease-out !important;
        width: 28px !important;
        z-index: 2147483647 !important;
      }

      body.${ACTIVE_CLASS} ${MOVIE_PLAYER_SELECTOR}:not(.ytp-fullscreen) #${CLOSE_BUTTON_ID} svg,
      body.${ACTIVE_CLASS} ${MOVIE_PLAYER_SELECTOR}:not(.ytp-fullscreen) #${CORNER_BUTTON_ID} svg,
      body.${ACTIVE_CLASS} ${MOVIE_PLAYER_SELECTOR}:not(.ytp-fullscreen) .${CORNER_OPTION_CLASS} svg {
        display: block !important;
        fill: currentColor !important;
        height: 18px !important;
        pointer-events: none !important;
        width: 18px !important;
      }

      body.${ACTIVE_CLASS} ${MOVIE_PLAYER_SELECTOR}:not(.ytp-fullscreen) #${CLOSE_BUTTON_ID} {
        opacity: 0 !important;
        position: absolute !important;
        right: 8px !important;
        top: 8px !important;
        transition: background-color 100ms ease-out, opacity 120ms ease-out, transform 80ms ease-out !important;
      }

      body.${ACTIVE_CLASS} ${MOVIE_PLAYER_SELECTOR}:not(.ytp-fullscreen) #${CORNER_CONTROL_ID} {
        align-items: center !important;
        display: flex !important;
        flex-direction: row-reverse !important;
        gap: 4px !important;
        opacity: 0 !important;
        position: absolute !important;
        right: 44px !important;
        top: 8px !important;
        transition: opacity 120ms ease-out !important;
        z-index: 2147483647 !important;
      }

      body.${ACTIVE_CLASS} ${MOVIE_PLAYER_SELECTOR}:not(.ytp-fullscreen) #${CORNER_MENU_ID} {
        align-items: center !important;
        display: flex !important;
        gap: 4px !important;
        max-width: 0 !important;
        opacity: 0 !important;
        overflow: hidden !important;
        pointer-events: none !important;
        transform: translateX(4px) !important;
        transition: max-width 120ms ease-out, opacity 100ms ease-out, transform 120ms ease-out, visibility 0s linear 120ms !important;
        visibility: hidden !important;
      }

      body.${ACTIVE_CLASS} ${MOVIE_PLAYER_SELECTOR}:not(.ytp-fullscreen) #${CORNER_CONTROL_ID}[data-open="1"] #${CORNER_MENU_ID} {
        max-width: 92px !important;
        opacity: 1 !important;
        pointer-events: auto !important;
        transform: translateX(0) !important;
        transition-delay: 0s !important;
        visibility: visible !important;
      }

      body.${ACTIVE_CLASS} ${MOVIE_PLAYER_SELECTOR}:not(.ytp-fullscreen):hover #${CLOSE_BUTTON_ID},
      body.${ACTIVE_CLASS} ${MOVIE_PLAYER_SELECTOR}:not(.ytp-fullscreen):hover #${CORNER_CONTROL_ID},
      body.${ACTIVE_CLASS} ${MOVIE_PLAYER_SELECTOR}:not(.ytp-fullscreen) #${CLOSE_BUTTON_ID}:focus-visible,
      body.${ACTIVE_CLASS} ${MOVIE_PLAYER_SELECTOR}:not(.ytp-fullscreen) #${CORNER_CONTROL_ID}:focus-within {
        opacity: 1 !important;
      }

      body.${ACTIVE_CLASS} ${MOVIE_PLAYER_SELECTOR}:not(.ytp-fullscreen) #${CLOSE_BUTTON_ID}:hover,
      body.${ACTIVE_CLASS} ${MOVIE_PLAYER_SELECTOR}:not(.ytp-fullscreen) #${CORNER_BUTTON_ID}:hover,
      body.${ACTIVE_CLASS} ${MOVIE_PLAYER_SELECTOR}:not(.ytp-fullscreen) .${CORNER_OPTION_CLASS}:hover {
        background: rgba(0, 0, 0, 0.9) !important;
      }

      body.${ACTIVE_CLASS} ${MOVIE_PLAYER_SELECTOR}:not(.ytp-fullscreen) #${CLOSE_BUTTON_ID}:active,
      body.${ACTIVE_CLASS} ${MOVIE_PLAYER_SELECTOR}:not(.ytp-fullscreen) #${CORNER_BUTTON_ID}:active,
      body.${ACTIVE_CLASS} ${MOVIE_PLAYER_SELECTOR}:not(.ytp-fullscreen) .${CORNER_OPTION_CLASS}:active {
        transform: scale(0.92) !important;
      }

      body.${ACTIVE_CLASS} ${MOVIE_PLAYER_SELECTOR}:not(.ytp-fullscreen) #${CLOSE_BUTTON_ID}:focus-visible,
      body.${ACTIVE_CLASS} ${MOVIE_PLAYER_SELECTOR}:not(.ytp-fullscreen) #${CORNER_BUTTON_ID}:focus-visible,
      body.${ACTIVE_CLASS} ${MOVIE_PLAYER_SELECTOR}:not(.ytp-fullscreen) .${CORNER_OPTION_CLASS}:focus-visible {
        outline: 2px solid #fff !important;
        outline-offset: 2px !important;
      }

      #${QUEUE_INFO_ID} {
        display: none !important;
      }

      body.${ACTIVE_CLASS} ${MOVIE_PLAYER_SELECTOR}:not(.ytp-fullscreen) #${QUEUE_INFO_ID} {
        align-items: center !important;
        background: rgba(18, 18, 18, 0.88) !important;
        border-radius: 6px !important;
        bottom: 48px !important;
        box-sizing: border-box !important;
        color: #fff !important;
        display: flex !important;
        font: 500 12px/1.2 Arial, Helvetica, sans-serif !important;
        gap: 8px !important;
        left: 12px !important;
        max-width: calc(100% - 68px) !important;
        min-height: 30px !important;
        padding: 6px 9px !important;
        pointer-events: none !important;
        position: absolute !important;
        right: 44px !important;
        z-index: 70 !important;
      }

      #${QUEUE_INFO_ID} .ytsmp-queue-position {
        color: #aaa !important;
        flex: 0 0 auto !important;
        font-weight: 700 !important;
        white-space: nowrap !important;
      }

      #${QUEUE_INFO_ID} .ytsmp-queue-title {
        min-width: 0 !important;
        overflow: hidden !important;
        text-overflow: ellipsis !important;
        white-space: nowrap !important;
      }
    `;
  }

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = buildCss();

    (document.head || document.documentElement).appendChild(style);
  }

  function setBodyBoxVars() {
    const body = document.body;
    if (!body) return;

    const remainingColumnBox = currentCorner.endsWith("right")
      ? getRemainingColumnBox()
      : null;
    const availableWidth = Math.max(160, innerWidth - CONFIG.edgeOffsetPx * 2);
    const availableHeight = Math.max(90, innerHeight - getMastheadHeight() - CONFIG.mastheadGapPx - CONFIG.edgeOffsetPx);
    const isPortraitViewport = innerHeight > innerWidth;
    let width;

    if (CONFIG.sizeMode === "fixed") {
      width = Math.min(CONFIG.width, availableWidth);
    } else if (CONFIG.sizeMode === "column") {
      width = Math.min(remainingColumnBox ? remainingColumnBox.width : CONFIG.width, availableWidth);
    } else {
      const preferredWidth = isPortraitViewport ? CONFIG.portraitWidth : CONFIG.width;
      const configuredMaxWidth = isPortraitViewport ? CONFIG.portraitMaxWidth : CONFIG.maxWidth;
      const viewportMaxWidth = Math.floor(innerWidth * CONFIG.maxViewportWidthRatio);
      const heightMaxWidth = Math.floor(availableHeight * CONFIG.aspectRatio);
      const maxWidth = Math.max(160, Math.min(configuredMaxWidth, viewportMaxWidth, heightMaxWidth, availableWidth));
      const minWidth = Math.min(CONFIG.minWidth, maxWidth);
      width = clamp(preferredWidth, minWidth, maxWidth);
    }

    let height = Math.round(width / CONFIG.aspectRatio);

    if (height > availableHeight) {
      height = availableHeight;
      width = Math.round(height * CONFIG.aspectRatio);
    }

    const top = getMastheadHeight() + CONFIG.mastheadGapPx;
    const bottom = CONFIG.edgeOffsetPx;
    const edge = CONFIG.edgeOffsetPx;
    const vertical = currentCorner.startsWith("bottom") ? "bottom" : "top";
    const horizontal = currentCorner.endsWith("right") ? "right" : "left";
    const right = remainingColumnBox ? remainingColumnBox.right : edge;

    body.style.setProperty("--ytsmp-width", `${width}px`);
    body.style.setProperty("--ytsmp-height", `${height}px`);
    body.style.setProperty("--ytsmp-top", vertical === "top" ? `${top}px` : "auto");
    body.style.setProperty("--ytsmp-bottom", vertical === "bottom" ? `${bottom}px` : "auto");
    body.style.setProperty("--ytsmp-left", horizontal === "left" ? `${edge}px` : "auto");
    body.style.setProperty("--ytsmp-right", horizontal === "right" ? `${right}px` : "auto");
  }

  function clearBodyBoxVars() {
    const body = document.body;
    if (!body) return;

    BODY_BOX_VAR_NAMES.forEach((name) => body.style.removeProperty(name));
  }

  function ensurePlayerPlaceholder(player) {
    if (!player || !player.parentNode || playerPlaceholder) return;

    const playerRect = player.getBoundingClientRect();
    const parentRect = player.parentElement ? player.parentElement.getBoundingClientRect() : null;
    const height = Math.round(Math.max(playerRect.height, parentRect ? parentRect.height : 0));
    if (height <= 0) return;

    playerPlaceholder = document.createElement("div");
    playerPlaceholder.id = PLACEHOLDER_ID;
    playerPlaceholder.setAttribute("aria-hidden", "true");
    playerPlaceholder.style.setProperty("box-sizing", "border-box", "important");
    playerPlaceholder.style.setProperty("display", "block", "important");
    playerPlaceholder.style.setProperty("flex", `0 0 ${height}px`, "important");
    playerPlaceholder.style.setProperty("height", `${height}px`, "important");
    playerPlaceholder.style.setProperty("min-height", `${height}px`, "important");
    playerPlaceholder.style.setProperty("pointer-events", "none", "important");
    playerPlaceholder.style.setProperty("visibility", "hidden", "important");
    playerPlaceholder.style.setProperty("width", "100%", "important");
    player.parentNode.insertBefore(playerPlaceholder, player);
  }

  function removePlayerPlaceholder() {
    if (playerPlaceholder) {
      playerPlaceholder.remove();
      playerPlaceholder = null;
    }
  }

  function getPlayerRecoveryHost() {
    return document.getElementById(PLAYER_RECOVERY_HOST_ID);
  }

  function ensurePlayerRecoveryHost() {
    if (!document.body) return null;

    let host = getPlayerRecoveryHost();
    if (!host) {
      host = document.createElement("div");
      host.id = PLAYER_RECOVERY_HOST_ID;
      host.setAttribute("aria-hidden", "true");
      host.style.setProperty("contain", "strict", "important");
      host.style.setProperty("height", "1px", "important");
      host.style.setProperty("left", "-10000px", "important");
      host.style.setProperty("opacity", "0", "important");
      host.style.setProperty("overflow", "hidden", "important");
      host.style.setProperty("pointer-events", "none", "important");
      host.style.setProperty("position", "fixed", "important");
      host.style.setProperty("top", "0", "important");
      host.style.setProperty("width", "1px", "important");
    }
    if (!host.isConnected) document.body.appendChild(host);
    return host;
  }

  function removePlayerRecoveryHostIfEmpty() {
    const host = getPlayerRecoveryHost();
    if (host && !host.hasChildNodes()) host.remove();
  }

  function movePlayerToTopLevel(player) {
    clearPlayerRestoreRetries();
    clearPlayerOrphanFinaliseTimer();
    if (!player || !document.body) return false;

    if (
      floatedPlayer &&
      player !== floatedPlayer &&
      !reconcileTrackedPlayer()
    ) {
      return false;
    }
    if (player.parentElement === document.body) return player === floatedPlayer;

    if (!floatedPlayer) {
      floatedPlayer = player;
      restoreParent = player.parentNode;
      restoreNextSibling = player.nextSibling;
      ensurePlayerPlaceholder(player);
    }

    document.body.appendChild(player);
    removePlayerRecoveryHostIfEmpty();
    return player.parentElement === document.body;
  }

  function clearPlayerRestoreRetries() {
    playerRestoreRetryTimers.forEach((timerId) => clearTimeout(timerId));
    playerRestoreRetryTimers.clear();
  }

  function clearPlayerOrphanFinaliseTimer() {
    if (playerOrphanFinaliseTimer) {
      clearTimeout(playerOrphanFinaliseTimer);
      playerOrphanFinaliseTimer = 0;
    }
    stopPlayerAdoptionObservation();
  }

  function isPlayerAdoptedByConnectedHost(player) {
    if (!player?.isConnected || player.parentElement === document.body) {
      return false;
    }
    if (player.closest(`#${PLAYER_RECOVERY_HOST_ID}`)) return false;

    const nativeMiniplayer = player.closest(NATIVE_MINIPLAYER_SELECTOR);
    return Boolean(nativeMiniplayer?.isConnected || player.parentElement?.isConnected);
  }

  function finishPlayerRestore() {
    clearPlayerRestoreRetries();
    clearPlayerOrphanFinaliseTimer();
    removePlayerPlaceholder();
    removePlayerRecoveryHostIfEmpty();
    floatedPlayer = null;
    restoreParent = null;
    restoreNextSibling = null;
  }

  function getAuthoritativeReplacementPlayer() {
    if (!floatedPlayer) return null;

    const replacement = getWatchHostPlayer(floatedPlayer);
    const replacementVideo = replacement?.querySelector(VIDEO_SELECTOR);
    if (!replacement || !replacementVideo?.isConnected) return null;

    const urlVideoId = getVideoIdFromUrl(location.href);
    if (!urlVideoId) return null;

    const replacementVideoId = getPlayerVideoIdFromPlayer(replacement);
    if (replacementVideoId !== urlVideoId) return null;

    const oldPlayerIsDisposable =
      !floatedPlayer.isConnected ||
      floatedPlayer.parentElement === document.body ||
      Boolean(floatedPlayer.closest(`#${PLAYER_RECOVERY_HOST_ID}`));
    return oldPlayerIsDisposable ? replacement : null;
  }

  function recoverReplacedFloatedPlayer() {
    const obsoletePlayer = floatedPlayer;
    const replacement = getAuthoritativeReplacementPlayer();
    if (!obsoletePlayer || !replacement) return false;

    const resumeFloating = isBodyFloating() && !navigationInProgress;
    finishPlayerRestore();
    obsoletePlayer.remove();
    removePlayerRecoveryHostIfEmpty();

    if (!resumeFloating) return true;

    if (canFloatPlayer() && movePlayerToTopLevel(replacement)) {
      ensureCloseButton();
      ensureCornerButton();
      setBodyBoxVars();
      scheduleCompactQueueInfoSync();
      return true;
    }

    document.body?.classList.remove(ACTIVE_CLASS, EXITING_CLASS);
    clearBodyBoxVars();
    removeCloseButton();
    removeCornerButton();
    removeCompactQueueInfo();
    dispatchResize();
    scheduleScrollSync();
    return true;
  }

  function reconcileTrackedPlayer() {
    if (!floatedPlayer) return false;

    if (isPlayerAdoptedByConnectedHost(floatedPlayer)) {
      finishPlayerRestore();
      return true;
    }

    return recoverReplacedFloatedPlayer();
  }

  function getSafeRestoreParent(player) {
    const candidates = [];
    if (restoreParent) candidates.push(restoreParent);
    if (playerPlaceholder?.parentElement) {
      candidates.push(playerPlaceholder.parentElement);
    }

    const watchRoot = getWatchRoot();
    const fallbackPlayerHost = watchRoot?.querySelector(PLAYER_HOST_SELECTOR);
    const fallbackContainer = fallbackPlayerHost?.querySelector(":scope > #container");
    if (fallbackContainer) candidates.push(fallbackContainer);
    if (fallbackPlayerHost) candidates.push(fallbackPlayerHost);

    return candidates.find((candidate, index) => {
      if (
        !candidate?.isConnected ||
        candidate === document.body ||
        candidate === player ||
        player?.contains(candidate) ||
        candidates.indexOf(candidate) !== index
      ) {
        return false;
      }

      const existingPlayer = candidate.querySelector?.(
        `${MOVIE_PLAYER_SELECTOR}, ${HTML5_PLAYER_SELECTOR}`,
      );
      return !existingPlayer || existingPlayer === player;
    }) || null;
  }

  function canDiscardOffRouteOrphan(player) {
    const video = player?.querySelector(VIDEO_SELECTOR);
    if (!video) return true;
    if (video.ended || video.error) return true;

    const currentSource = normaliseText(video.currentSrc || video.src);
    return !currentSource;
  }

  function finaliseOffRouteOrphanIfSafe(candidate = floatedPlayer) {
    if (
      !candidate ||
      floatedPlayer !== candidate ||
      navigationInProgress ||
      isEligiblePath() ||
      isBodyFloating()
    ) {
      return false;
    }

    if (isPlayerAdoptedByConnectedHost(candidate)) {
      finishPlayerRestore();
      return true;
    }

    if (restorePlayer(false)) return true;
    if (!canDiscardOffRouteOrphan(candidate)) return false;

    candidate.remove();
    finishPlayerRestore();
    return true;
  }

  const playerAdoptionObserver = new MutationObserver(() => {
    if (!floatedPlayer) {
      stopPlayerAdoptionObservation();
      return;
    }

    if (reconcileTrackedPlayer()) {
      stopPlayerAdoptionObservation();
      scheduleRouteSync();
      return;
    }
    startPlayerAdoptionObservation();
  });

  function startPlayerAdoptionObservation() {
    const target = floatedPlayer?.parentElement;
    if (!target) return;
    if (
      playerAdoptionObserverActive &&
      playerAdoptionObserverTarget === target
    ) {
      return;
    }

    playerAdoptionObserver.disconnect();

    playerAdoptionObserver.observe(target, {
      childList: true,
    });
    playerAdoptionObserverActive = true;
    playerAdoptionObserverTarget = target;
  }

  function stopPlayerAdoptionObservation() {
    if (!playerAdoptionObserverActive) return;

    playerAdoptionObserver.disconnect();
    playerAdoptionObserverActive = false;
    playerAdoptionObserverTarget = null;
  }

  function scheduleOffRouteOrphanFinalisation() {
    if (
      playerOrphanFinaliseTimer ||
      !floatedPlayer ||
      navigationInProgress ||
      isEligiblePath() ||
      isBodyFloating()
    ) {
      return;
    }

    const candidate = floatedPlayer;
    startPlayerAdoptionObservation();
    playerOrphanFinaliseTimer = setTimeout(() => {
      playerOrphanFinaliseTimer = 0;
      if (
        floatedPlayer !== candidate ||
        navigationInProgress ||
        isEligiblePath() ||
        isBodyFloating()
      ) {
        return;
      }

      if (finaliseOffRouteOrphanIfSafe(candidate)) return;

      const recoveryHost = ensurePlayerRecoveryHost();
      if (recoveryHost && candidate.parentElement !== recoveryHost) {
        recoveryHost.appendChild(candidate);
      }
      // Keep the still-playing player available for native adoption, but stop
      // polling. Media lifecycle and route events will retry finalisation.
      startPlayerAdoptionObservation();
    }, PLAYER_ORPHAN_FINALISE_GRACE_MS);
  }

  function schedulePlayerRestoreRetries() {
    if (!floatedPlayer || playerRestoreRetryTimers.size) return;

    PLAYER_RESTORE_RETRY_DELAYS_MS.forEach((delay) => {
      const timerId = setTimeout(() => {
        playerRestoreRetryTimers.delete(timerId);
        if (!floatedPlayer || isBodyFloating()) return;
        if (reconcileTrackedPlayer()) return;
        restorePlayer(false);
      }, delay);
      playerRestoreRetryTimers.add(timerId);
    });
  }

  function restorePlayer(scheduleRetries = true) {
    if (reconcileTrackedPlayer()) return true;

    if (!floatedPlayer) {
      clearPlayerRestoreRetries();
      clearPlayerOrphanFinaliseTimer();
      removePlayerPlaceholder();
      return true;
    }

    const parent = getSafeRestoreParent(floatedPlayer);
    if (!parent) {
      if (scheduleRetries) schedulePlayerRestoreRetries();
      return false;
    }

    try {
      const nextSibling = restoreNextSibling && restoreNextSibling.parentNode === parent
        ? restoreNextSibling
        : null;
      parent.insertBefore(floatedPlayer, nextSibling);
    } catch {
      if (scheduleRetries) schedulePlayerRestoreRetries();
      return false;
    }

    if (floatedPlayer.parentElement !== parent) {
      if (scheduleRetries) schedulePlayerRestoreRetries();
      return false;
    }

    finishPlayerRestore();
    return true;
  }

  function createControlIcon(className, pathData) {
    const icon = document.createElementNS(SVG_NAMESPACE, "svg");
    icon.classList.add(className);
    icon.setAttribute("aria-hidden", "true");
    icon.setAttribute("focusable", "false");
    icon.setAttribute("viewBox", "0 0 24 24");

    const path = document.createElementNS(SVG_NAMESPACE, "path");
    path.setAttribute("d", pathData);
    icon.appendChild(path);
    return icon;
  }

  function ensureControlIcon(button, className, pathData) {
    let icon = button.querySelector(`svg.${className}`);
    if (icon) return icon;

    icon = createControlIcon(className, pathData);
    button.replaceChildren(icon);
    return icon;
  }

  function ensureCloseButton() {
    const player = getPlayer();
    if (!player) return;

    let button = document.getElementById(CLOSE_BUTTON_ID);
    if (!button) {
      button = document.createElement("button");
      button.id = CLOSE_BUTTON_ID;
      button.type = "button";
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        suppressedUntilVisible = true;
        setActive(false);
      }, true);
    }

    button.setAttribute("aria-label", "Close scroll miniplayer");
    button.title = "Close miniplayer";
    ensureControlIcon(button, "ytsmp-close-icon", CLOSE_ICON_PATH);

    if (button.parentElement !== player) {
      player.appendChild(button);
    }
  }

  function removeCloseButton() {
    const button = document.getElementById(CLOSE_BUTTON_ID);
    if (button) button.remove();
  }

  function setCornerMenuOpen(control, isOpen) {
    if (!control) return;

    if (isOpen) {
      control.dataset.open = "1";
    } else {
      delete control.dataset.open;
    }

    const button = control.querySelector(`#${CORNER_BUTTON_ID}`);
    if (button) button.setAttribute("aria-expanded", String(isOpen));
  }

  function updateCornerButton(button = document.getElementById(CORNER_BUTTON_ID)) {
    if (!button) return;

    const label = `Move miniplayer. Current position: ${CORNER_LABELS[currentCorner]}`;
    ensureControlIcon(
      button,
      "ytsmp-move-icon",
      MOVE_ICON_PATH,
    );
    button.setAttribute("aria-label", label);
    button.title = label;
  }

  function renderCornerOptions(control) {
    const menu = control?.querySelector(`#${CORNER_MENU_ID}`);
    if (!menu || menu.dataset.currentCorner === currentCorner) return;

    const options = VALID_CORNERS
      .filter((corner) => corner !== currentCorner)
      .map((corner) => {
        const option = document.createElement("button");
        const label = `Move miniplayer to ${CORNER_LABELS[corner]}`;
        option.className = CORNER_OPTION_CLASS;
        option.type = "button";
        option.dataset.corner = corner;
        option.setAttribute("aria-label", label);
        option.title = label;

        const icon = createControlIcon(
          "ytsmp-corner-icon",
          CORNER_ICON_PATH,
        );
        icon.style.transform = `rotate(${CORNER_ICON_ROTATIONS[corner]}deg)`;
        option.appendChild(icon);
        option.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          applyCornerSelection(corner, control);
        }, true);
        return option;
      });

    menu.replaceChildren(...options);
    menu.dataset.currentCorner = currentCorner;
  }

  function applyCornerSelection(corner, control) {
    if (!isValidCorner(corner) || corner === currentCorner) return;

    currentCorner = corner;
    persistCorner(currentCorner);
    updateCornerButton();
    renderCornerOptions(control);
    control?.querySelector(`#${CORNER_BUTTON_ID}`)?.focus({ preventScroll: true });
    setCornerMenuOpen(control, false);
    setBodyBoxVars();
    dispatchResize();
  }

  function ensureCornerButton() {
    const player = getPlayer();
    if (!player) return;

    let control = document.getElementById(CORNER_CONTROL_ID);
    if (!control) {
      control = document.createElement("div");
      control.id = CORNER_CONTROL_ID;
      control.addEventListener("pointerenter", () => {
        setCornerMenuOpen(control, true);
      });
      control.addEventListener("pointerleave", () => {
        if (!control.contains(document.activeElement)) {
          setCornerMenuOpen(control, false);
        }
      });
      control.addEventListener("focusin", () => {
        setCornerMenuOpen(control, true);
      });
      control.addEventListener("focusout", (event) => {
        if (!control.contains(event.relatedTarget)) {
          setCornerMenuOpen(control, false);
        }
      });
      control.addEventListener("keydown", (event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        control.querySelector(`#${CORNER_BUTTON_ID}`)?.focus({ preventScroll: true });
        setCornerMenuOpen(control, false);
      });
    }

    let button = control.querySelector(`#${CORNER_BUTTON_ID}`);
    if (!button) {
      button = document.createElement("button");
      button.id = CORNER_BUTTON_ID;
      button.type = "button";
      button.setAttribute("aria-controls", CORNER_MENU_ID);
      button.setAttribute("aria-expanded", "false");
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        setCornerMenuOpen(control, true);
      }, true);
      control.appendChild(button);
    }

    let menu = control.querySelector(`#${CORNER_MENU_ID}`);
    if (!menu) {
      menu = document.createElement("div");
      menu.id = CORNER_MENU_ID;
      menu.setAttribute("role", "group");
      menu.setAttribute("aria-label", "Choose miniplayer position");
      control.appendChild(menu);
    }

    updateCornerButton(button);
    renderCornerOptions(control);
    if (control.parentElement !== player) {
      player.appendChild(control);
    }
  }

  function removeCornerButton() {
    document.getElementById(CORNER_CONTROL_ID)?.remove();
    document.getElementById(CORNER_BUTTON_ID)?.remove();
    document.getElementById(CORNER_MENU_ID)?.remove();
  }

  function normaliseText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function getVideoIdFromUrl(value) {
    try {
      const url = new URL(value || "", location.origin);
      const watchVideoId = url.pathname === "/watch"
        ? url.searchParams.get("v") || ""
        : "";
      if (watchVideoId) return watchVideoId;

      const liveMatch = url.pathname.match(/^\/live\/([^/?#]+)/);
      return liveMatch ? decodeURIComponent(liveMatch[1]) : "";
    } catch {
      return "";
    }
  }

  function getQueueItemVideoId(item) {
    const link = item && item.querySelector('a[href*="/watch"], a[href*="/live/"]');
    return link ? getVideoIdFromUrl(link.href || link.getAttribute("href")) : "";
  }

  function isQueuePanelVisible(panel) {
    if (
      !panel?.isConnected ||
      panel.hidden ||
      panel.hasAttribute("hidden") ||
      panel.getAttribute("aria-hidden") === "true"
    ) {
      return false;
    }

    const style = getComputedStyle(panel);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.opacity === "0"
    ) {
      return false;
    }

    const rect = panel.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function getSelectedQueueItem(items) {
    return items.find((item) =>
      item.hasAttribute("selected") ||
      item.getAttribute("aria-current") === "true" ||
      item.getAttribute("aria-selected") === "true" ||
      item.classList.contains("selected") ||
      Boolean(item.querySelector('[aria-current="true"], [aria-selected="true"]'))
    ) || null;
  }

  function getCurrentVideoIds(player) {
    let playerVideoId = "";
    try {
      playerVideoId = normaliseText(player?.getVideoData?.()?.video_id);
    } catch {
      // YouTube can replace the player API while navigating.
    }

    return [
      getVideoIdFromUrl(location.href),
      playerVideoId,
    ].filter((videoId, index, videoIds) =>
      Boolean(videoId) && videoIds.indexOf(videoId) === index
    );
  }

  function getCurrentQueuePanel(currentVideoIds) {
    const entries = Array.from(document.querySelectorAll(QUEUE_PANEL_SELECTOR))
      .map((panel) => {
        const items = Array.from(panel.querySelectorAll(QUEUE_ITEM_SELECTOR));
        const selectedItem = getSelectedQueueItem(items);
        let matchedItem = null;
        let matchedVideoPriority = -1;

        currentVideoIds.some((videoId, priority) => {
          matchedItem = items.find(
            (item) => getQueueItemVideoId(item) === videoId,
          ) || null;
          if (!matchedItem) return false;
          matchedVideoPriority = priority;
          return true;
        });

        return {
          items,
          matchedItem,
          matchedVideoPriority,
          panel,
          selectedItem,
          visible: isQueuePanelVisible(panel),
        };
      })
      .filter(({ items }) => items.length);

    const compareEntries = (left, right) => {
      const score = (entry) =>
        (entry.matchedItem ? 1000 - entry.matchedVideoPriority * 10 : 0) +
        (entry.selectedItem ? 10 : 0);
      return score(right) - score(left);
    };
    const visibleEntries = entries.filter(({ visible }) => visible);
    const visibleMatchedEntries = visibleEntries.filter(
      ({ matchedItem }) => matchedItem,
    );
    if (visibleMatchedEntries.length) {
      visibleMatchedEntries.sort(compareEntries);
      return visibleMatchedEntries[0];
    }

    const matchedEntries = entries.filter(({ matchedItem }) => matchedItem);
    if (matchedEntries.length) {
      matchedEntries.sort(compareEntries);
      return matchedEntries[0];
    }

    const visibleSelectedEntries = visibleEntries.filter(
      ({ selectedItem }) => selectedItem,
    );
    if (visibleSelectedEntries.length === 1) {
      return visibleSelectedEntries[0];
    }
    if (!visibleSelectedEntries.length && visibleEntries.length === 1) {
      return visibleEntries[0];
    }

    const hiddenSelectedEntries = entries.filter(
      ({ selectedItem, visible }) => selectedItem && !visible,
    );
    return hiddenSelectedEntries.length === 1
      ? hiddenSelectedEntries[0]
      : null;
  }

  function getCompactQueueState() {
    if (!CONFIG.showCompactQueueInfo) return null;

    const player = getPlayer();
    const currentVideoIds = getCurrentVideoIds(player);
    const entry = getCurrentQueuePanel(currentVideoIds);
    if (!entry) return null;

    const { items, panel } = entry;
    let currentItem = entry.matchedItem;
    const matchedCurrentVideoId = Boolean(currentItem);
    if (!currentItem) {
      currentItem = entry.selectedItem;
    }

    const indexText = normaliseText(
      panel.querySelector(QUEUE_INDEX_SELECTOR)?.textContent,
    );
    const indexMatch = indexText.match(/(\d+)\s*\/\s*(\d+)/);
    let index = currentItem ? items.indexOf(currentItem) + 1 : 0;
    let total = items.length;
    if (indexMatch) {
      if (!matchedCurrentVideoId) {
        index = Number(indexMatch[1]) || index;
      }
      total = Number(indexMatch[2]) || total;
    }
    if (!currentItem && index > 0) {
      currentItem = items[index - 1] || null;
    }

    const titleElement =
      currentItem &&
      (currentItem.querySelector(QUEUE_ITEM_TITLE_SELECTOR) ||
        currentItem.querySelector(QUEUE_ITEM_TITLE_FALLBACK_SELECTOR));
    const title = normaliseText(
      titleElement?.getAttribute("title") ||
      titleElement?.textContent ||
      document.querySelector(WATCH_TITLE_SELECTOR)?.textContent ||
      document.title.replace(/\s*-\s*YouTube\s*$/, ""),
    );
    if (!title) return null;

    return {
      position: index > 0 ? `Queue ${index} / ${total}` : `Queue / ${total}`,
      title,
    };
  }

  function removeCompactQueueInfo() {
    const queueInfo = document.getElementById(QUEUE_INFO_ID);
    if (queueInfo) queueInfo.remove();
  }

  function syncCompactQueueInfo() {
    queueInfoSyncFrame = 0;
    if (!isBodyActive()) {
      removeCompactQueueInfo();
      return;
    }

    const player = getPlayer();
    const state = getCompactQueueState();
    if (!player || !state) {
      removeCompactQueueInfo();
      return;
    }

    let queueInfo = document.getElementById(QUEUE_INFO_ID);
    if (!queueInfo) {
      queueInfo = document.createElement("div");
      queueInfo.id = QUEUE_INFO_ID;
      queueInfo.setAttribute("role", "status");
      queueInfo.setAttribute("aria-live", "polite");
      queueInfo.innerHTML =
        '<span class="ytsmp-queue-position"></span>' +
        '<span class="ytsmp-queue-title"></span>';
    }
    if (queueInfo.parentElement !== player) {
      player.appendChild(queueInfo);
    }

    const position = queueInfo.querySelector(".ytsmp-queue-position");
    const title = queueInfo.querySelector(".ytsmp-queue-title");
    if (position.textContent !== state.position) {
      position.textContent = state.position;
    }
    if (title.textContent !== state.title) {
      title.textContent = state.title;
      title.title = state.title;
    }
  }

  function scheduleCompactQueueInfoSync() {
    if (queueInfoSyncFrame) return;

    queueInfoSyncFrame = requestAnimationFrame(syncCompactQueueInfo);
  }

  function dispatchResize() {
    window.dispatchEvent(new Event("resize"));
  }

  function setActive(active) {
    const body = document.body;
    if (!body) return;

    const wasActive = body.classList.contains(ACTIVE_CLASS);
    const wasExiting = body.classList.contains(EXITING_CLASS);

    if (active === wasActive && !wasExiting) {
      if (!active && floatedPlayer) restorePlayer();
      return;
    }

    if (active) {
      if (!canFloatPlayer()) return;

      clearTimeout(fadeOutTimer);
      ensureStyles();
      if (!movePlayerToTopLevel(getPlayer())) return;
      ensureCloseButton();
      ensureCornerButton();
      setBodyBoxVars();
      body.classList.remove(EXITING_CLASS);
      body.classList.add(ACTIVE_CLASS);
      scheduleCompactQueueInfoSync();

      if (!wasActive) {
        dispatchResize();
      }
      return;
    }

    clearTimeout(fadeOutTimer);
    body.classList.remove(ACTIVE_CLASS);

    if (wasActive) {
      if (CONFIG.exitTransitionMs <= 0) {
        body.classList.remove(EXITING_CLASS);
        clearBodyBoxVars();
        removeCloseButton();
        removeCornerButton();
        removeCompactQueueInfo();
        restorePlayer();
        dispatchResize();
        return;
      }

      body.classList.add(EXITING_CLASS);
      fadeOutTimer = setTimeout(() => {
        body.classList.remove(EXITING_CLASS);
        clearBodyBoxVars();
        removeCloseButton();
        removeCornerButton();
        removeCompactQueueInfo();
        restorePlayer();
        dispatchResize();
      }, CONFIG.exitTransitionMs);
      dispatchResize();
      return;
    }

    body.classList.remove(EXITING_CLASS);
    clearBodyBoxVars();
    removeCloseButton();
    removeCornerButton();
    removeCompactQueueInfo();
    restorePlayer();
  }

  function deactivateImmediately() {
    const body = document.body;
    if (!body) return;

    const wasFloating = isBodyFloating();
    clearTimeout(fadeOutTimer);
    body.classList.remove(ACTIVE_CLASS, EXITING_CLASS);
    clearBodyBoxVars();
    removeCloseButton();
    removeCornerButton();
    removeCompactQueueInfo();
    restorePlayer();

    if (wasFloating) {
      dispatchResize();
    }
  }

  function shouldFloatFromScroll() {
    if (navigationInProgress || !isEligiblePath() || isFullscreen()) return false;

    const anchor = getTriggerAnchor();
    if (!anchor) return false;

    const triggerLine = getMastheadHeight() + CONFIG.triggerOffsetPx;
    if (anchor.getBoundingClientRect().top > triggerLine) return false;

    const playerAnchor = getPlayerViewportAnchor();
    if (!playerAnchor) return false;

    const playerRect = playerAnchor.getBoundingClientRect();
    if (isBodyActive()) {
      return !(playerRect.bottom > triggerLine && playerRect.top < innerHeight);
    }

    return playerRect.bottom <= triggerLine;
  }

  function syncScrollState() {
    scrollSyncFrame = 0;

    if (!shouldFloatFromScroll() || !canFloatPlayer()) {
      suppressedUntilVisible = false;
      setActive(false);
      return;
    }

    if (!suppressedUntilVisible) {
      setActive(true);
    }
  }

  function scheduleScrollSync() {
    if (navigationInProgress || !isEligiblePath() || scrollSyncFrame) return;

    scrollSyncFrame = requestAnimationFrame(syncScrollState);
  }

  function syncRouteState() {
    routeSyncFrame = 0;
    reconcileTrackedPlayer();

    if (navigationInProgress) {
      suppressedUntilVisible = false;
      setActive(false);
      return;
    }

    if (!isEligiblePath()) {
      stopMutationObservation();
      suppressedUntilVisible = false;
      setActive(false);
      scheduleOffRouteOrphanFinalisation();
      return;
    }

    clearPlayerOrphanFinaliseTimer();
    startMutationObservation();
    syncQueuePanelObservation();
    ensureStyles();
    if (isBodyActive()) {
      scheduleCompactQueueInfoSync();
    }
    scheduleScrollSync();
  }

  function scheduleRouteSync() {
    if (routeSyncFrame) return;

    routeSyncFrame = requestAnimationFrame(syncRouteState);
  }

  function cancelScheduledAnimationFrames() {
    if (scrollSyncFrame) cancelAnimationFrame(scrollSyncFrame);
    if (routeSyncFrame) cancelAnimationFrame(routeSyncFrame);
    if (queueInfoSyncFrame) cancelAnimationFrame(queueInfoSyncFrame);
    scrollSyncFrame = 0;
    routeSyncFrame = 0;
    queueInfoSyncFrame = 0;
  }

  function getMutationElement(node) {
    if (!node) return null;
    return node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  }

  function nodeContainsQueuePanel(node) {
    const element = getMutationElement(node);
    return Boolean(
      element &&
      (
        element.matches(QUEUE_PANEL_SELECTOR) ||
        element.querySelector?.(QUEUE_PANEL_SELECTOR)
      )
    );
  }

  function mutationChangesQueuePanelTopology(mutation) {
    return [...mutation.addedNodes, ...mutation.removedNodes]
      .some(nodeContainsQueuePanel);
  }

  function mutationTouchesQueueContent(mutation) {
    const target = getMutationElement(mutation.target);
    if (target?.closest(QUEUE_PANEL_SELECTOR)) return true;

    return [...mutation.addedNodes, ...mutation.removedNodes]
      .some((node) => {
        const element = getMutationElement(node);
        return Boolean(
          element &&
          (
            element.matches(QUEUE_ITEM_SELECTOR) ||
            element.querySelector?.(QUEUE_ITEM_SELECTOR)
          )
        );
      });
  }

  function isQueuePanelStateMutation(panel, mutation) {
    const target = getMutationElement(mutation.target);
    if (!target) return false;

    const targetContainsPanel = target !== panel && target.contains(panel);
    if (!targetContainsPanel && !panel.contains(target)) return false;
    if (targetContainsPanel) {
      return QUEUE_VISIBILITY_STATE_ATTRIBUTES.includes(
        mutation.attributeName,
      );
    }
    if (target === panel) return true;

    if (
      mutation.attributeName === "aria-current" ||
      mutation.attributeName === "aria-selected" ||
      mutation.attributeName === "selected"
    ) {
      return true;
    }

    return Boolean(
      (mutation.attributeName === "class" ||
        mutation.attributeName === "hidden" ||
        mutation.attributeName === "aria-hidden" ||
        mutation.attributeName === "style") &&
      (
        target.matches(QUEUE_ITEM_SELECTOR) ||
        target.querySelector?.(QUEUE_ITEM_SELECTOR)
      )
    );
  }

  function stopQueuePanelObservation() {
    queuePanelObservers.forEach((observer) => observer.disconnect());
    queuePanelObservers.clear();
  }

  function replaceObserverRegistrations(targetObserver, registrations) {
    if (typeof targetObserver.replaceRegistrations === "function") {
      targetObserver.replaceRegistrations(registrations);
      return;
    }

    targetObserver.disconnect();
    registrations.forEach(([target, options]) =>
      targetObserver.observe(target, options),
    );
  }

  function syncQueuePanelObservation(force = false) {
    if (force) stopQueuePanelObservation();

    const panels = new Set(
      mutationObserverActive && !navigationInProgress && isEligiblePath()
        ? document.querySelectorAll(QUEUE_PANEL_SELECTOR)
        : [],
    );

    queuePanelObservers.forEach((observer, panel) => {
      if (panels.has(panel) && panel.isConnected) return;
      observer.disconnect();
      queuePanelObservers.delete(panel);
    });

    panels.forEach((panel) => {
      if (queuePanelObservers.has(panel)) return;

      const observer = new MutationObserver((mutations) => {
        if (navigationInProgress || !isEligiblePath()) return;
        if (mutations.some((mutation) => isQueuePanelStateMutation(panel, mutation))) {
          scheduleCompactQueueInfoSync();
        }
      });
      const registrations = [
        [panel, {
          attributeFilter: QUEUE_PANEL_STATE_ATTRIBUTES,
          attributes: true,
          subtree: true,
        }],
      ];
      let ancestor = panel.parentElement;
      while (ancestor && ancestor !== document.body) {
        registrations.push([ancestor, {
          attributeFilter: QUEUE_VISIBILITY_STATE_ATTRIBUTES,
          attributes: true,
        }]);
        if (ancestor.matches(WATCH_ROOT_SELECTOR)) break;
        ancestor = ancestor.parentElement;
      }
      replaceObserverRegistrations(observer, registrations);
      queuePanelObservers.set(panel, observer);
    });
  }

  const mutationObserver = new MutationObserver((mutations) => {
    if (reconcileTrackedPlayer()) {
      scheduleRouteSync();
    }
    if (navigationInProgress || !isEligiblePath()) return;

    const queuePanelTopologyChanged = mutations.some(
      mutationChangesQueuePanelTopology,
    );
    if (queuePanelTopologyChanged) {
      syncQueuePanelObservation(true);
    }

    const queueContentChanged =
      queuePanelTopologyChanged ||
      mutations.some(mutationTouchesQueueContent);
    if (queueContentChanged) {
      if (isBodyActive()) scheduleCompactQueueInfoSync();
    }

    if (getTriggerAnchor()) return;

    for (const mutation of mutations) {
      if (mutation.addedNodes.length) {
        scheduleRouteSync();
        break;
      }
    }
  });

  function startMutationObservation() {
    if (mutationObserverActive || navigationInProgress || !isEligiblePath()) return;

    mutationObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
    mutationObserverActive = true;
    syncQueuePanelObservation();
  }

  function stopMutationObservation() {
    if (!mutationObserverActive) return;

    mutationObserver.disconnect();
    mutationObserverActive = false;
    stopQueuePanelObservation();
  }

  window.addEventListener("resize", () => {
    if (isBodyActive()) {
      setBodyBoxVars();
    }
    scheduleScrollSync();
  }, { passive: true });

  window.addEventListener("scroll", scheduleScrollSync, { passive: true });

  window.addEventListener("storage", (event) => {
    if (
      event.key !== CORNER_STORAGE_KEY ||
      !isValidCorner(event.newValue) ||
      event.newValue === currentCorner
    ) {
      return;
    }

    currentCorner = event.newValue;
    const control = document.getElementById(CORNER_CONTROL_ID);
    updateCornerButton();
    renderCornerOptions(control);
    setCornerMenuOpen(control, false);

    if (isBodyFloating()) {
      setBodyBoxVars();
      dispatchResize();
    }
  });

  document.addEventListener("fullscreenchange", () => {
    if (isFullscreen()) setActive(false);
  }, true);

  document.addEventListener("ended", (event) => {
    if (event.target === getPlayerVideo()) {
      // Do not reparent YouTube's player during its ended-event dispatch.
      setTimeout(() => {
        setActive(false);
        finaliseOffRouteOrphanIfSafe();
      }, 0);
    }
  }, true);

  document.addEventListener("error", (event) => {
    if (event.target === getPlayerVideo()) {
      setTimeout(() => finaliseOffRouteOrphanIfSafe(), 0);
    }
  }, true);

  document.addEventListener("emptied", (event) => {
    if (event.target === getPlayerVideo()) {
      setTimeout(() => finaliseOffRouteOrphanIfSafe(), 0);
    }
  }, true);

  document.addEventListener("loadedmetadata", (event) => {
    if (
      floatedPlayer &&
      event.target instanceof HTMLMediaElement &&
      reconcileTrackedPlayer()
    ) {
      scheduleRouteSync();
    }
  }, true);

  window.addEventListener("yt-navigate-start", () => {
    beginNavigationLock();
    deactivateImmediately();
  }, true);
  window.addEventListener("yt-navigate-finish", () => {
    navigationFinishPending = true;
    finishNavigationLockIfSettled();
  }, true);
  window.addEventListener("yt-page-data-updated", () => {
    if (navigationFinishPending) {
      finishNavigationLockIfSettled();
      return;
    }
    scheduleRouteSync();
  }, true);
  window.addEventListener("pagehide", cancelScheduledAnimationFrames, true);
  window.addEventListener("pageshow", () => {
    // A BFCache restore may not emit a matching YouTube navigation finish.
    finishNavigationLock();
  }, true);

  syncRouteState();
})();
