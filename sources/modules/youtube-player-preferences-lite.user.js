// ==UserScript==
// @name         YouTube Player Preferences Lite
// @namespace    Citizen.youtube.player-preferences-lite
// @version      1.50
// @description  Applies small YouTube player preferences without touching Enhancer-style miniplayer, queue, autoplay, or background playback controls.
// @author       Citizen
// @homepageURL  https://github.com/noswimmingplease/youtube-player-preferences-lite
// @supportURL   https://github.com/noswimmingplease/youtube-player-preferences-lite/issues
// @updateURL    https://raw.githubusercontent.com/noswimmingplease/youtube-player-preferences-lite/main/youtube-player-preferences-lite.user.js
// @downloadURL  https://raw.githubusercontent.com/noswimmingplease/youtube-player-preferences-lite/main/youtube-player-preferences-lite.user.js
// @match        https://www.youtube.com/*
// @run-at       document-idle
// @grant        none
// @noframes
// ==/UserScript==

(() => {
  "use strict";

  const CONFIG = {
    convertShortsToWatch: true,
    hideShorts: true,
    useStandardMastheadLogo: true,
    hideUpcomingStreams: true,
    hidePayToWatchCards: true,
    hideWatchedVideos: true,
    watchedVideoThresholdPercent: 90,
    hideRelatedVideos: true,
    hideAskButton: true,
    hideThanksButton: true,
    hideShareButton: true,
    hideInlineSaveButton: false,
    hideJoinButton: true,
    hideMerchShelf: true,
    hideBrandVideoShelf: true,
    hideStatementBanners: true,
    hideMetadataTeaserCarousel: true,
    hideInfoPanel: true,
    hideHashtags: true,
    collapseDescriptionBlankRows: true,
    hideStructuredDescription: true,
    hideChat: true,
    hideInfoCards: true,
    hideEndScreenRecommendationGrid: true,
    showAutoplayUpNextCard: true,
    useReadableYellowCaptions: true,
    enableTheaterMode: true,
    enableHighestQuality: false,
    highestQualityRetryDelays: [0, 300, 1000, 2500, 5000, 10000],
    enablePlayerWheelVolume: true,
    requireRightMouseButtonForWheelVolume: true,
    wheelVolumeStep: 5,
    contextMenuSuppressionWindowMs: 750,
    feedFilterProfiles: {
      default: {
        upcomingStreams: true,
        payToWatchCards: true,
        watchedVideos: true,
      },
      home: {
        upcomingStreams: true,
        payToWatchCards: true,
        watchedVideos: true,
      },
      subscriptions: {
        upcomingStreams: true,
        payToWatchCards: true,
        watchedVideos: true,
      },
      search: {
        upcomingStreams: true,
        payToWatchCards: true,
        watchedVideos: true,
      },
      history: {
        upcomingStreams: true,
        payToWatchCards: true,
        watchedVideos: false,
      },
    },
  };

  const STYLE_ID = "ytppl-style";
  const VOLUME_OVERLAY_CLASS = "ytppl-volume-overlay";
  const RESTORED_LIKE_ICON_CLASS = "ytppl-ryd-like-icon";
  const RESTORED_DISLIKE_ICON_CLASS = "ytppl-ryd-dislike-icon";
  const EMPTY_RYD_ICON_ATTRIBUTE = "data-ytppl-empty-ryd-icon";
  const SHORTS_LINK_SELECTOR =
    'a[href^="/shorts/"], a[href*="youtube.com/shorts/"]';
  const SHORTS_CONVERTED_ATTRIBUTE = "data-ytppl-shorts-converted";
  const SHORTS_CONVERTED_LINK_SELECTOR =
    `a[${SHORTS_CONVERTED_ATTRIBUTE}]`;
  const TOPBAR_LOGO_RENDERER_SELECTOR =
    "ytd-masthead ytd-topbar-logo-renderer";
  const FEED_CARD_CONTAINER_SELECTOR = [
    "ytd-rich-item-renderer",
    "ytd-video-renderer",
    "ytd-grid-video-renderer",
    "ytd-compact-video-renderer",
  ].join(",");
  const UPCOMING_STREAM_SCAN_SELECTOR = [
    FEED_CARD_CONTAINER_SELECTOR,
    "yt-lockup-view-model",
    "yt-lockup-view-model-wiz",
  ].join(",");
  const UPCOMING_STREAM_BADGE_SELECTOR = [
    ".yt-badge-shape__text",
    "badge-shape",
    "yt-badge-shape",
    "ytd-thumbnail-overlay-time-status-renderer",
    "yt-thumbnail-overlay-badge-view-model",
    "yt-thumbnail-bottom-overlay-view-model",
  ].join(",");
  const PAY_TO_WATCH_SCAN_SELECTOR = [
    UPCOMING_STREAM_SCAN_SELECTOR,
    "yt-lockup-metadata-view-model",
    "yt-lockup-metadata-view-model-wiz",
  ].join(",");
  const PAY_TO_WATCH_TEXT_SELECTOR = [
    "yt-lockup-metadata-view-model",
    "yt-lockup-metadata-view-model-wiz",
    "ytd-video-meta-block",
    "#metadata-line",
    ".yt-badge-shape__text",
    "badge-shape",
    "yt-badge-shape",
    "ytd-badge-supported-renderer",
  ].join(",");
  const WATCHED_VIDEO_SCAN_SELECTOR = [
    FEED_CARD_CONTAINER_SELECTOR,
    "ytd-rich-grid-media",
    "ytd-rich-grid-slim-media",
    "yt-lockup-view-model",
    "yt-lockup-view-model-wiz",
  ].join(",");
  const WATCHED_PROGRESS_VALUE_SELECTOR = [
    "ytd-thumbnail-overlay-resume-playback-renderer #progress",
    "#progress",
    "tp-yt-paper-progress#progress",
    "tp-yt-paper-progress #primaryProgress",
    "yt-progress-bar-line",
    ".ytThumbnailOverlayProgressBarProgress",
    ".ytThumbnailOverlayProgressBarViewModelProgress",
    "[class*='ThumbnailOverlayProgressBar'][class*='Progress']",
  ].join(",");
  const WATCHED_PROGRESS_SELECTOR = [
    "ytd-thumbnail-overlay-resume-playback-renderer",
    "yt-thumbnail-overlay-progress-bar-view-model",
    ".ytThumbnailOverlayProgressBarHost",
    ".ytThumbnailOverlayProgressBarViewModelHost",
    WATCHED_PROGRESS_VALUE_SELECTOR,
  ].join(",");
  const WATCH_PATHS = ["/watch", "/live/"];
  const LIVE_CHAT_FRAME_SELECTOR =
    "ytd-watch-flexy ytd-live-chat-frame#chat";
  const LIVE_CHAT_COLLAPSE_BUTTON_SELECTOR = [
    "#show-hide-button #button",
    "#show-hide-button button",
    '#show-hide-button [role="button"]',
  ].join(",");
  const LIVE_CHAT_COLLAPSE_DELAYS_MS = [0, 300, 1200, 3000, 6000];
  const LIVE_CHAT_COLLAPSE_PENDING_TIMEOUT_MS = 750;
  const EXCLUDED_SURFACE_SELECTOR = [
    "ytd-miniplayer",
    "ytd-miniplayer-ui",
    "ytd-miniplayer-bar-renderer",
    "ytd-playlist-panel-renderer",
    "ytd-playlist-panel-video-renderer",
    "ytd-playlist-panel-renderer #items",
    "ytd-engagement-panel-section-list-renderer",
  ].join(",");
  const CARD_HIDE_ATTRIBUTES = Object.freeze({
    ytpplUpcomingHidden: "data-ytppl-upcoming-hidden",
    ytpplPayToWatchHidden: "data-ytppl-pay-to-watch-hidden",
    ytpplWatchedHidden: "data-ytppl-watched-hidden",
  });
  const FILTER_REVEAL_ATTRIBUTE = "data-yt-master-show-filtered";
  const CARD_HIDE_ATTRIBUTE_SELECTORS = Object.values(
    CARD_HIDE_ATTRIBUTES,
  ).map((attribute) => `[${attribute}="1"]`);
  // Keep the DOM marker and CSS selector in lockstep; YouTube custom elements
  // can expose non-standard style objects, so hiding is CSS-driven.
  const WATCH_ACTION_HIDDEN_DATASET_KEY = "ytpplActionHidden";
  const WATCH_ACTION_HIDDEN_ATTRIBUTE = "data-ytppl-action-hidden";
  const WATCH_ACTION_HIDDEN_VALUE = "1";
  const WATCH_ACTION_HIDDEN_SELECTOR = `[${WATCH_ACTION_HIDDEN_ATTRIBUTE}="${WATCH_ACTION_HIDDEN_VALUE}"]`;
  const WATCH_ACTION_BUTTON_SELECTOR = [
    "ytd-watch-flexy ytd-menu-renderer yt-button-view-model",
    "ytd-watch-flexy ytd-menu-renderer button-view-model",
    `ytd-watch-flexy ytd-menu-renderer ${WATCH_ACTION_HIDDEN_SELECTOR}`,
  ].join(",");
  const WATCH_ACTION_MENU_ITEM_SELECTOR = [
    "ytd-popup-container ytd-menu-service-item-renderer",
    "ytd-popup-container yt-list-item-view-model",
    "ytd-popup-container ytd-compact-link-renderer",
    "ytd-popup-container tp-yt-paper-item",
    "tp-yt-iron-dropdown ytd-menu-service-item-renderer",
    "tp-yt-iron-dropdown yt-list-item-view-model",
    "tp-yt-iron-dropdown ytd-compact-link-renderer",
    "tp-yt-iron-dropdown tp-yt-paper-item",
    `ytd-popup-container ${WATCH_ACTION_HIDDEN_SELECTOR}`,
    `tp-yt-iron-dropdown ${WATCH_ACTION_HIDDEN_SELECTOR}`,
  ].join(",");
  const WATCH_ACTION_MENU_ITEM_RENDERER_SELECTOR = [
    "ytd-menu-service-item-renderer",
    "yt-list-item-view-model",
    "ytd-compact-link-renderer",
  ].join(",");
  const WATCH_ACTION_MENU_ITEM_FALLBACK_SELECTOR = "tp-yt-paper-item";
  const WATCH_ACTION_PRESERVE_SELECTOR = [
    "segmented-like-dislike-button-view-model",
    "ytd-segmented-like-dislike-button-renderer",
    "#segmented-like-button",
    "#segmented-dislike-button",
    "#like-button",
    "#dislike-button",
    "like-button-view-model",
    "dislike-button-view-model",
  ].join(",");
  const WATCH_ACTION_BUTTON_RULES = [
    { configKey: "hideAskButton", label: "Ask" },
    { configKey: "hideThanksButton", label: "Thanks" },
    { configKey: "hideShareButton", label: "Share" },
  ];
  const WATCH_ACTION_INLINE_BUTTON_RULES = [
    { configKey: "hideInlineSaveButton", label: "Save" },
  ];
  const WATCH_DYNAMIC_MUTATION_ROOT_SELECTOR = [
    "ytd-masthead",
    "ytd-watch-flexy ytd-watch-metadata",
    "ytd-watch-flexy ytd-video-primary-info-renderer",
    "ytd-popup-container",
    "tp-yt-iron-dropdown",
  ].join(",");
  const WATCH_RELATED_MUTATION_ROOT_SELECTOR =
    "ytd-watch-flexy #secondary #related";
  const DYNAMIC_MUTATION_OPTIONS = Object.freeze({
    attributeFilter: Object.freeze([
      "aria-label",
      "class",
      "hidden",
      "href",
      "show-yoodle",
      "style",
      "title",
    ]),
    attributes: true,
    childList: true,
    characterData: true,
    subtree: true,
  });
  const DYNAMIC_MUTATION_DISCOVERY_OPTIONS = Object.freeze({
    childList: true,
    subtree: true,
  });
  const RYD_LIKE_BUTTON_SELECTOR = [
    "ytd-watch-flexy #segmented-like-button button",
    "ytd-watch-flexy like-button-view-model button",
    "ytd-watch-flexy #like-button button",
    'ytd-watch-flexy ytd-menu-renderer button[aria-label^="Like" i]',
    'ytd-watch-flexy ytd-menu-renderer button[aria-label^="Unlike" i]',
    'ytd-watch-flexy ytd-menu-renderer button[title^="Like" i]',
    'ytd-watch-flexy ytd-menu-renderer button[title^="Unlike" i]',
  ].join(",");
  const RYD_WATCH_ACTION_BUTTON_SELECTOR =
    "ytd-watch-flexy ytd-menu-renderer button";
  const RYD_DISLIKE_BUTTON_SELECTOR = [
    "ytd-watch-flexy #segmented-dislike-button button",
    "ytd-watch-flexy dislike-button-view-model button",
    "ytd-watch-flexy #dislike-button button",
  ].join(",");
  const RYD_LIKE_TEXT_SELECTOR = [
    "ytd-watch-flexy #segmented-like-button .ytSpecButtonShapeNextButtonTextContent",
    "ytd-watch-flexy #segmented-like-button .yt-spec-button-shape-next__button-text-content",
    "ytd-watch-flexy like-button-view-model .ytSpecButtonShapeNextButtonTextContent",
    "ytd-watch-flexy like-button-view-model .yt-spec-button-shape-next__button-text-content",
  ].join(",");
  const RYD_TEXT_CONTAINER_SELECTOR = [
    ".ytSpecButtonShapeNextButtonTextContent",
    ".yt-spec-button-shape-next__button-text-content",
    "yt-formatted-string#text",
    "span[role='text']",
  ].join(",");
  const RYD_ICON_SELECTOR = [
    ".ytSpecButtonShapeNextIcon",
    ".yt-spec-button-shape-next__icon",
    ".yt-icon-shape",
    "yt-icon",
    "yt-icon-shape",
    `.${RESTORED_LIKE_ICON_CLASS}`,
    `.${RESTORED_DISLIKE_ICON_CLASS}`,
  ].join(",");
  const HASHTAG_LINK_SELECTOR =
    'a[href^="/hashtag/"], a[href*="youtube.com/hashtag/"]';
  const HASHTAG_TEXT_PATTERN = /(^|\s)#[^\s#]+/g;
  const HASHTAG_TEXT_TEST_PATTERN = /#[^\s#]+/;
  const HASHTAG_ONLY_LINE_PATTERN = /^\s*(?:#[^\s#]+\s*)+$/;
  const DESCRIPTION_REPEATED_BLANK_LINE_PATTERN =
    /(?:[ \t\u00a0]*\r?\n){2,}/g;
  const DESCRIPTION_SEPARATOR_TEXT_ONLY_PATTERN = /^[ \t\r\n\u00a0]+$/;
  const DESCRIPTION_SEPARATOR_TEXT_PATTERN = /[\r\n]|\u00a0{2,}/;
  const DESCRIPTION_TEXT_ROOT_SELECTOR = [
    "ytd-watch-flexy ytd-watch-metadata #description",
    "ytd-watch-flexy ytd-watch-metadata #description-inner",
    "ytd-watch-flexy ytd-watch-metadata #description-inline-expander",
    "ytd-watch-flexy ytd-watch-metadata ytd-text-inline-expander",
  ].join(",");
  const HASHTAG_EMPTY_ANCESTOR_STOP_SELECTOR = [
    "ytd-watch-metadata",
    "ytd-video-primary-info-renderer",
    "#description",
    "#description-inner",
    "#description-inline-expander",
    "ytd-text-inline-expander",
    "#info-container",
  ].join(",");
  const DESCRIPTION_EXPANDED_SELECTOR = [
    "ytd-watch-flexy ytd-watch-metadata ytd-text-inline-expander #expanded",
    "ytd-watch-flexy ytd-watch-metadata #description-inline-expander #expanded",
  ].join(",");
  const DESCRIPTION_HEIGHT_RESET_ANCESTOR_SELECTOR = [
    "#description",
    "#description-inner",
    "#description-inline-expander",
    "ytd-text-inline-expander",
  ].join(",");
  const DESCRIPTION_HEIGHT_RESET_STOP_SELECTOR = [
    "ytd-watch-metadata",
    "ytd-video-primary-info-renderer",
  ].join(",");
  const DESCRIPTION_EXPANDED_COLLAPSED_DATASET_KEY =
    "ytpplExpandedDescriptionCollapsed";
  const DESCRIPTION_EXPANDED_COLLAPSED_ATTRIBUTE =
    "data-ytppl-expanded-description-collapsed";
  const DESCRIPTION_CONTROL_SELECTOR = [
    "button",
    "tp-yt-paper-button",
    "ytd-button-renderer",
    "[role='button']",
  ].join(",");
  const WATCH_INFO_TEXT_SELECTOR =
    "ytd-watch-flexy ytd-watch-metadata ytd-watch-info-text";
  const WATCH_INFO_NATIVE_CONTAINER_SELECTOR = "#info-container";
  const WATCH_INFO_TOOLTIP_SELECTOR = "tp-yt-paper-tooltip #tooltip";
  const WATCH_INFO_STATIC_TEXT_CLASS = "ytppl-watch-info-static-text";
  const WATCH_INFO_NATIVE_HIDDEN_ATTRIBUTE =
    "data-ytppl-watch-info-native-hidden";
  const TOPBAR_DYNAMIC_MUTATION_SURFACE_SELECTOR = "ytd-masthead";
  const FEED_DYNAMIC_MUTATION_SURFACE_SELECTOR = [
    FEED_CARD_CONTAINER_SELECTOR,
    "ytd-rich-grid-media",
    "ytd-rich-grid-slim-media",
    "yt-lockup-view-model",
    "yt-lockup-view-model-wiz",
  ].join(",");
  const SHORTS_DYNAMIC_MUTATION_SURFACE_SELECTOR = [
    SHORTS_LINK_SELECTOR,
    SHORTS_CONVERTED_LINK_SELECTOR,
  ].join(",");
  const WATCH_PRIMARY_ACTION_CONTAINER_SELECTOR =
    "ytd-watch-flexy ytd-menu-renderer";
  const WATCH_PRIMARY_ACTION_MUTATION_SURFACE_SELECTOR = [
    WATCH_PRIMARY_ACTION_CONTAINER_SELECTOR,
    RYD_LIKE_BUTTON_SELECTOR,
    RYD_DISLIKE_BUTTON_SELECTOR,
  ].join(",");
  const WATCH_ACTION_MENU_MUTATION_SURFACE_SELECTOR =
    WATCH_ACTION_MENU_ITEM_SELECTOR;
  const WATCH_DESCRIPTION_MUTATION_SURFACE_SELECTOR = [
    DESCRIPTION_TEXT_ROOT_SELECTOR,
    "ytd-watch-flexy ytd-video-primary-info-renderer",
  ].join(",");
  const DYNAMIC_MUTATION_SURFACE_SELECTOR = [
    TOPBAR_DYNAMIC_MUTATION_SURFACE_SELECTOR,
    FEED_DYNAMIC_MUTATION_SURFACE_SELECTOR,
    SHORTS_DYNAMIC_MUTATION_SURFACE_SELECTOR,
    WATCH_PRIMARY_ACTION_MUTATION_SURFACE_SELECTOR,
    WATCH_ACTION_MENU_MUTATION_SURFACE_SELECTOR,
    WATCH_INFO_TEXT_SELECTOR,
    WATCH_DESCRIPTION_MUTATION_SURFACE_SELECTOR,
  ].join(",");
  const QUALITY_LEVELS_HIGH_TO_LOW = [
    "highres",
    "hd4320",
    "hd2880",
    "hd2160",
    "hd1440",
    "hd1080",
    "hd720",
    "large",
    "medium",
    "small",
    "tiny",
  ];
  const PLAYER_LAYOUT_REFRESH_DELAYS_MS = [0, 100, 500, 1200];

  let applyFrame = 0;
  const pendingApplyRoots = new Set();
  let legacyActionHiddenCleared = false;
  let theaterModeUserDisabled = false;
  let highestQualityVideoKey = "";
  let highestQualityRetryTimers = [];
  let theaterModeAttemptKey = "";
  let playerLayoutRefreshFrame = 0;
  const playerLayoutRefreshAttemptTimers = new Map();
  let liveChatCollapseAttemptTimers = [];
  let liveChatCollapsePendingTimer = 0;
  let pendingLiveChatFrame = null;
  let rightButtonHeldOnPlayer = false;
  let contextMenuSuppressionExpiresAt = 0;
  let volumeOverlayHideTimer = 0;

  function isWatchPath() {
    return (
      location.pathname === WATCH_PATHS[0] ||
      location.pathname.startsWith(WATCH_PATHS[1])
    );
  }

  function isShortsPath() {
    return location.pathname.startsWith("/shorts/");
  }

  function isHistoryPath() {
    return location.pathname === "/feed/history";
  }

  function getFeedFilterProfileName() {
    if (location.pathname === "/" || location.pathname === "/feed/recommended") {
      return "home";
    }
    if (location.pathname === "/feed/subscriptions") {
      return "subscriptions";
    }
    if (location.pathname === "/results") {
      return "search";
    }
    if (isHistoryPath()) {
      return "history";
    }
    return "default";
  }

  function isFeedFilterEnabled(setting) {
    const profiles = CONFIG.feedFilterProfiles || {};
    const profile = profiles[getFeedFilterProfileName()] || profiles.default;
    return profile?.[setting] !== false;
  }

  function isExcludedSurface(target) {
    return Boolean(closestElement(target, EXCLUDED_SURFACE_SELECTOR));
  }

  function closestElement(target, selector) {
    if (!target) {
      return null;
    }

    const el =
      target.nodeType === Node.ELEMENT_NODE ? target : target.parentElement;
    return el ? el.closest(selector) : null;
  }

  function getShortsIdFromUrl(rawUrl) {
    let url;
    try {
      url = new URL(rawUrl, location.origin);
    } catch {
      return "";
    }

    const match = url.pathname.match(/^\/shorts\/([^/?#]+)/);
    if (!match) {
      return "";
    }

    try {
      return decodeURIComponent(match[1]);
    } catch {
      return "";
    }
  }

  function getWatchUrlForShort(shortId) {
    const url = new URL("/watch", location.origin);
    url.searchParams.set("v", shortId);
    return url.toString();
  }

  function getWatchIdFromUrl(rawUrl) {
    let url;
    try {
      url = new URL(rawUrl, location.origin);
    } catch {
      return "";
    }

    return url.pathname === "/watch" ? url.searchParams.get("v") || "" : "";
  }

  function getElementText(el) {
    return el ? el.textContent.replace(/\s+/g, " ").trim() : "";
  }

  function collectMatchingElements(root, selector) {
    const elements = new Set();
    if (!root || !root.querySelectorAll) {
      return elements;
    }

    if (root.nodeType === Node.ELEMENT_NODE && root.matches(selector)) {
      elements.add(root);
    }
    root.querySelectorAll(selector).forEach((el) => elements.add(el));
    return elements;
  }

  function useStandardMastheadLogo(root = document) {
    if (!CONFIG.useStandardMastheadLogo) {
      return;
    }

    collectMatchingElements(root, TOPBAR_LOGO_RENDERER_SELECTOR).forEach(
      (renderer) => {
        if (!renderer.logoEntity) {
          return;
        }

        try {
          // Let YouTube reveal its own logo and restore the normal Home command.
          if (typeof renderer.set === "function") {
            renderer.set("logoEntity", null);
          } else {
            renderer.logoEntity = null;
          }
        } catch {
          // YouTube may replace the component while a mutation is being handled.
        }
      },
    );
  }

  function collectOutermostMatchingElements(root, selector) {
    const elements = collectMatchingElements(root, selector);
    return Array.from(elements).filter((el) => {
      for (
        let parent = el.parentElement;
        parent;
        parent = parent.parentElement
      ) {
        if (elements.has(parent)) {
          return false;
        }
      }

      return true;
    });
  }

  function collectDescriptionTextRoots(root = document) {
    return collectOutermostMatchingElements(
      root,
      DESCRIPTION_TEXT_ROOT_SELECTOR,
    );
  }

  function convertCurrentShortsPage() {
    if (!CONFIG.convertShortsToWatch || !isShortsPath()) {
      return;
    }

    const shortId = getShortsIdFromUrl(location.href);
    if (!shortId) {
      return;
    }

    location.replace(getWatchUrlForShort(shortId));
  }

  function rewriteShortsLinks(root = document) {
    if (!CONFIG.convertShortsToWatch) {
      return;
    }

    // YouTube recycles feed anchors. Keep a converted marker only while its
    // current /watch target still represents the same Short.
    collectMatchingElements(root, SHORTS_CONVERTED_LINK_SELECTOR).forEach(
      (link) => {
        const convertedId = link.getAttribute(SHORTS_CONVERTED_ATTRIBUTE) || "";
        const watchId = getWatchIdFromUrl(
          link.href || link.getAttribute("href"),
        );
        if (!convertedId || watchId !== convertedId) {
          link.removeAttribute(SHORTS_CONVERTED_ATTRIBUTE);
        }
      },
    );

    collectMatchingElements(root, SHORTS_LINK_SELECTOR).forEach((link) => {
      if (isExcludedSurface(link)) {
        return;
      }

      const shortId = getShortsIdFromUrl(
        link.href || link.getAttribute("href"),
      );
      if (!shortId) {
        return;
      }

      link.setAttribute(SHORTS_CONVERTED_ATTRIBUTE, shortId);
      link.href = getWatchUrlForShort(shortId);
    });
  }

  function handleShortsClick(event) {
    if (!CONFIG.convertShortsToWatch) {
      return;
    }

    const link = closestElement(event.target, SHORTS_LINK_SELECTOR);
    if (!link || isExcludedSurface(link)) {
      return;
    }

    const shortId = getShortsIdFromUrl(link.href || link.getAttribute("href"));
    if (!shortId) {
      return;
    }

    const watchUrl = getWatchUrlForShort(shortId);
    link.setAttribute(SHORTS_CONVERTED_ATTRIBUTE, shortId);
    link.href = watchUrl;

    const opensOutsideCurrentTab =
      event.defaultPrevented ||
      event.button !== 0 ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      event.altKey ||
      link.hasAttribute("download") ||
      (link.target && link.target.toLowerCase() !== "_self");
    if (opensOutsideCurrentTab) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    location.assign(watchUrl);
  }

  function hasUpcomingStreamBadge(card) {
    return Array.from(
      card.querySelectorAll(UPCOMING_STREAM_BADGE_SELECTOR),
    ).some((el) => {
      const text = getElementText(el);
      const label = el.getAttribute("aria-label") || "";
      return /^Upcoming$/i.test(text) || /^Upcoming$/i.test(label);
    });
  }

  function isUpcomingStreamCard(card) {
    if (!card || isExcludedSurface(card)) {
      return false;
    }

    const text = getElementText(card);
    return (
      hasUpcomingStreamBadge(card) ||
      /\bScheduled for\b/i.test(text) ||
      (/\bNotify me\b/i.test(text) && /\b(waiting|Scheduled)\b/i.test(text))
    );
  }

  function setCardHidden(card, datasetKey, hidden) {
    const container =
      closestElement(card, FEED_CARD_CONTAINER_SELECTOR) || card;

    if (hidden) {
      if (container.dataset[datasetKey] !== "1") {
        container.dataset[datasetKey] = "1";
      }
    } else if (container.dataset[datasetKey] === "1") {
      delete container.dataset[datasetKey];
    } else {
      return;
    }

  }

  function hideMatchingCards(root, enabled, selector, datasetKey, predicate) {
    const attribute = CARD_HIDE_ATTRIBUTES[datasetKey];
    const markerSelector = attribute ? `[${attribute}="1"]` : "";
    const candidates = collectMatchingElements(root, selector);

    if (markerSelector) {
      collectMatchingElements(root, markerSelector).forEach((card) =>
        candidates.add(card),
      );
      const rootElement =
        root?.nodeType === Node.ELEMENT_NODE ? root : null;
      const closestMarkedCard = rootElement?.closest?.(markerSelector);
      if (closestMarkedCard) {
        candidates.add(closestMarkedCard);
      }
    }

    if (!enabled) {
      candidates.forEach((card) => setCardHidden(card, datasetKey, false));
      return;
    }

    candidates.forEach((card) => {
      setCardHidden(card, datasetKey, predicate(card));
    });
  }

  function hideUpcomingStreams(root = document) {
    hideMatchingCards(
      root,
      CONFIG.hideUpcomingStreams && isFeedFilterEnabled("upcomingStreams"),
      UPCOMING_STREAM_SCAN_SELECTOR,
      "ytpplUpcomingHidden",
      isUpcomingStreamCard,
    );
  }

  function hasPayToWatchText(card) {
    const candidates = new Set();
    if (card.matches(PAY_TO_WATCH_TEXT_SELECTOR)) {
      candidates.add(card);
    }
    card
      .querySelectorAll(PAY_TO_WATCH_TEXT_SELECTOR)
      .forEach((el) => candidates.add(el));

    return Array.from(candidates).some((el) => {
      const text = getElementText(el);
      const label = el.getAttribute("aria-label") || "";
      return /\bPay to watch\b/i.test(text) || /\bPay to watch\b/i.test(label);
    });
  }

  function isPayToWatchCard(card) {
    if (!card || isExcludedSurface(card)) {
      return false;
    }
    return hasPayToWatchText(card);
  }

  function hidePayToWatchCards(root = document) {
    hideMatchingCards(
      root,
      CONFIG.hidePayToWatchCards && isFeedFilterEnabled("payToWatchCards"),
      PAY_TO_WATCH_SCAN_SELECTOR,
      "ytpplPayToWatchHidden",
      isPayToWatchCard,
    );
  }

  // YouTube uses several thumbnail progress renderers; keep this layered from
  // explicit values to measured width.
  function parsePercentFromText(text) {
    const match = String(text || "").match(/\b(\d+(?:\.\d+)?)\s*%/);
    return match ? Number(match[1]) : null;
  }

  function parseScaleXPercent(text) {
    const match = String(text || "").match(/scaleX\((\d*\.?\d+)\)/i);
    if (!match) {
      return null;
    }

    const value = Number(match[1]);
    if (!Number.isFinite(value)) {
      return null;
    }

    return value <= 1 ? value * 100 : value;
  }

  function parseProgressValue(value, max = 100) {
    if (value === null || value === "") {
      return null;
    }

    const number = Number(value);
    const maximum = Number(max) || 100;
    if (!Number.isFinite(number) || number < 0 || maximum <= 0) {
      return null;
    }

    return clamp((number / maximum) * 100, 0, 100);
  }

  function getInlineWidthPercent(el) {
    const width = parsePercentFromText(el.style && el.style.width);
    if (width !== null) {
      return width;
    }

    const style = el.getAttribute("style");
    const styleWidth = parsePercentFromText(style);
    if (styleWidth !== null) {
      return styleWidth;
    }

    return parseScaleXPercent((el.style && el.style.transform) || style);
  }

  function getAttributeProgressPercent(el) {
    const value = parseProgressValue(
      el.getAttribute("aria-valuenow"),
      el.getAttribute("aria-valuemax"),
    );
    if (value !== null) {
      return value;
    }

    return parseProgressValue(el.getAttribute("value"), el.getAttribute("max"));
  }

  function getMeasuredWidthPercent(el) {
    const parent = el.parentElement;
    if (!parent) {
      return null;
    }

    const rect = el.getBoundingClientRect();
    const parentRect = parent.getBoundingClientRect();
    if (!rect.width || !parentRect.width) {
      return null;
    }

    return clamp((rect.width / parentRect.width) * 100, 0, 100);
  }

  function getWatchedProgressPercent(progressEl) {
    const candidates = [];
    if (progressEl.matches(WATCHED_PROGRESS_VALUE_SELECTOR)) {
      candidates.push(progressEl);
    }
    candidates.push(
      ...progressEl.querySelectorAll(WATCHED_PROGRESS_VALUE_SELECTOR),
    );

    for (const candidate of candidates) {
      const attributeProgress = getAttributeProgressPercent(candidate);
      if (attributeProgress !== null) {
        return attributeProgress;
      }

      const width = getInlineWidthPercent(candidate);
      if (width !== null) {
        return width;
      }

      const label = [
        candidate.getAttribute("aria-label"),
        candidate.getAttribute("title"),
      ].join(" ");
      const labelledPercent = parsePercentFromText(label);
      if (labelledPercent !== null) {
        return labelledPercent;
      }
    }

    const containerLabel = [
      progressEl.getAttribute("aria-label"),
      progressEl.getAttribute("title"),
    ].join(" ");
    const containerLabelledPercent = parsePercentFromText(containerLabel);
    if (containerLabelledPercent !== null) {
      return containerLabelledPercent;
    }

    const containerAttributeProgress = getAttributeProgressPercent(progressEl);
    if (containerAttributeProgress !== null) {
      return containerAttributeProgress;
    }

    return candidates.length ? getMeasuredWidthPercent(candidates[0]) : null;
  }

  function isWatchedVideoCard(card) {
    if (!card || isExcludedSurface(card)) {
      return false;
    }

    const threshold = clamp(CONFIG.watchedVideoThresholdPercent, 1, 100);
    return Array.from(card.querySelectorAll(WATCHED_PROGRESS_SELECTOR)).some(
      (progressEl) => {
        const progress = getWatchedProgressPercent(progressEl);
        return progress !== null && progress >= threshold;
      },
    );
  }

  function hideWatchedVideos(root = document) {
    if (isHistoryPath()) {
      hideMatchingCards(
        root,
        false,
        WATCHED_VIDEO_SCAN_SELECTOR,
        "ytpplWatchedHidden",
        isWatchedVideoCard,
      );
      return;
    }

    hideMatchingCards(
      root,
      CONFIG.hideWatchedVideos && isFeedFilterEnabled("watchedVideos"),
      WATCHED_VIDEO_SCAN_SELECTOR,
      "ytpplWatchedHidden",
      isWatchedVideoCard,
    );
  }

  function clearLegacyHiddenWatchActionButtons(root = document) {
    if (legacyActionHiddenCleared) {
      return;
    }

    legacyActionHiddenCleared = true;
    clearHiddenWatchActionItems(root);
  }

  function clearHiddenWatchActionItems(root = document) {
    collectMatchingElements(root, WATCH_ACTION_HIDDEN_SELECTOR).forEach(
      (actionElement) => setWatchActionHidden(actionElement, false),
    );
  }

  function createRestoredActionIcon(restoredClassName, pathData) {
    const icon = document.createElement("div");
    icon.className = [
      "ytSpecButtonShapeNextIcon",
      "ytSpecButtonShapeNextElevatedContent",
      restoredClassName,
    ].join(" ");
    icon.setAttribute("aria-hidden", "true");

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("focusable", "false");

    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", pathData);
    svg.appendChild(path);
    icon.appendChild(svg);

    return icon;
  }

  function createRestoredLikeIcon() {
    return createRestoredActionIcon(
      RESTORED_LIKE_ICON_CLASS,
      "M14 9V5a2 2 0 0 0-2-2l-4 7v11h9.5a2 2 0 0 0 1.92-1.44l2.33-8A2 2 0 0 0 19.83 9H14ZM8 21H5.3A2.3 2.3 0 0 1 3 18.7v-6.4A2.3 2.3 0 0 1 5.3 10H8",
    );
  }

  function createRestoredDislikeIcon() {
    return createRestoredActionIcon(
      RESTORED_DISLIKE_ICON_CLASS,
      "M10 15v4a2 2 0 0 0 2 2l4-7V3H6.5a2 2 0 0 0-1.92 1.44l-2.33 8A2 2 0 0 0 4.17 15H10ZM16 3h2.7A2.3 2.3 0 0 1 21 5.3v6.4a2.3 2.3 0 0 1-2.3 2.3H16",
    );
  }

  function createRydTextContainer(text) {
    const source = document.querySelector(RYD_LIKE_TEXT_SELECTOR);
    const textContainer = source
      ? source.cloneNode(true)
      : document.createElement("div");

    if (!source) {
      textContainer.className = [
        "ytSpecButtonShapeNextButtonTextContent",
        "ytSpecButtonShapeNextElevatedContent",
      ].join(" ");
    }

    textContainer.textContent = text || "";
    return textContainer;
  }

  function removeDirectTextNodes(el) {
    Array.from(el.childNodes).forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        node.remove();
      }
    });
  }

  function applyRydIconLeadingClasses(button) {
    const iconButtonClasses = [
      "ytSpecButtonShapeNextIconButton",
      "yt-spec-button-shape-next--icon-button",
    ];
    const iconLeadingClasses = [
      "ytSpecButtonShapeNextIconLeading",
      "yt-spec-button-shape-next--icon-leading",
    ];

    if (
      iconButtonClasses.some((className) =>
        button.classList.contains(className),
      )
    ) {
      button.classList.remove(...iconButtonClasses);
    }
    if (
      iconLeadingClasses.some(
        (className) => !button.classList.contains(className),
      )
    ) {
      button.classList.add(...iconLeadingClasses);
    }
  }

  function hasRydIconGraphic(icon) {
    return (
      Array.from(icon.querySelectorAll("path")).some((path) =>
        getNormalisedLabel(path.getAttribute("d")),
      ) ||
      Array.from(icon.querySelectorAll("use")).some((use) =>
        getNormalisedLabel(
          use.getAttribute("href") || use.getAttribute("xlink:href"),
        ),
      ) ||
      Boolean(
        icon.querySelector("polygon[points], polyline[points], circle, rect"),
      )
    );
  }

  function hasRenderedRydIcon(icon) {
    const style = getComputedStyle(icon);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      Number(style.opacity) === 0
    ) {
      return false;
    }

    const rect = icon.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function isUsableRydIcon(icon) {
    return hasRydIconGraphic(icon) && hasRenderedRydIcon(icon);
  }

  function setEmptyRydIconState(icon, empty) {
    if (empty) {
      if (icon.getAttribute(EMPTY_RYD_ICON_ATTRIBUTE) !== "1") {
        icon.setAttribute(EMPTY_RYD_ICON_ATTRIBUTE, "1");
      }
      return;
    }

    if (icon.getAttribute(EMPTY_RYD_ICON_ATTRIBUTE) === "1") {
      icon.removeAttribute(EMPTY_RYD_ICON_ATTRIBUTE);
    }
  }

  function ensureRydButtonIcon(button, createIcon, restoredClassName) {
    const restoredIcon = button.querySelector(`.${restoredClassName}`);
    if (restoredIcon) {
      setEmptyRydIconState(restoredIcon, false);
      return;
    }

    const nativeIcons = Array.from(button.querySelectorAll(RYD_ICON_SELECTOR));
    const hasUsableNativeIcon = nativeIcons.some((icon) => {
      const isRestoredIcon = icon.matches(
        `.${RESTORED_LIKE_ICON_CLASS}, .${RESTORED_DISLIKE_ICON_CLASS}`,
      );
      const isUsable = !isRestoredIcon && isUsableRydIcon(icon);
      setEmptyRydIconState(icon, !isUsable);
      return isUsable;
    });

    if (!hasUsableNativeIcon) {
      button.insertBefore(createIcon(), button.firstChild);
    }
  }

  function normaliseRydLikeButton(button) {
    if (!button || closestElement(button, EXCLUDED_SURFACE_SELECTOR)) {
      return;
    }

    const hasText =
      button.querySelector(RYD_TEXT_CONTAINER_SELECTOR) ||
      getNormalisedLabel(button.innerText);

    ensureRydButtonIcon(
      button,
      createRestoredLikeIcon,
      RESTORED_LIKE_ICON_CLASS,
    );
    if (hasText) {
      applyRydIconLeadingClasses(button);
    }
  }

  function normaliseRydDislikeButton(button) {
    if (!button || closestElement(button, EXCLUDED_SURFACE_SELECTOR)) {
      return;
    }

    const existingText = getNormalisedLabel(button.innerText);
    let textContainer = button.querySelector(RYD_TEXT_CONTAINER_SELECTOR);
    if (textContainer && textContainer.matches("button")) {
      textContainer = null;
    }

    ensureRydButtonIcon(
      button,
      createRestoredDislikeIcon,
      RESTORED_DISLIKE_ICON_CLASS,
    );

    if (!textContainer) {
      button.appendChild(createRydTextContainer(existingText));
      removeDirectTextNodes(button);
    }

    applyRydIconLeadingClasses(button);
  }

  function hasRydLikeButtonLabel(button) {
    return getWatchActionLabels(button).some((label) => {
      return (
        /^(?:Like|Unlike)\b/i.test(label) ||
        /\bI like\b/i.test(label) ||
        /\bLike this\b/i.test(label)
      );
    });
  }

  function normaliseReturnYoutubeLikeButtons(root = document) {
    const buttons = collectMatchingElements(root, RYD_LIKE_BUTTON_SELECTOR);
    collectMatchingElements(root, RYD_WATCH_ACTION_BUTTON_SELECTOR).forEach(
      (button) => {
        if (hasRydLikeButtonLabel(button)) {
          buttons.add(button);
        }
      },
    );

    buttons.forEach(normaliseRydLikeButton);
  }

  function normaliseReturnYoutubeDislikeButtons(root = document) {
    collectMatchingElements(root, RYD_DISLIKE_BUTTON_SELECTOR).forEach(
      normaliseRydDislikeButton,
    );
  }

  function getNormalisedLabel(text) {
    return String(text || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function getWatchActionLabels(actionElement) {
    const labelledElements = new Set([actionElement]);
    actionElement
      .querySelectorAll("button, [aria-label], [title]")
      .forEach((el) => labelledElements.add(el));

    const labels = [];
    labelledElements.forEach((el) => {
      labels.push(el.getAttribute("aria-label"));
      labels.push(el.getAttribute("title"));
    });
    labels.push(actionElement.innerText);
    labels.push(getElementText(actionElement));

    return labels.map(getNormalisedLabel).filter(Boolean);
  }

  function isPreservedWatchActionButton(buttonModel) {
    return Boolean(
      buttonModel.matches(WATCH_ACTION_PRESERVE_SELECTOR) ||
      closestElement(buttonModel, WATCH_ACTION_PRESERVE_SELECTOR),
    );
  }

  function isWatchActionMatch(actionElement, label) {
    const normalisedLabel = label.toLowerCase();

    return getWatchActionLabels(actionElement).some((candidate) => {
      const normalisedCandidate = candidate.toLowerCase();
      return (
        normalisedCandidate === normalisedLabel ||
        normalisedCandidate.startsWith(`${normalisedLabel} `)
      );
    });
  }

  function setWatchActionHidden(actionElement, hidden) {
    if (hidden) {
      if (
        actionElement.dataset[WATCH_ACTION_HIDDEN_DATASET_KEY] !==
        WATCH_ACTION_HIDDEN_VALUE
      ) {
        actionElement.dataset[WATCH_ACTION_HIDDEN_DATASET_KEY] =
          WATCH_ACTION_HIDDEN_VALUE;
      }
      if (!actionElement.hidden) {
        actionElement.hidden = true;
      }
      return;
    }

    if (
      actionElement.dataset[WATCH_ACTION_HIDDEN_DATASET_KEY] !==
      WATCH_ACTION_HIDDEN_VALUE
    ) {
      return;
    }

    delete actionElement.dataset[WATCH_ACTION_HIDDEN_DATASET_KEY];
    if (actionElement.hidden) {
      actionElement.hidden = false;
    }
  }

  function getWatchActionMenuItemContainer(menuItem) {
    return (
      closestElement(menuItem, WATCH_ACTION_MENU_ITEM_RENDERER_SELECTOR) ||
      closestElement(menuItem, WATCH_ACTION_MENU_ITEM_FALLBACK_SELECTOR) ||
      menuItem
    );
  }

  function isConfiguredWatchActionMatch(actionElement) {
    return WATCH_ACTION_BUTTON_RULES.some(
      ({ configKey, label }) =>
        CONFIG[configKey] && isWatchActionMatch(actionElement, label),
    );
  }

  function isConfiguredInlineWatchActionMatch(actionElement) {
    return WATCH_ACTION_INLINE_BUTTON_RULES.some(
      ({ configKey, label }) =>
        CONFIG[configKey] && isWatchActionMatch(actionElement, label),
    );
  }

  function hideWatchActionButtons(root = document) {
    collectMatchingElements(root, WATCH_ACTION_BUTTON_SELECTOR).forEach(
      (buttonModel) => {
        if (isPreservedWatchActionButton(buttonModel)) {
          setWatchActionHidden(buttonModel, false);
          return;
        }

        setWatchActionHidden(
          buttonModel,
          isConfiguredWatchActionMatch(buttonModel) ||
            isConfiguredInlineWatchActionMatch(buttonModel),
        );
      },
    );
  }

  function hideWatchActionMenuItems(root = document) {
    if (!isWatchPath()) {
      // YouTube reuses popup menu elements between SPA routes. Remove this
      // script's watch-page marker before a recycled item becomes a feed action.
      clearHiddenWatchActionItems(root);
      return;
    }

    const menuItems = new Set();
    collectMatchingElements(root, WATCH_ACTION_MENU_ITEM_SELECTOR).forEach(
      (menuItem) => {
        menuItems.add(getWatchActionMenuItemContainer(menuItem));
      },
    );

    menuItems.forEach((menuItem) => {
      setWatchActionHidden(menuItem, isConfiguredWatchActionMatch(menuItem));
    });
  }

  function getPreviousNonWhitespaceSibling(node) {
    let previous = node && node.previousSibling;
    while (
      previous &&
      previous.nodeType === Node.TEXT_NODE &&
      !previous.textContent.trim()
    ) {
      previous = previous.previousSibling;
    }

    return previous;
  }

  function removeTrailingBreakAfter(node) {
    let next = node && node.nextSibling;
    const blankTextNodes = [];
    while (
      next &&
      next.nodeType === Node.TEXT_NODE &&
      !next.textContent.trim()
    ) {
      blankTextNodes.push(next);
      next = next.nextSibling;
    }

    if (
      next &&
      next.nodeType === Node.ELEMENT_NODE &&
      ["BR", "WBR"].includes(next.tagName)
    ) {
      blankTextNodes.forEach((textNode) => textNode.remove());
      next.remove();
    }
  }

  function collapseDuplicateBreakBefore(node) {
    const previous = getPreviousNonWhitespaceSibling(node);
    const previousPrevious = getPreviousNonWhitespaceSibling(previous);

    if (
      previous &&
      previousPrevious &&
      previous.nodeType === Node.ELEMENT_NODE &&
      previousPrevious.nodeType === Node.ELEMENT_NODE &&
      ["BR", "WBR"].includes(previous.tagName) &&
      ["BR", "WBR"].includes(previousPrevious.tagName)
    ) {
      previous.remove();
    }
  }

  function removeHashtagOnlyRowBreaks(node) {
    removeTrailingBreakAfter(node);
    collapseDuplicateBreakBefore(node);
  }

  function isEmptyHashtagWrapper(el) {
    return (
      el &&
      el.nodeType === Node.ELEMENT_NODE &&
      !el.matches(HASHTAG_EMPTY_ANCESTOR_STOP_SELECTOR) &&
      !getElementText(el) &&
      !el.querySelector(
        [
          "a:not([data-ytppl-hashtag-removed])",
          "button",
          "img",
          "svg",
          "video",
        ].join(","),
      )
    );
  }

  function removeEmptyHashtagWrappers(startEl) {
    let el = startEl;
    while (isEmptyHashtagWrapper(el)) {
      const parent = el.parentElement;
      removeHashtagOnlyRowBreaks(el);
      el.remove();
      el = parent;
    }
  }

  function removeHashtagLink(link) {
    if (!link || link.dataset.ytpplHashtagRemoved === "1") {
      return;
    }

    const parent = link.parentElement;
    link.dataset.ytpplHashtagRemoved = "1";
    removeHashtagOnlyRowBreaks(link);
    link.remove();
    removeEmptyHashtagWrappers(parent);
  }

  function cleanHashtagText(text) {
    const outputLines = [];
    let removedHashtagOnlyLine = false;

    String(text || "")
      .split(/\r?\n/)
      .forEach((line) => {
        if (HASHTAG_ONLY_LINE_PATTERN.test(line)) {
          removedHashtagOnlyLine = true;
          return;
        }

        const cleanedLine = line
          .replace(HASHTAG_TEXT_PATTERN, "$1")
          .replace(/[ \t]{2,}/g, " ")
          .trimEnd();

        if (!cleanedLine.trim()) {
          if (!removedHashtagOnlyLine) {
            outputLines.push(cleanedLine);
          }
          return;
        }

        if (
          removedHashtagOnlyLine &&
          outputLines.length &&
          !outputLines[outputLines.length - 1].trim()
        ) {
          outputLines.pop();
        }

        outputLines.push(cleanedLine);
        removedHashtagOnlyLine = false;
      });

    if (
      removedHashtagOnlyLine &&
      outputLines.length &&
      !outputLines[outputLines.length - 1].trim()
    ) {
      outputLines.pop();
    }

    return outputLines.join("\n").trimEnd();
  }

  function removeHashtagTextNode(node) {
    if (!node || !HASHTAG_TEXT_TEST_PATTERN.test(node.textContent || "")) {
      return;
    }

    const cleanedText = cleanHashtagText(node.textContent);
    if (cleanedText) {
      node.textContent = cleanedText;
      return;
    }

    const parent = node.parentElement;
    removeHashtagOnlyRowBreaks(node);
    node.remove();
    removeEmptyHashtagWrappers(parent);
  }

  function removeHashtagText(root = document) {
    collectDescriptionTextRoots(root).forEach((container) => {
      const textNodes = [];
      const walker = document.createTreeWalker(
        container,
        NodeFilter.SHOW_TEXT,
        {
          acceptNode(node) {
            return HASHTAG_TEXT_TEST_PATTERN.test(node.textContent || "")
              ? NodeFilter.FILTER_ACCEPT
              : NodeFilter.FILTER_REJECT;
          },
        },
      );

      while (walker.nextNode()) {
        textNodes.push(walker.currentNode);
      }

      textNodes.forEach(removeHashtagTextNode);
    });
  }

  function isDescriptionBreakElement(node) {
    return (
      node &&
      node.nodeType === Node.ELEMENT_NODE &&
      ["BR", "WBR"].includes(node.tagName)
    );
  }

  function isDescriptionSeparatorTextNode(node) {
    const text = node && node.textContent;
    return (
      node &&
      node.nodeType === Node.TEXT_NODE &&
      DESCRIPTION_SEPARATOR_TEXT_ONLY_PATTERN.test(text || "") &&
      (DESCRIPTION_SEPARATOR_TEXT_PATTERN.test(text || "") ||
        text.includes("\u00a0"))
    );
  }

  function isDescriptionWhitespaceOnlyElement(node) {
    return (
      node &&
      node.nodeType === Node.ELEMENT_NODE &&
      !isDescriptionBreakElement(node) &&
      !closestElement(node, DESCRIPTION_CONTROL_SELECTOR) &&
      DESCRIPTION_SEPARATOR_TEXT_ONLY_PATTERN.test(node.textContent || "") &&
      !node.querySelector("a[href], button, img, svg, video, yt-img-shadow")
    );
  }

  function isDescriptionLineSeparatorNode(node) {
    return (
      (node &&
        node.nodeType === Node.ELEMENT_NODE &&
        node.tagName === "BR") ||
      (node &&
        DESCRIPTION_SEPARATOR_TEXT_PATTERN.test(node.textContent || ""))
    );
  }

  function isDescriptionWhitespaceTextNode(node) {
    return (
      node &&
      node.nodeType === Node.TEXT_NODE &&
      DESCRIPTION_SEPARATOR_TEXT_ONLY_PATTERN.test(node.textContent || "")
    );
  }

  function isDescriptionSeparatorNode(node) {
    return (
      isDescriptionBreakElement(node) ||
      isDescriptionSeparatorTextNode(node) ||
      (isDescriptionWhitespaceOnlyElement(node) &&
        (isDescriptionLineSeparatorNode(node) ||
          node.textContent.includes("\u00a0")))
    );
  }

  function getDescriptionSeparatorBreakCount(node) {
    const text = node && node.textContent;
    if (!node) {
      return 0;
    }

    if (node.nodeType === Node.ELEMENT_NODE && node.tagName === "BR") {
      return 1;
    }

    const lineBreaks = String(text || "").match(/\r\n|\r|\n/g);
    if (lineBreaks) {
      return lineBreaks.length;
    }

    const nbspMatches = String(text || "").match(/\u00a0/g);
    return nbspMatches ? nbspMatches.length : 0;
  }

  function getDescriptionSeparatorReplacement(separatorRun) {
    const breakCount = separatorRun.reduce(
      (count, node) => count + getDescriptionSeparatorBreakCount(node),
      0,
    );
    const hasLineBreak = separatorRun.some(isDescriptionLineSeparatorNode);

    if (!hasLineBreak && breakCount < 2) {
      return null;
    }

    return breakCount > 1 ? "\n\n" : "\n";
  }

  function hasMeaningfulDescriptionNode(node) {
    if (!node || closestElement(node, DESCRIPTION_CONTROL_SELECTOR)) {
      return false;
    }

    if (node.nodeType === Node.TEXT_NODE) {
      return Boolean(node.textContent.replace(/\u00a0/g, " ").trim());
    }

    if (node.nodeType !== Node.ELEMENT_NODE || isDescriptionBreakElement(node)) {
      return false;
    }

    return Boolean(
      getElementText(node) ||
        node.querySelector("a[href], img, video, yt-img-shadow"),
    );
  }

  function cleanDescriptionBlankLineText(text) {
    return String(text || "").replace(
      DESCRIPTION_REPEATED_BLANK_LINE_PATTERN,
      "\n\n",
    );
  }

  function normaliseDescriptionBlankLineTextNode(node) {
    if (!node || isDescriptionSeparatorTextNode(node)) {
      return;
    }

    const text = node.textContent || "";
    const cleanedText = cleanDescriptionBlankLineText(text);
    if (cleanedText !== text) {
      node.textContent = cleanedText;
    }
  }

  function normaliseDescriptionKeptSeparator(node, replacementText) {
    if (node.nodeType === Node.TEXT_NODE) {
      if (node.textContent !== replacementText) {
        node.textContent = replacementText;
      }
      return node;
    }

    if (isDescriptionWhitespaceOnlyElement(node)) {
      const onlyChild = node.firstChild;
      const alreadyNormalised =
        node.childNodes.length === 1 &&
        onlyChild.nodeType === Node.TEXT_NODE &&
        onlyChild.textContent === replacementText;

      if (!alreadyNormalised) {
        node.textContent = replacementText;
      }
      return node;
    }

    if (!node.parentNode) {
      return node;
    }

    const textNode = document.createTextNode(replacementText);
    node.parentNode.insertBefore(textNode, node);
    node.remove();
    return textNode;
  }

  function normaliseDescriptionSeparatorRun(separatorRun, keepOne) {
    if (!separatorRun.length) {
      return;
    }

    const keeper =
      separatorRun.find(isDescriptionLineSeparatorNode) || separatorRun[0];

    if (keepOne) {
      const replacementText =
        getDescriptionSeparatorReplacement(separatorRun);
      if (replacementText) {
        normaliseDescriptionKeptSeparator(keeper, replacementText);
      }
    } else {
      keeper.remove();
    }

    separatorRun.forEach((node) => {
      if (node !== keeper) {
        node.remove();
      }
    });
  }

  function normaliseDescriptionChildSeparators(parent) {
    let separatorRun = [];
    let seenContent = false;

    Array.from(parent.childNodes).forEach((node) => {
      if (
        isDescriptionSeparatorNode(node) ||
        (separatorRun.length &&
          (isDescriptionWhitespaceTextNode(node) ||
            isDescriptionWhitespaceOnlyElement(node)))
      ) {
        separatorRun.push(node);
        return;
      }

      normaliseDescriptionSeparatorRun(
        separatorRun,
        seenContent && hasMeaningfulDescriptionNode(node),
      );
      separatorRun = [];

      if (
        node.nodeType === Node.ELEMENT_NODE &&
        !closestElement(node, DESCRIPTION_CONTROL_SELECTOR)
      ) {
        normaliseDescriptionChildSeparators(node);
      }

      if (hasMeaningfulDescriptionNode(node)) {
        seenContent = true;
      }
    });

    normaliseDescriptionSeparatorRun(separatorRun, false);
  }

  function normaliseDescriptionBlankRows(root = document) {
    if (!CONFIG.collapseDescriptionBlankRows || !isWatchPath()) {
      return;
    }

    collectDescriptionTextRoots(root).forEach((container) => {
      const textNodes = [];
      const walker = document.createTreeWalker(
        container,
        NodeFilter.SHOW_TEXT,
        {
          acceptNode(node) {
            DESCRIPTION_REPEATED_BLANK_LINE_PATTERN.lastIndex = 0;
            return DESCRIPTION_REPEATED_BLANK_LINE_PATTERN.test(
              node.textContent || "",
            )
              ? NodeFilter.FILTER_ACCEPT
              : NodeFilter.FILTER_REJECT;
          },
        },
      );

      while (walker.nextNode()) {
        textNodes.push(walker.currentNode);
      }

      textNodes.forEach(normaliseDescriptionBlankLineTextNode);
      normaliseDescriptionChildSeparators(container);
    });
  }

  function getMeaningfulDescriptionText(container) {
    const parts = [];
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        return closestElement(node, DESCRIPTION_CONTROL_SELECTOR)
          ? NodeFilter.FILTER_REJECT
          : NodeFilter.FILTER_ACCEPT;
      },
    });

    while (walker.nextNode()) {
      const text = walker.currentNode.textContent
        .replace(HASHTAG_TEXT_PATTERN, "$1")
        .replace(/\bShow\s+(?:less|more)\b/gi, "")
        .replace(/\s+/g, " ")
        .trim();

      if (text) {
        parts.push(text);
      }
    }

    return parts.join(" ").trim();
  }

  function hasMeaningfulExpandedDescriptionContent(expanded) {
    const textWithoutHashtags = getMeaningfulDescriptionText(expanded);

    if (textWithoutHashtags) {
      return true;
    }

    return Array.from(
      expanded.querySelectorAll(
        [
          'a:not([href^="/hashtag/"]):not([href*="youtube.com/hashtag/"])',
          "img",
          "video",
          "yt-img-shadow",
        ].join(","),
      ),
    ).some((el) => !closestElement(el, DESCRIPTION_CONTROL_SELECTOR));
  }

  function setExpandedDescriptionCollapsed(expanded, collapsed) {
    if (collapsed) {
      if (
        expanded.dataset[DESCRIPTION_EXPANDED_COLLAPSED_DATASET_KEY] !== "1"
      ) {
        expanded.dataset[DESCRIPTION_EXPANDED_COLLAPSED_DATASET_KEY] = "1";
      }
      setImportantStyleProperty(expanded, "display", "none");
      setImportantStyleProperty(expanded, "height", "0px");
      setImportantStyleProperty(expanded, "line-height", "0px");
      setImportantStyleProperty(expanded, "max-height", "0px");
      setImportantStyleProperty(expanded, "min-height", "0px");
      setImportantStyleProperty(expanded, "margin", "0px");
      setImportantStyleProperty(expanded, "overflow", "hidden");
      setImportantStyleProperty(expanded, "padding", "0px");
      return;
    }

    if (expanded.dataset[DESCRIPTION_EXPANDED_COLLAPSED_DATASET_KEY] !== "1") {
      return;
    }

    delete expanded.dataset[DESCRIPTION_EXPANDED_COLLAPSED_DATASET_KEY];
    [
      "display",
      "height",
      "line-height",
      "max-height",
      "min-height",
      "margin",
      "overflow",
      "padding",
    ].forEach((property) => expanded.style.removeProperty(property));
  }

  function setImportantStyleProperty(el, property, value) {
    if (
      el.style.getPropertyValue(property) === value &&
      el.style.getPropertyPriority(property) === "important"
    ) {
      return;
    }

    el.style.setProperty(property, value, "important");
  }

  function hasRenderedBox(el) {
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function getExpandedDescriptionHeightResetElements(expanded) {
    const elements = new Set([expanded]);

    for (
      let el = expanded.parentElement;
      el && !el.matches(DESCRIPTION_HEIGHT_RESET_STOP_SELECTOR);
      el = el.parentElement
    ) {
      if (el.matches(DESCRIPTION_HEIGHT_RESET_ANCESTOR_SELECTOR)) {
        elements.add(el);
      }
    }

    return elements;
  }

  function normaliseExpandedDescriptionHeight(expanded) {
    if (
      expanded.dataset[DESCRIPTION_EXPANDED_COLLAPSED_DATASET_KEY] === "1" ||
      !hasRenderedBox(expanded) ||
      !hasMeaningfulExpandedDescriptionContent(expanded)
    ) {
      return;
    }

    getExpandedDescriptionHeightResetElements(expanded).forEach((el) => {
      setImportantStyleProperty(el, "height", "auto");
      setImportantStyleProperty(el, "min-height", "0px");
    });
    setImportantStyleProperty(expanded, "max-height", "none");
  }

  function collapseEmptyExpandedDescriptions(root = document) {
    collectMatchingElements(root, DESCRIPTION_EXPANDED_SELECTOR).forEach(
      (expanded) => {
        const hasContent = hasMeaningfulExpandedDescriptionContent(expanded);
        setExpandedDescriptionCollapsed(expanded, !hasContent);
        if (hasContent) {
          normaliseExpandedDescriptionHeight(expanded);
        }
      },
    );
  }

  function collapseDescriptionBlankRows(root = document) {
    if (!CONFIG.collapseDescriptionBlankRows || !isWatchPath()) {
      return;
    }

    collapseEmptyExpandedDescriptions(root);
  }

  function hideHashtags(root = document) {
    if (!CONFIG.hideHashtags || !isWatchPath()) {
      return;
    }

    collectMatchingElements(root, HASHTAG_LINK_SELECTOR).forEach(
      removeHashtagLink,
    );
    removeHashtagText(root);
  }

  function runDescriptionCleanup(root = document) {
    hideHashtags(root);
    normaliseDescriptionBlankRows(root);
    collapseDescriptionBlankRows(root);
  }

  function cleanWatchInfoText(text) {
    return String(text || "")
      .replace(/\s*\u2022\s*/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function getWatchInfoFieldText(row, selector) {
    const field = row.querySelector(selector);
    if (!field) {
      return "";
    }

    return cleanWatchInfoText(
      field.getAttribute("aria-label") || field.textContent,
    );
  }

  function getWatchInfoStaticText(row) {
    const tooltipText = cleanWatchInfoText(
      row.querySelector(WATCH_INFO_TOOLTIP_SELECTOR)?.textContent,
    );
    if (tooltipText) {
      return tooltipText;
    }

    return [
      getWatchInfoFieldText(row, "#view-count"),
      getWatchInfoFieldText(row, "#date-text"),
      getWatchInfoFieldText(row, "#info"),
    ]
      .filter(Boolean)
      .join(" ");
  }

  function normaliseWatchInfoRow(row) {
    if (!row || isExcludedSurface(row)) {
      return;
    }

    let staticText = row.querySelector(`.${WATCH_INFO_STATIC_TEXT_CLASS}`);
    const nativeContainer = row.querySelector(
      WATCH_INFO_NATIVE_CONTAINER_SELECTOR,
    );
    const staticTextValue = getWatchInfoStaticText(row);
    if (!staticTextValue) {
      staticText?.remove();
      nativeContainer?.removeAttribute(WATCH_INFO_NATIVE_HIDDEN_ATTRIBUTE);
      return;
    }

    if (!staticText) {
      staticText = document.createElement("span");
      staticText.className = WATCH_INFO_STATIC_TEXT_CLASS;
      row.insertBefore(staticText, nativeContainer || row.firstChild);
    }

    if (staticText.textContent !== staticTextValue) {
      staticText.textContent = staticTextValue;
    }

    if (nativeContainer) {
      if (
        nativeContainer.getAttribute(WATCH_INFO_NATIVE_HIDDEN_ATTRIBUTE) !==
        "1"
      ) {
        nativeContainer.setAttribute(WATCH_INFO_NATIVE_HIDDEN_ATTRIBUTE, "1");
      }
    }
  }

  function normaliseWatchInfoText(root = document) {
    if (!isWatchPath()) {
      return;
    }

    collectMatchingElements(root, WATCH_INFO_TEXT_SELECTOR).forEach(
      normaliseWatchInfoRow,
    );
  }

  function buildVolumeOverlayCss() {
    return `
      .${VOLUME_OVERLAY_CLASS} {
        position: fixed !important;
        z-index: 2147483647 !important;
        min-width: 0 !important;
        padding: 0 6px !important;
        border: 0 !important;
        border-radius: 4px !important;
        box-sizing: border-box !important;
        background: transparent !important;
        box-shadow: none !important;
        color: #ffff00 !important;
        font: 700 42px/1.1 Roboto, Arial, sans-serif !important;
        letter-spacing: 0 !important;
        text-align: center !important;
        text-shadow:
          -2px -2px 0 rgba(0, 0, 0, 0.92),
          0 -2px 0 rgba(0, 0, 0, 0.95),
          2px -2px 0 rgba(0, 0, 0, 0.92),
          -2px 0 0 rgba(0, 0, 0, 0.95),
          2px 0 0 rgba(0, 0, 0, 0.95),
          -2px 2px 0 rgba(0, 0, 0, 0.92),
          0 2px 0 rgba(0, 0, 0, 0.95),
          2px 2px 0 rgba(0, 0, 0, 0.92),
          0 0 7px rgba(0, 0, 0, 1),
          0 5px 12px rgba(0, 0, 0, 0.88),
          0 14px 32px rgba(0, 0, 0, 0.76) !important;
        white-space: nowrap !important;
        opacity: 0 !important;
        pointer-events: none !important;
        transition: opacity 120ms ease-out, transform 120ms ease-out !important;
      }

      .${VOLUME_OVERLAY_CLASS}[data-visible="1"] {
        opacity: 1 !important;
      }
    `;
  }

  function buildCaptionCss() {
    if (!CONFIG.useReadableYellowCaptions) {
      return "";
    }

    // YouTube uses the same caption-segment class for the watch player and
    // inline hover previews. Change only glyph colour and shadow so native
    // sizing, positioning, typeface, background and opacity remain intact.
    return `
        .html5-video-player .ytp-caption-segment,
        ytd-video-preview .ytp-caption-segment {
          color: #ffe36e !important;
          text-shadow:
            -1px -1px 2px #000,
            1px -1px 2px #000,
            -1px 1px 2px #000,
            1px 1px 2px #000,
            0 2px 4px #000 !important;
        }
      `;
  }

  function buildShortsCss() {
    if (!CONFIG.hideShorts) {
      return "";
    }

    return `
        grid-shelf-view-model:has(ytm-shorts-lockup-view-model-v2),
        ytd-rich-section-renderer:has(ytd-rich-shelf-renderer[is-shorts]),
        ytd-rich-section-renderer:has(ytd-reel-shelf-renderer),
        ytd-rich-section-renderer:has(a[href^="/shorts/"]),
        ytd-rich-item-renderer:has(a[href^="/shorts/"]),
        ytd-rich-item-renderer:has(${SHORTS_CONVERTED_LINK_SELECTOR}),
        ytd-video-renderer:has(a[href^="/shorts/"]),
        ytd-video-renderer:has(${SHORTS_CONVERTED_LINK_SELECTOR}),
        ytd-grid-video-renderer:has(a[href^="/shorts/"]),
        ytd-grid-video-renderer:has(${SHORTS_CONVERTED_LINK_SELECTOR}),
        yt-lockup-view-model:has(${SHORTS_CONVERTED_LINK_SELECTOR}),
        yt-lockup-view-model-wiz:has(${SHORTS_CONVERTED_LINK_SELECTOR}),
        ytm-shorts-lockup-view-model:has(${SHORTS_CONVERTED_LINK_SELECTOR}),
        ytm-shorts-lockup-view-model-v2:has(${SHORTS_CONVERTED_LINK_SELECTOR}),
        ytd-reel-shelf-renderer,
        ytd-reel-item-renderer,
        ytd-shorts,
        ytd-guide-entry-renderer:has(a[title="Shorts"]),
        ytd-mini-guide-entry-renderer:has(a[title="Shorts"]) {
          display: none !important;
        }
      `;
  }

  function buildFeedCleanupCss() {
    const rules = [
      `
        ${CARD_HIDE_ATTRIBUTE_SELECTORS.map(
          (selector) =>
            `:root:not([${FILTER_REVEAL_ATTRIBUTE}="1"]) ${selector}`,
        ).join(",\n        ")} {
          display: none !important;
        }
      `,
    ];

    if (CONFIG.hideBrandVideoShelf) {
      rules.push(`
        ytd-rich-section-renderer:has(ytd-brand-video-shelf-renderer),
        ytd-brand-video-shelf-renderer {
          display: none !important;
        }
      `);
    }

    return rules.join("\n");
  }

  function buildWatchCleanupCss() {
    const rules = [];
    if (CONFIG.hideRelatedVideos) {
      rules.push(`
        ytd-watch-flexy #secondary #related {
          display: none !important;
        }
      `);
    }

    rules.push(`
        ytd-watch-flexy ytd-menu-renderer ${WATCH_ACTION_HIDDEN_SELECTOR},
        ytd-popup-container ${WATCH_ACTION_HIDDEN_SELECTOR},
        tp-yt-iron-dropdown ${WATCH_ACTION_HIDDEN_SELECTOR} {
          display: none !important;
        }

        ytd-watch-flexy ytd-menu-renderer [${EMPTY_RYD_ICON_ATTRIBUTE}="1"] {
          display: none !important;
          flex: 0 0 0 !important;
          height: 0 !important;
          margin: 0 !important;
          min-width: 0 !important;
          opacity: 0 !important;
          overflow: hidden !important;
          padding: 0 !important;
          visibility: hidden !important;
          width: 0 !important;
        }

        ytd-watch-flexy ytd-menu-renderer .${RESTORED_LIKE_ICON_CLASS},
        ytd-watch-flexy ytd-menu-renderer .${RESTORED_DISLIKE_ICON_CLASS} {
          align-items: center !important;
          display: flex !important;
          flex: 0 0 24px !important;
          height: 24px !important;
          justify-content: center !important;
          opacity: 1 !important;
          visibility: visible !important;
          width: 24px !important;
        }

        ytd-watch-flexy ytd-menu-renderer .${RESTORED_LIKE_ICON_CLASS} svg,
        ytd-watch-flexy ytd-menu-renderer .${RESTORED_DISLIKE_ICON_CLASS} svg {
          display: block !important;
          fill: none !important;
          height: 24px !important;
          stroke: currentColor !important;
          stroke-linecap: round !important;
          stroke-linejoin: round !important;
          stroke-width: 1.8 !important;
          width: 24px !important;
        }

        ytd-watch-flexy ytd-menu-renderer
        :is(
          #segmented-like-button,
          like-button-view-model,
          #like-button
        )
        :is(
          button[aria-pressed="true"],
          button[aria-label^="Unlike" i],
          button[title^="Unlike" i]
        ) {
          background-color: rgba(62, 166, 255, 0.18) !important;
          box-shadow: inset 0 0 0 1px rgba(62, 166, 255, 0.65) !important;
          color: #3ea6ff !important;
        }

        ytd-watch-flexy ytd-menu-renderer
        :is(#segmented-like-button, #segmented-dislike-button)
        button
        :is(
          .ytSpecButtonShapeNextButtonTextContent,
          .yt-spec-button-shape-next__button-text-content
        ) {
          align-items: center !important;
          align-self: center !important;
          display: inline-flex !important;
          height: 24px !important;
          line-height: 24px !important;
          transform: none !important;
          vertical-align: middle !important;
        }
      `);

    if (CONFIG.hideMerchShelf) {
      rules.push(`
        ytd-watch-flexy ytd-merch-shelf-renderer {
          display: none !important;
        }
      `);
    }

    if (CONFIG.hideJoinButton) {
      rules.push(`
        ytd-watch-flexy ytd-video-owner-renderer #sponsor-button,
        ytd-watch-flexy ytd-video-owner-renderer yt-button-view-model:has(a[href*="/channel/"][href*="/join"]),
        ytd-watch-flexy ytd-video-owner-renderer button-view-model:has(a[href*="/channel/"][href*="/join"]) {
          display: none !important;
        }
      `);
    }

    if (CONFIG.hideStatementBanners) {
      rules.push(`
        ytd-watch-flexy ytd-statement-banner-renderer,
        ytd-watch-flexy yt-statement-banner-view-model,
        ytd-watch-flexy .ytStatementBannerViewModelHost {
          display: none !important;
        }
      `);
    }

    if (CONFIG.hideMetadataTeaserCarousel) {
      rules.push(`
        ytd-watch-flexy ytd-watch-metadata #teaser-carousel {
          display: none !important;
        }
      `);
    }

    if (CONFIG.hideInfoPanel) {
      rules.push(`
        ytd-watch-flexy ytd-info-panel-container-renderer,
        ytd-watch-flexy .ytd-info-panel-container-renderer {
          display: none !important;
        }
      `);
    }

    rules.push(`
        ytd-watch-flexy ytd-watch-metadata ytd-watch-info-text .${WATCH_INFO_STATIC_TEXT_CLASS} {
          display: inline !important;
          white-space: normal !important;
        }

        ytd-watch-flexy ytd-watch-metadata ytd-watch-info-text ${WATCH_INFO_NATIVE_CONTAINER_SELECTOR}[${WATCH_INFO_NATIVE_HIDDEN_ATTRIBUTE}="1"] {
          display: none !important;
        }

        ytd-watch-flexy ytd-watch-metadata ytd-watch-info-text tp-yt-paper-tooltip {
          display: none !important;
          pointer-events: none !important;
        }
      `);

    if (CONFIG.collapseDescriptionBlankRows) {
      rules.push(`
        ${DESCRIPTION_EXPANDED_SELECTOR} {
          height: auto !important;
          max-height: none !important;
          min-height: 0 !important;
        }
      `);
    }

    if (CONFIG.hideHashtags) {
      rules.push(`
        ytd-watch-flexy ytd-watch-metadata a[href^="/hashtag/"],
        ytd-watch-flexy ytd-watch-metadata a[href*="youtube.com/hashtag/"],
        ytd-watch-flexy ytd-video-primary-info-renderer a[href^="/hashtag/"],
        ytd-watch-flexy ytd-video-primary-info-renderer a[href*="youtube.com/hashtag/"],
        ytd-watch-flexy yt-chip-cloud-chip-renderer a[href^="/hashtag/"],
        ytd-watch-flexy yt-chip-cloud-chip-renderer a[href*="youtube.com/hashtag/"],
        ytd-watch-flexy span:has(> a[href^="/hashtag/"]:only-child),
        ytd-watch-flexy span:has(> a[href*="youtube.com/hashtag/"]:only-child) {
          display: none !important;
        }

        ytd-watch-flexy ytd-watch-metadata ytd-text-inline-expander #expanded[${DESCRIPTION_EXPANDED_COLLAPSED_ATTRIBUTE}="1"],
        ytd-watch-flexy ytd-watch-metadata #description-inline-expander #expanded[${DESCRIPTION_EXPANDED_COLLAPSED_ATTRIBUTE}="1"] {
          display: none !important;
          height: 0 !important;
          line-height: 0 !important;
          margin: 0 !important;
          max-height: 0 !important;
          min-height: 0 !important;
          overflow: hidden !important;
          padding: 0 !important;
        }
      `);
    }

    if (CONFIG.hideStructuredDescription) {
      rules.push(`
        ytd-watch-flexy ytd-structured-description-content-renderer#structured-description,
        ytd-watch-flexy ytd-structured-description-content-renderer how-this-was-made-section-view-model,
        ytd-watch-flexy ytd-structured-description-content-renderer .ytHowThisWasMadeSectionViewModelHost,
        ytd-watch-flexy ytd-structured-description-content-renderer yt-video-description-youchat-section-view-model,
        ytd-watch-flexy ytd-structured-description-content-renderer .ytVideoDescriptionYouchatSectionViewModelHost,
        ytd-watch-flexy ytd-structured-description-content-renderer yt-video-attributes-section-view-model .videoAttributesSectionViewModelFooterButton,
        ytd-watch-flexy ytd-structured-description-content-renderer .ytVideoAttributesSectionViewModelHost .videoAttributesSectionViewModelFooterButton,
        ytd-watch-flexy ytd-structured-description-content-renderer ytd-video-description-transcript-section-renderer,
        ytd-watch-flexy ytd-structured-description-content-renderer ytd-video-description-infocards-section-renderer,
        ytd-watch-flexy ytd-structured-description-content-renderer yt-video-description-infocards-section-renderer,
        ytd-watch-flexy ytd-structured-description-content-renderer .yt-video-description-infocards-section-renderer {
          display: none !important;
        }
      `);
    }

    return rules.join("\n");
  }

  function buildWatchLayoutCss() {
    if (!CONFIG.hideChat) {
      return "";
    }

    return `
        ytd-watch-flexy ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-live-chat"],
        ytd-watch-flexy ytd-engagement-panel-section-list-renderer:has(ytd-live-chat-frame),
        ytd-watch-flexy ytd-engagement-panel-section-list-renderer:has(yt-live-chat-app),
        ytd-watch-flexy ytd-engagement-panel-section-list-renderer:has(ytd-watch-live-chat-renderer),
        ytd-watch-flexy ytd-engagement-panel-section-list-renderer:has(ytd-watch-live-chat-replay-renderer),
        ytd-watch-flexy #chat-container,
        ytd-watch-flexy #chat,
        ytd-watch-flexy ytd-live-chat-frame,
        ytd-watch-live-chat-renderer,
        ytd-watch-live-chat-replay-renderer,
        ytd-live-chat-viewer-engagement-message-renderer,
        ytd-watch-flexy yt-carousel-item-view-model[aria-label="Live chat replay"],
        ytd-watch-flexy yt-carousel-item-view-model[aria-label*="Live chat" i] {
          display: none !important;
        }
      `;
  }

  function buildInfoCardCss() {
    if (!CONFIG.hideInfoCards) {
      return "";
    }

    return `
        .html5-video-player .ytp-cards-button,
        .html5-video-player .ytp-paid-content-overlay {
          display: none !important;
          opacity: 0 !important;
          pointer-events: none !important;
        }

        .html5-video-player .ytp-cards-teaser {
          opacity: 0 !important;
          pointer-events: none !important;
        }
      `;
  }

  function buildEndScreenRecommendationCss() {
    if (!CONFIG.hideEndScreenRecommendationGrid) {
      return "";
    }

    // Keep end-screen geometry native because YouTube uses it while preparing
    // the autoplay handoff. Hide only the individual recommendation tiles;
    // never hide their fullscreen grid container or remove tiles from layout.
    return `
        .html5-video-player .ytp-videowall-still,
        .html5-video-player .ytp-modern-videowall-still {
          opacity: 0 !important;
          pointer-events: none !important;
        }

        .html5-video-player .ytp-ce-element,
        .html5-video-player .ytp-ce-covering-overlay,
        .html5-video-player .ytp-ce-expanding-overlay,
        .html5-video-player .ytp-ce-hide-button-container {
          opacity: 0 !important;
          pointer-events: none !important;
        }

        .html5-video-player .ytp-playlist-menu .ytp-ce-element,
        .html5-video-player .ytp-playlist-menu .ytp-ce-covering-overlay,
        .html5-video-player .ytp-playlist-menu .ytp-ce-expanding-overlay,
        .html5-video-player .ytp-playlist-menu .ytp-ce-hide-button-container {
          opacity: 1 !important;
          pointer-events: auto !important;
        }
      `;
  }

  function buildAutoplayUpNextCss() {
    // Keep this separate from recommendation grids: hiding the container while
    // YouTube leaves Cancel/Play Now visible produces a blank autoplay card.
    if (CONFIG.showAutoplayUpNextCard) {
      return "";
    }

    return `
        .html5-video-player .ytp-autonav-endscreen-upnext-container {
          display: none !important;
          opacity: 0 !important;
          pointer-events: none !important;
        }
      `;
  }

  function buildCss() {
    return [
      buildVolumeOverlayCss(),
      buildCaptionCss(),
      buildShortsCss(),
      buildFeedCleanupCss(),
      buildWatchCleanupCss(),
      buildWatchLayoutCss(),
      buildInfoCardCss(),
      buildEndScreenRecommendationCss(),
      buildAutoplayUpNextCss(),
    ]
      .filter((css) => css.trim())
      .join("\n");
  }

  function ensureStyles() {
    const css = buildCss();
    if (!css.trim()) {
      return;
    }

    let style = document.getElementById(STYLE_ID);
    if (!style) {
      style = document.createElement("style");
      style.id = STYLE_ID;
      (document.head || document.documentElement).appendChild(style);
    }

    if (style.textContent !== css) {
      style.textContent = css;
      schedulePlayerLayoutRefreshAttempts();
    }
  }

  function isRenderedWatchFlexy(flexy) {
    if (
      !flexy?.isConnected ||
      flexy.hidden ||
      flexy.getAttribute("aria-hidden") === "true"
    ) {
      return false;
    }

    try {
      const style = getComputedStyle(flexy);
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
      typeof flexy.getClientRects !== "function" ||
      flexy.getClientRects().length > 0
    );
  }

  function getWatchFlexy() {
    const playerFlexy = document
      .querySelector("#movie_player")
      ?.closest?.("ytd-watch-flexy");
    if (playerFlexy?.isConnected) return playerFlexy;

    const placeholderFlexy = document
      .querySelector("#ytsmp-player-placeholder")
      ?.closest?.("ytd-watch-flexy");
    if (placeholderFlexy?.isConnected) return placeholderFlexy;

    const flexies = Array.from(document.querySelectorAll("ytd-watch-flexy"));
    return (
      flexies.find(isRenderedWatchFlexy) ||
      flexies.find((flexy) => flexy.isConnected) ||
      null
    );
  }

  function requestPlayerLayoutRefresh() {
    if (!isWatchPath() || playerLayoutRefreshFrame) {
      return;
    }

    playerLayoutRefreshFrame = requestAnimationFrame(() => {
      playerLayoutRefreshFrame = 0;
      if (isWatchPath()) {
        window.dispatchEvent(new Event("resize"));
      }
    });
  }

  function schedulePlayerLayoutRefreshAttempts() {
    if (!isWatchPath()) {
      return;
    }

    PLAYER_LAYOUT_REFRESH_DELAYS_MS.forEach((delay) => {
      if (playerLayoutRefreshAttemptTimers.has(delay)) {
        return;
      }

      const timerId = setTimeout(() => {
        playerLayoutRefreshAttemptTimers.delete(delay);
        requestPlayerLayoutRefresh();
      }, delay);
      playerLayoutRefreshAttemptTimers.set(delay, timerId);
    });
  }

  function clearPlayerLayoutRefreshAttempts() {
    playerLayoutRefreshAttemptTimers.forEach((timerId) =>
      clearTimeout(timerId),
    );
    playerLayoutRefreshAttemptTimers.clear();
  }

  function isLiveChatCollapsed(chatFrame) {
    return Boolean(
      chatFrame &&
        (chatFrame.hasAttribute("collapsed") || chatFrame.collapsed === true),
    );
  }

  function clearPendingLiveChatCollapse(chatFrame = null) {
    if (chatFrame && pendingLiveChatFrame !== chatFrame) {
      return;
    }

    if (liveChatCollapsePendingTimer) {
      clearTimeout(liveChatCollapsePendingTimer);
      liveChatCollapsePendingTimer = 0;
    }

    pendingLiveChatFrame = null;
  }

  function clearLiveChatCollapseAttempts() {
    liveChatCollapseAttemptTimers.forEach((timerId) => clearTimeout(timerId));
    liveChatCollapseAttemptTimers = [];
    clearPendingLiveChatCollapse();
  }

  function verifyLiveChatCollapse(chatFrame) {
    if (pendingLiveChatFrame !== chatFrame) {
      return;
    }

    clearPendingLiveChatCollapse(chatFrame);
    if (isLiveChatCollapsed(chatFrame)) {
      schedulePlayerLayoutRefreshAttempts();
    }
  }

  function collapseLiveChatIfExpanded() {
    if (!CONFIG.hideChat || !isWatchPath()) {
      return;
    }

    const chatFrame = document.querySelector(LIVE_CHAT_FRAME_SELECTOR);
    if (!chatFrame) {
      return;
    }

    if (isLiveChatCollapsed(chatFrame)) {
      clearPendingLiveChatCollapse(chatFrame);
      return;
    }

    if (pendingLiveChatFrame === chatFrame) {
      return;
    }

    const collapseButton = chatFrame.querySelector(
      LIVE_CHAT_COLLAPSE_BUTTON_SELECTOR,
    );
    if (
      !collapseButton ||
      typeof collapseButton.click !== "function" ||
      collapseButton.disabled ||
      collapseButton.getAttribute("aria-disabled") === "true"
    ) {
      return;
    }

    pendingLiveChatFrame = chatFrame;
    try {
      collapseButton.click();
    } catch {
      clearPendingLiveChatCollapse(chatFrame);
      return;
    }

    liveChatCollapsePendingTimer = setTimeout(
      () => verifyLiveChatCollapse(chatFrame),
      LIVE_CHAT_COLLAPSE_PENDING_TIMEOUT_MS,
    );
  }

  function scheduleLiveChatCollapseAttempts() {
    liveChatCollapseAttemptTimers.forEach((timerId) => clearTimeout(timerId));
    liveChatCollapseAttemptTimers = [];

    if (!CONFIG.hideChat || !isWatchPath()) {
      return;
    }

    liveChatCollapseAttemptTimers = LIVE_CHAT_COLLAPSE_DELAYS_MS.map((delay) =>
      setTimeout(collapseLiveChatIfExpanded, delay),
    );
  }

  function nodeContainsLiveChatFrame(node) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) {
      return false;
    }

    return (
      node.matches(LIVE_CHAT_FRAME_SELECTOR) ||
      Boolean(node.querySelector(LIVE_CHAT_FRAME_SELECTOR))
    );
  }

  function isTheaterModeEnabled() {
    const flexy = getWatchFlexy();
    if (!flexy) {
      return false;
    }

    return (
      flexy.hasAttribute("theater") ||
      flexy.hasAttribute("theatre") ||
      flexy.hasAttribute("is-watch-wide")
    );
  }

  function enableTheaterMode() {
    if (
      !CONFIG.enableTheaterMode ||
      theaterModeUserDisabled ||
      !isWatchPath() ||
      isTheaterModeEnabled()
    ) {
      return;
    }
    if (document.fullscreenElement) {
      return;
    }

    const player = document.querySelector("#movie_player, .html5-video-player");
    const sizeButton = player && player.querySelector(".ytp-size-button");
    if (
      !sizeButton ||
      sizeButton.disabled ||
      sizeButton.getAttribute("aria-disabled") === "true"
    ) {
      return;
    }

    sizeButton.click();
    schedulePlayerLayoutRefreshAttempts();
  }

  function scheduleTheaterModeAttempts() {
    if (
      !CONFIG.enableTheaterMode ||
      theaterModeUserDisabled ||
      !isWatchPath()
    ) {
      return;
    }

    const videoKey = getVideoKey();
    if (!videoKey || videoKey === theaterModeAttemptKey) {
      return;
    }

    theaterModeAttemptKey = videoKey;
    [300, 1200, 2500].forEach((delay) => {
      setTimeout(() => {
        if (theaterModeAttemptKey === videoKey) {
          enableTheaterMode();
        }
      }, delay);
    });
  }

  function handleTheaterModeToggle(event) {
    if (!CONFIG.enableTheaterMode || !isWatchPath()) {
      return;
    }
    if (!closestElement(event.target, ".ytp-size-button")) {
      return;
    }

    theaterModeUserDisabled = isTheaterModeEnabled();
  }

  function getVideoKey() {
    if (!isWatchPath()) {
      return "";
    }

    const videoId = new URLSearchParams(location.search).get("v") || "";
    return `${location.pathname}:${videoId}`;
  }

  function getHighestQualityLevel(levels) {
    if (!Array.isArray(levels) || !levels.length) {
      return "";
    }

    return (
      QUALITY_LEVELS_HIGH_TO_LOW.find((quality) => levels.includes(quality)) ||
      levels.find((quality) => quality && quality !== "auto") ||
      ""
    );
  }

  function clearHighestQualityRetryTimers() {
    highestQualityRetryTimers.forEach((timerId) => clearTimeout(timerId));
    highestQualityRetryTimers = [];
  }

  function setHighestPlaybackQuality() {
    if (!CONFIG.enableHighestQuality || !isWatchPath()) {
      return false;
    }

    const player = document.querySelector("#movie_player");
    if (!player || typeof player.getAvailableQualityLevels !== "function") {
      return false;
    }

    let levels;
    try {
      levels = player.getAvailableQualityLevels();
    } catch {
      return false;
    }

    const quality = getHighestQualityLevel(levels);
    if (!quality) {
      return false;
    }

    try {
      if (typeof player.setPlaybackQualityRange === "function") {
        player.setPlaybackQualityRange(quality, quality);
      }
      if (typeof player.setPlaybackQuality === "function") {
        player.setPlaybackQuality(quality);
      }
    } catch {
      return false;
    }

    return true;
  }

  function scheduleHighestQualityAttempts() {
    if (!CONFIG.enableHighestQuality || !isWatchPath()) {
      highestQualityVideoKey = "";
      clearHighestQualityRetryTimers();
      return;
    }

    const videoKey = getVideoKey();
    if (!videoKey || videoKey === highestQualityVideoKey) {
      return;
    }

    highestQualityVideoKey = videoKey;
    clearHighestQualityRetryTimers();

    highestQualityRetryTimers = CONFIG.highestQualityRetryDelays.map((delay) =>
      setTimeout(() => {
        if (highestQualityVideoKey === videoKey) {
          setHighestPlaybackQuality();
        }
      }, delay),
    );
  }

  function getPlayerFromTarget(target) {
    if (!target || isExcludedSurface(target)) {
      return null;
    }
    return closestElement(target, "#movie_player, .html5-video-player");
  }

  function getPlayerVideo(player) {
    return player ? player.querySelector("video") : null;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function getVolumeOverlay() {
    const parent =
      document.fullscreenElement || document.body || document.documentElement;
    let overlay = document.querySelector(`.${VOLUME_OVERLAY_CLASS}`);

    if (!overlay) {
      overlay = document.createElement("div");
      overlay.className = VOLUME_OVERLAY_CLASS;
      overlay.setAttribute("aria-hidden", "true");
    }

    if (overlay.parentElement !== parent) {
      parent.appendChild(overlay);
    }

    return overlay;
  }

  function showVolumeOverlay(player, percent) {
    const overlay = getVolumeOverlay();
    const rect = player.getBoundingClientRect();
    const left = clamp(rect.left + rect.width / 2, 96, innerWidth - 96);
    const top = clamp(rect.top + rect.height / 3, 40, innerHeight - 40);

    overlay.style.left = `${Math.round(left)}px`;
    overlay.style.top = `${Math.round(top)}px`;
    overlay.style.transform = "translate(-50%, -50%)";
    overlay.textContent = String(percent);
    overlay.dataset.visible = "1";

    clearTimeout(volumeOverlayHideTimer);
    volumeOverlayHideTimer = setTimeout(() => {
      overlay.dataset.visible = "0";
    }, 850);
  }

  function getPlayerVolume(player, video) {
    // Read the same volume model that setVolume writes.
    if (typeof player.getVolume === "function") {
      try {
        const percent = player.getVolume();
        if (typeof percent === "number" && Number.isFinite(percent)) {
          return clamp(percent / 100, 0, 1);
        }
      } catch {
        // Fall back while the player API is unavailable during navigation.
      }
    }
    return video.volume;
  }

  function setPlayerVolume(player, nextVolume) {
    const video = getPlayerVideo(player);
    if (!video) {
      return null;
    }

    const nextPercent = Math.round(clamp(nextVolume, 0, 1) * 100);

    if (typeof player.setVolume === "function") {
      player.setVolume(nextPercent);
    }

    video.volume = nextPercent / 100;

    if (nextPercent > 0) {
      if (typeof player.unMute === "function") {
        player.unMute();
      }
      video.muted = false;
    }

    return nextPercent;
  }

  function handleWheelVolume(event) {
    if (!CONFIG.enablePlayerWheelVolume || event.deltaY === 0) {
      return;
    }

    if (
      CONFIG.requireRightMouseButtonForWheelVolume &&
      (event.buttons & 2) !== 2 &&
      !rightButtonHeldOnPlayer
    ) {
      return;
    }

    const player = getPlayerFromTarget(event.target);
    if (!player) {
      return;
    }

    const video = getPlayerVideo(player);
    if (!video) {
      return;
    }

    const direction = event.deltaY < 0 ? 1 : -1;
    const step = clamp(CONFIG.wheelVolumeStep, 1, 100) / 100;
    const nextVolume = clamp(getPlayerVolume(player, video) + direction * step, 0, 1);

    const nextPercent = setPlayerVolume(player, nextVolume);
    if (nextPercent === null) {
      return;
    }

    showVolumeOverlay(player, nextPercent);

    event.preventDefault();
    event.stopImmediatePropagation();

    if (CONFIG.requireRightMouseButtonForWheelVolume) {
      contextMenuSuppressionExpiresAt =
        Date.now() + CONFIG.contextMenuSuppressionWindowMs;
    }
  }

  function clearContextMenuSuppression() {
    contextMenuSuppressionExpiresAt = 0;
  }

  function handleMouseDown(event) {
    if (event.button !== 2) {
      return;
    }
    clearContextMenuSuppression();
    rightButtonHeldOnPlayer = Boolean(getPlayerFromTarget(event.target));
  }

  function handleMouseUp(event) {
    if (event.button !== 2) {
      return;
    }
    rightButtonHeldOnPlayer = false;
  }

  function handleContextMenu(event) {
    if (!contextMenuSuppressionExpiresAt) {
      return;
    }

    const shouldSuppress =
      Date.now() <= contextMenuSuppressionExpiresAt &&
      Boolean(getPlayerFromTarget(event.target));
    clearContextMenuSuppression();

    if (!shouldSuppress) {
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();
  }

  function handleWindowBlur() {
    rightButtonHeldOnPlayer = false;
    clearContextMenuSuppression();
  }

  function rootIntersectsSurface(root, selector) {
    if (!root || !selector) {
      return false;
    }
    if (root === document || root.nodeType === Node.DOCUMENT_NODE) {
      return true;
    }

    const applyRoot = getApplyRoot(root);
    if (!applyRoot) {
      return false;
    }

    return Boolean(
      applyRoot.matches?.(selector) ||
        applyRoot.closest?.(selector) ||
        applyRoot.querySelector?.(selector),
    );
  }

  function getFeedApplyRoot(root) {
    const applyRoot = getApplyRoot(root);
    return (
      closestElement(applyRoot, UPCOMING_STREAM_SCAN_SELECTOR) || applyRoot
    );
  }

  function getWatchPrimaryActionApplyRoot(root) {
    const applyRoot = getApplyRoot(root);
    return (
      closestElement(applyRoot, WATCH_PRIMARY_ACTION_CONTAINER_SELECTOR) ||
      applyRoot
    );
  }

  function applyDynamicPreferences(root = document) {
    const fullPageApply =
      root === document || root?.nodeType === Node.DOCUMENT_NODE;

    if (rootIntersectsSurface(root, TOPBAR_DYNAMIC_MUTATION_SURFACE_SELECTOR)) {
      useStandardMastheadLogo(root);
    }
    if (fullPageApply) {
      clearLegacyHiddenWatchActionButtons(root);
    }
    if (rootIntersectsSurface(root, SHORTS_DYNAMIC_MUTATION_SURFACE_SELECTOR)) {
      rewriteShortsLinks(root);
    }
    if (rootIntersectsSurface(root, FEED_DYNAMIC_MUTATION_SURFACE_SELECTOR)) {
      const feedApplyRoot = getFeedApplyRoot(root);
      hideUpcomingStreams(feedApplyRoot);
      hidePayToWatchCards(feedApplyRoot);
      hideWatchedVideos(feedApplyRoot);
    }
    if (
      rootIntersectsSurface(
        root,
        WATCH_PRIMARY_ACTION_MUTATION_SURFACE_SELECTOR,
      )
    ) {
      const primaryActionApplyRoot = getWatchPrimaryActionApplyRoot(root);
      normaliseReturnYoutubeLikeButtons(primaryActionApplyRoot);
      normaliseReturnYoutubeDislikeButtons(primaryActionApplyRoot);
      hideWatchActionButtons(primaryActionApplyRoot);
    }
    if (rootIntersectsSurface(root, WATCH_INFO_TEXT_SELECTOR)) {
      normaliseWatchInfoText(root);
    }
    if (
      rootIntersectsSurface(root, WATCH_DESCRIPTION_MUTATION_SURFACE_SELECTOR)
    ) {
      runDescriptionCleanup(root);
    }
    if (
      rootIntersectsSurface(
        root,
        WATCH_ACTION_MENU_MUTATION_SURFACE_SELECTOR,
      )
    ) {
      hideWatchActionMenuItems(root);
    }
  }

  function applyRoutePreferences() {
    ensureStyles();
    convertCurrentShortsPage();
    applyDynamicPreferences(document);
    scheduleHighestQualityAttempts();
    scheduleLiveChatCollapseAttempts();

    if (isWatchPath()) {
      scheduleTheaterModeAttempts();
    }
  }

  function handleNavigateFinish() {
    theaterModeUserDisabled = false;
    theaterModeAttemptKey = "";
    applyRoutePreferences();
    configureDynamicMutationObserver();
    schedulePlayerLayoutRefreshAttempts();
  }

  function handleNavigateStart() {
    clearLiveChatCollapseAttempts();
    clearPlayerLayoutRefreshAttempts();
    cancelScheduledAnimationWork();
    rightButtonHeldOnPlayer = false;
    clearContextMenuSuppression();
  }

  function handleDescriptionClick(event) {
    if (!CONFIG.collapseDescriptionBlankRows || !isWatchPath()) {
      return;
    }
    const descriptionRoot = closestElement(
      event.target,
      DESCRIPTION_TEXT_ROOT_SELECTOR,
    );
    if (!descriptionRoot) {
      return;
    }

    [0, 100, 300, 800, 1500].forEach((delay) => {
      setTimeout(() => {
        if (descriptionRoot.isConnected !== false) {
          runDescriptionCleanup(descriptionRoot);
        }
      }, delay);
    });
  }

  function getApplyRoot(root) {
    if (!root) {
      return null;
    }

    if (root.nodeType === Node.DOCUMENT_NODE) {
      return document;
    }

    if (
      root.nodeType === Node.TEXT_NODE ||
      root.nodeType === Node.COMMENT_NODE
    ) {
      return root.parentElement || null;
    }

    return root.querySelectorAll ? root : null;
  }

  function addPendingApplyRoot(root) {
    const applyRoot = getApplyRoot(root);
    if (!applyRoot) {
      return;
    }

    if (applyRoot === document) {
      pendingApplyRoots.clear();
      pendingApplyRoots.add(document);
      return;
    }

    if (pendingApplyRoots.has(document)) {
      return;
    }

    for (const pendingRoot of Array.from(pendingApplyRoots)) {
      if (
        pendingRoot !== applyRoot &&
        pendingRoot.contains &&
        pendingRoot.contains(applyRoot)
      ) {
        return;
      }

      if (
        applyRoot.contains &&
        applyRoot.contains(pendingRoot)
      ) {
        pendingApplyRoots.delete(pendingRoot);
      }
    }

    pendingApplyRoots.add(applyRoot);
  }

  function scheduleApply(root = document) {
    addPendingApplyRoot(root);
    if (applyFrame) {
      return;
    }

    applyFrame = requestAnimationFrame(() => {
      applyFrame = 0;
      const roots = Array.from(pendingApplyRoots);
      pendingApplyRoots.clear();

      if (!roots.length) {
        return;
      }

      if (roots.includes(document)) {
        applyDynamicPreferences(document);
        return;
      }

      roots.forEach((applyRoot) => {
        if (applyRoot.isConnected !== false) {
          applyDynamicPreferences(applyRoot);
        }
      });
    });
  }

  function cancelScheduledAnimationWork() {
    if (applyFrame) cancelAnimationFrame(applyFrame);
    if (playerLayoutRefreshFrame) cancelAnimationFrame(playerLayoutRefreshFrame);
    applyFrame = 0;
    playerLayoutRefreshFrame = 0;
    pendingApplyRoots.clear();
  }

  function addMutationRoot(roots, root) {
    const applyRoot = getApplyRoot(root);
    if (applyRoot) {
      roots.add(applyRoot);
    }
  }

  function getScopedMutationRoot(target) {
    return closestElement(target, DYNAMIC_MUTATION_SURFACE_SELECTOR);
  }

  function addScopedMutationRoot(roots, target) {
    const scopedRoot = getScopedMutationRoot(target);
    if (!scopedRoot) {
      return false;
    }

    roots.add(scopedRoot);
    return true;
  }

  function addContainedMutationRoots(roots, root) {
    const applyRoot = getApplyRoot(root);
    if (!applyRoot?.querySelectorAll) {
      return false;
    }

    const candidates = Array.from(
      applyRoot.querySelectorAll(DYNAMIC_MUTATION_SURFACE_SELECTOR),
    );
    const candidateSet = new Set(candidates);
    candidates.forEach((candidate) => {
      const possibleAncestor = candidate.parentElement?.closest?.(
        DYNAMIC_MUTATION_SURFACE_SELECTOR,
      );
      if (!candidateSet.has(possibleAncestor)) {
        addMutationRoot(roots, candidate);
      }
    });
    return candidates.length > 0;
  }

  function addAddedNodeMutationRoot(roots, node) {
    if (addScopedMutationRoot(roots, node)) {
      return true;
    }

    return addContainedMutationRoots(roots, node);
  }

  function addMutationApplyRoots(roots, mutation) {
    if (mutation.addedNodes && mutation.addedNodes.length) {
      let rootAdded = false;

      mutation.addedNodes.forEach((node) => {
        if (addAddedNodeMutationRoot(roots, node)) {
          rootAdded = true;
        }
      });

      if (!rootAdded) {
        addScopedMutationRoot(roots, mutation.target);
      }
      return;
    }

    if (
      mutation.type === "childList" &&
      mutation.removedNodes &&
      mutation.removedNodes.length
    ) {
      addScopedMutationRoot(roots, mutation.target);
      return;
    }

    if (mutation.type !== "attributes" && mutation.type !== "characterData") {
      return;
    }

    addScopedMutationRoot(roots, mutation.target);
  }

  function nodeContainsWatchDynamicMutationRoot(node) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) {
      return false;
    }

    return (
      node.matches(WATCH_DYNAMIC_MUTATION_ROOT_SELECTOR) ||
      Boolean(node.querySelector(WATCH_DYNAMIC_MUTATION_ROOT_SELECTOR)) ||
      (!CONFIG.hideRelatedVideos &&
        (node.matches(WATCH_RELATED_MUTATION_ROOT_SELECTOR) ||
          Boolean(node.querySelector(WATCH_RELATED_MUTATION_ROOT_SELECTOR))))
    );
  }

  function collectWatchDynamicMutationRoots() {
    const candidates = [
      ...document.querySelectorAll(WATCH_DYNAMIC_MUTATION_ROOT_SELECTOR),
      ...(CONFIG.hideRelatedVideos
        ? []
        : document.querySelectorAll(WATCH_RELATED_MUTATION_ROOT_SELECTOR)),
    ];

    return new Set(
      candidates.filter(
        (candidate) =>
          !candidates.some(
            (possibleAncestor) =>
              possibleAncestor !== candidate &&
              possibleAncestor.contains(candidate),
          ),
      ),
    );
  }

  function mutationChangesWatchDynamicRoots(mutation) {
    if (!isWatchPath() || mutation.type !== "childList") {
      return false;
    }

    return [...mutation.addedNodes, ...mutation.removedNodes].some(
      nodeContainsWatchDynamicMutationRoot,
    );
  }

  let dynamicMutationObserverMode = "";
  let watchDynamicMutationRoots = new Set();

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

  function configureDynamicMutationObserver() {
    const watchMode = isWatchPath();
    const nextMode = watchMode ? "watch" : "document";
    const nextWatchRoots = watchMode
      ? collectWatchDynamicMutationRoots()
      : new Set();
    const rootsUnchanged =
      dynamicMutationObserverMode === nextMode &&
      watchDynamicMutationRoots.size === nextWatchRoots.size &&
      [...watchDynamicMutationRoots].every(
        (root) => root.isConnected && nextWatchRoots.has(root),
      );
    if (rootsUnchanged) {
      return;
    }

    const nextRegistrations = watchMode
      ? [
          [document.documentElement, DYNAMIC_MUTATION_DISCOVERY_OPTIONS],
          ...[...nextWatchRoots].map((root) => [
            root,
            DYNAMIC_MUTATION_OPTIONS,
          ]),
        ]
      : [[document.documentElement, DYNAMIC_MUTATION_OPTIONS]];
    replaceObserverRegistrations(observer, nextRegistrations);

    dynamicMutationObserverMode = nextMode;
    watchDynamicMutationRoots = nextWatchRoots;
  }

  applyRoutePreferences();

  const observer = new MutationObserver((mutations) => {
    const roots = new Set();
    let watchDynamicRootsChanged = false;

    for (const mutation of mutations) {
      if (
        mutation.addedNodes &&
        mutation.addedNodes.length &&
        Array.from(mutation.addedNodes).some(nodeContainsLiveChatFrame)
      ) {
        scheduleLiveChatCollapseAttempts();
      }

      addMutationApplyRoots(roots, mutation);
      watchDynamicRootsChanged ||=
        mutationChangesWatchDynamicRoots(mutation);
    }

    roots.forEach((root) => scheduleApply(root));
    if (watchDynamicRootsChanged) {
      configureDynamicMutationObserver();
    }
  });

  configureDynamicMutationObserver();

  document.addEventListener("click", handleShortsClick, true);
  document.addEventListener("click", handleTheaterModeToggle, true);
  document.addEventListener("click", handleDescriptionClick, true);
  document.addEventListener("wheel", handleWheelVolume, {
    capture: true,
    passive: false,
  });
  document.addEventListener("mousedown", handleMouseDown, true);
  document.addEventListener("mouseup", handleMouseUp, true);
  document.addEventListener("contextmenu", handleContextMenu, true);

  window.addEventListener("blur", handleWindowBlur, true);
  window.addEventListener("yt-navigate-start", handleNavigateStart, true);
  window.addEventListener("yt-navigate-finish", handleNavigateFinish, true);
  window.addEventListener(
    "yt-page-data-updated",
    () => {
      configureDynamicMutationObserver();
      scheduleApply(document);
      scheduleLiveChatCollapseAttempts();
    },
    true,
  );

  window.addEventListener(
    "pagehide",
    () => {
      cancelScheduledAnimationWork();
      clearLiveChatCollapseAttempts();
      clearPlayerLayoutRefreshAttempts();
    },
    true,
  );

  window.addEventListener(
    "pageshow",
    () => {
      ensureStyles();
      configureDynamicMutationObserver();
      scheduleApply(document);
      scheduleLiveChatCollapseAttempts();
      schedulePlayerLayoutRefreshAttempts();
    },
    true,
  );
})();
