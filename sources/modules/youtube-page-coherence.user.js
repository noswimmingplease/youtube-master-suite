// ==UserScript==
// @name         YouTube Page Coherence Guard
// @namespace    Citizen.youtube.page-coherence
// @version      1.7
// @description  Detects incomplete YouTube queue navigation, hides stale identity content and comments, preserves native actions, and rechecks restored foreground pages.
// @author       Citizen
// @license      GNU GPLv3
// @homepageURL  https://github.com/Ci303/youtube-master-suite
// @supportURL   https://github.com/Ci303/youtube-master-suite/issues
// @updateURL    https://raw.githubusercontent.com/Ci303/youtube-master-suite/main/youtube-master-suite.user.js
// @downloadURL  https://raw.githubusercontent.com/Ci303/youtube-master-suite/main/youtube-master-suite.user.js
// @match        https://www.youtube.com/*
// @run-at       document-idle
// @grant        none
// @noframes
// ==/UserScript==

(() => {
  "use strict";

  const CONFIG = Object.freeze({
    checkDelaysMs: [600, 1600, 3200],
    staleRecoveryDelaysMs: [2000, 5000, 10000],
    mismatchesBeforeWarning: 2,
    eventHistoryLimit: 20,
  });
  const STYLE_ID = "yt-page-coherence-style";
  const STALE_ATTRIBUTE = "data-yt-master-page-stale";
  const STATE_ATTRIBUTE = "data-yt-master-state";
  const EVENTS_ATTRIBUTE = "data-yt-master-events";
  const LEGACY_NOTICE_ID = "yt-master-page-coherence-notice";
  const COMMENTS_STALE_ATTRIBUTE = "data-iow-stale-video";
  const COMMENT_PERMALINK_LINK_SELECTOR =
    'a[href*="/watch?"][href*="lc="], a[href*="youtube.com/watch?"][href*="lc="]';
  const COMMENT_RENDERER_SELECTOR = [
    "ytd-comment-thread-renderer",
    "ytd-comment-renderer",
    "ytd-comment-view-model",
    "yt-comment-view-model",
  ].join(",");
  const QUEUE_ITEM_SELECTOR = [
    "ytd-playlist-panel-video-renderer[selected]",
    'ytd-playlist-panel-video-renderer[aria-selected="true"]',
    'ytd-playlist-panel-video-renderer[aria-current="true"]',
    "yt-playlist-panel-video-renderer[selected]",
    'yt-playlist-panel-video-renderer[aria-selected="true"]',
    'yt-playlist-panel-video-renderer[aria-current="true"]',
  ].join(",");
  const METADATA_TITLE_SELECTOR = [
    "ytd-watch-metadata h1 yt-formatted-string",
    "ytd-watch-metadata h1 .yt-core-attributed-string",
    "ytd-video-primary-info-renderer h1 yt-formatted-string",
  ].join(",");

  const navigationEvents = [];
  const checkTimers = new Map();
  const staleRecoveryTimers = new Set();
  let consecutiveMismatchChecks = 0;
  let stalePageData = false;
  let navigationGeneration = 0;
  let navigationVideoId = "";
  let staleRecoveryKey = "";

  const isWatchPath = () =>
    location.pathname === "/watch" || location.pathname.startsWith("/live/");

  const getVideoIdFromUrl = (value) => {
    if (!value) return "";

    try {
      const url = new URL(value, location.origin);
      if (url.pathname.startsWith("/live/")) {
        return url.pathname.split("/")[2] || "";
      }
      return url.searchParams.get("v") || "";
    } catch {
      return "";
    }
  };

  const isRenderedElement = (element) => {
    if (
      !element?.isConnected ||
      element.hidden ||
      element.getAttribute("aria-hidden") === "true"
    ) {
      return false;
    }

    try {
      const style = getComputedStyle(element);
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
      typeof element.getClientRects !== "function" ||
      element.getClientRects().length > 0
    );
  };

  const readPlayerData = (player) => {
    try {
      return player?.getVideoData?.() || {};
    } catch {
      return {};
    }
  };

  const getActivePlayer = () => {
    const players = Array.from(
      document.querySelectorAll('[id="movie_player"]'),
    );
    const renderedPlayers = players.filter(isRenderedElement);
    const urlVideoId = getVideoIdFromUrl(location.href);

    return (
      renderedPlayers.find(
        (player) => readPlayerData(player).video_id === urlVideoId,
      ) ||
      renderedPlayers[0] ||
      players.find(
        (player) =>
          player.isConnected &&
          readPlayerData(player).video_id === urlVideoId,
      ) ||
      players.find((player) => player.isConnected) ||
      null
    );
  };

  const getPlayerData = () => readPlayerData(getActivePlayer());

  const isRenderedWatchFlexy = (flexy) => isRenderedElement(flexy);

  const getActiveWatchFlexy = () => {
    const playerFlexy = getActivePlayer()?.closest?.("ytd-watch-flexy");
    if (isRenderedWatchFlexy(playerFlexy)) return playerFlexy;

    const placeholderFlexy = document
      .querySelector("#ytsmp-player-placeholder")
      ?.closest?.("ytd-watch-flexy");
    if (isRenderedWatchFlexy(placeholderFlexy)) return placeholderFlexy;

    const flexies = Array.from(document.querySelectorAll("ytd-watch-flexy"));
    return (
      flexies.find(isRenderedWatchFlexy) ||
      (playerFlexy?.isConnected ? playerFlexy : null) ||
      (placeholderFlexy?.isConnected ? placeholderFlexy : null) ||
      flexies.find((flexy) => flexy.isConnected) ||
      null
    );
  };

  const getFlexyVideoIdentity = (flexy, urlVideoId, playerVideoId) => {
    const dataVideoId =
      flexy?.data?.playerResponse?.videoDetails?.videoId || "";
    const attributeVideoId = flexy?.getAttribute("video-id") || "";
    let videoId = dataVideoId || attributeVideoId;
    let source = dataVideoId ? "player-response" : "video-id-attribute";

    if (
      dataVideoId &&
      attributeVideoId &&
      dataVideoId !== attributeVideoId &&
      urlVideoId &&
      urlVideoId === playerVideoId
    ) {
      if (attributeVideoId === urlVideoId) {
        videoId = attributeVideoId;
        source = "video-id-attribute-confirmed-by-url-player";
      } else if (dataVideoId === urlVideoId) {
        videoId = dataVideoId;
        source = "player-response-confirmed-by-url-player";
      }
    }

    return { videoId, dataVideoId, attributeVideoId, source };
  };

  const getQueueState = () => {
    const item = document.querySelector(QUEUE_ITEM_SELECTOR);
    const link = item?.querySelector('a[href*="/watch?"], a[href^="/live/"]');
    return {
      videoId: getVideoIdFromUrl(link?.href || link?.getAttribute("href")),
      title: item?.querySelector("#video-title")?.textContent?.trim() || "",
    };
  };

  const getIdentityState = ({
    watchPath,
    urlVideoId,
    playerVideoId,
    flexyVideoId,
    queueVideoId,
  }) => {
    if (!watchPath) {
      return {
        status: "not-watch-page",
        reasons: ["not-watch-page"],
        comparisons: {},
      };
    }

    const pendingReasons = [];
    if (!urlVideoId) pendingReasons.push("url-video-id-pending");
    if (!playerVideoId) pendingReasons.push("player-video-id-pending");
    if (!flexyVideoId) pendingReasons.push("flexy-video-id-pending");

    const comparisons = {};
    const disagreementReasons = [];
    const compare = (name, leftId, rightId, disagreementReason) => {
      if (!leftId || !rightId) {
        comparisons[name] = null;
        return;
      }

      const agrees = leftId === rightId;
      comparisons[name] = agrees;
      if (!agrees) disagreementReasons.push(disagreementReason);
    };

    compare(
      "urlPlayer",
      urlVideoId,
      playerVideoId,
      "url-player-disagreement",
    );
    compare(
      "urlFlexy",
      urlVideoId,
      flexyVideoId,
      "url-flexy-disagreement",
    );
    compare(
      "playerFlexy",
      playerVideoId,
      flexyVideoId,
      "player-flexy-disagreement",
    );
    compare(
      "queueUrl",
      queueVideoId,
      urlVideoId,
      "selected-queue-url-disagreement",
    );
    compare(
      "queuePlayer",
      queueVideoId,
      playerVideoId,
      "selected-queue-player-disagreement",
    );
    compare(
      "queueFlexy",
      queueVideoId,
      flexyVideoId,
      "selected-queue-flexy-disagreement",
    );

    const reasons = [...disagreementReasons, ...pendingReasons];
    return {
      status: disagreementReasons.length
        ? "disagreement"
        : pendingReasons.length
          ? "pending"
          : "coherent",
      reasons: reasons.length ? reasons : ["all-available-identities-agree"],
      comparisons,
    };
  };

  const getCommentVideoIds = (comments) => {
    if (!comments) return [];

    return [
      ...new Set(
        Array.from(comments.querySelectorAll(COMMENT_PERMALINK_LINK_SELECTOR))
          .filter((link) => {
            const publishedTime = link.matches?.("#published-time-text")
              ? link
              : link.closest?.("#published-time-text");
            return Boolean(
              publishedTime && link.closest?.(COMMENT_RENDERER_SELECTOR),
            );
          })
          .map((link) =>
            getVideoIdFromUrl(link.href || link.getAttribute("href")),
          )
          .filter(Boolean),
      ),
    ];
  };

  const buildSnapshot = () => {
    const playerData = getPlayerData();
    const queue = getQueueState();
    const comments = document.querySelector("ytd-comments");
    const urlVideoId = getVideoIdFromUrl(location.href);
    const playerVideoId = playerData.video_id || "";
    const activeFlexy = getActiveWatchFlexy();
    const flexyIdentity = getFlexyVideoIdentity(
      activeFlexy,
      urlVideoId,
      playerVideoId,
    );
    const flexyVideoId = flexyIdentity.videoId;
    const watchPath = isWatchPath();
    const identity = getIdentityState({
      watchPath,
      urlVideoId,
      playerVideoId,
      flexyVideoId,
      queueVideoId: queue.videoId,
    });
    const confirmedMismatch = Boolean(
      watchPath &&
        urlVideoId &&
        playerVideoId &&
        flexyVideoId &&
        (urlVideoId !== playerVideoId ||
          urlVideoId !== flexyVideoId ||
          playerVideoId !== flexyVideoId),
    );
    const confirmedCoherent = Boolean(
      !watchPath ||
        (urlVideoId &&
          playerVideoId &&
          flexyVideoId &&
          urlVideoId === playerVideoId &&
          playerVideoId === flexyVideoId),
    );

    return {
      url: location.href,
      urlVideoId,
      playerVideoId,
      playerTitle: playerData.title || "",
      documentTitle: document.title,
      metadataTitle:
        document.querySelector(METADATA_TITLE_SELECTOR)?.textContent?.trim() ||
        "",
      flexyVideoId,
      flexyDataVideoId: flexyIdentity.dataVideoId,
      flexyAttributeVideoId: flexyIdentity.attributeVideoId,
      flexyIdentitySource: flexyIdentity.source,
      queueVideoId: queue.videoId,
      queueTitle: queue.title,
      identityStatus: identity.status,
      identityReasons: identity.reasons,
      identityComparisons: identity.comparisons,
      commentsPresent: Boolean(comments),
      commentsHiddenAsStale:
        comments?.getAttribute(COMMENTS_STALE_ATTRIBUTE) === "1",
      commentVideoIds: getCommentVideoIds(comments),
      confirmedMismatch,
      confirmedCoherent,
      stalePageData,
      mismatchChecks: consecutiveMismatchChecks,
    };
  };

  const publishState = (snapshot = buildSnapshot()) => {
    const root = document.documentElement;
    if (!root) return snapshot;

    root.setAttribute(STATE_ATTRIBUTE, JSON.stringify(snapshot));
    root.setAttribute(EVENTS_ATTRIBUTE, JSON.stringify(navigationEvents));
    return snapshot;
  };

  const removeLegacyNotice = () => {
    document.getElementById(LEGACY_NOTICE_ID)?.remove();
  };

  const setStalePageData = (stale) => {
    stalePageData = stale;
    const root = document.documentElement;
    if (root) {
      root.toggleAttribute(STALE_ATTRIBUTE, stale);
    }

    removeLegacyNotice();
  };

  const clearStaleRecoveryChecks = () => {
    staleRecoveryTimers.forEach((timerId) => clearTimeout(timerId));
    staleRecoveryTimers.clear();
  };

  const scheduleStaleRecoveryChecks = (snapshot) => {
    if (!isWatchPath() || !snapshot.urlVideoId) return;

    const generation = navigationGeneration;
    const videoId = snapshot.urlVideoId;
    const recoveryKey = `${generation}:${videoId}`;
    if (staleRecoveryKey === recoveryKey) return;

    clearStaleRecoveryChecks();
    staleRecoveryKey = recoveryKey;

    CONFIG.staleRecoveryDelaysMs.forEach((delay) => {
      const timerId = setTimeout(() => {
        staleRecoveryTimers.delete(timerId);
        if (
          generation !== navigationGeneration ||
          !isWatchPath() ||
          getVideoIdFromUrl(location.href) !== videoId
        ) {
          return;
        }

        runCoherenceCheck();
      }, delay);
      staleRecoveryTimers.add(timerId);
    });
  };

  const runCoherenceCheck = () => {
    const snapshot = buildSnapshot();

    if (snapshot.confirmedMismatch) {
      consecutiveMismatchChecks += 1;
      if (consecutiveMismatchChecks >= CONFIG.mismatchesBeforeWarning) {
        setStalePageData(true);
      }
    } else if (snapshot.confirmedCoherent || !isWatchPath()) {
      consecutiveMismatchChecks = 0;
      setStalePageData(false);
      clearStaleRecoveryChecks();
    }

    if (stalePageData) scheduleStaleRecoveryChecks(snapshot);

    snapshot.stalePageData = stalePageData;
    snapshot.mismatchChecks = consecutiveMismatchChecks;
    return publishState(snapshot);
  };

  const clearScheduledChecks = () => {
    checkTimers.forEach((timerId) => clearTimeout(timerId));
    checkTimers.clear();
  };

  const beginNavigationGeneration = (videoId = "") => {
    navigationGeneration += 1;
    navigationVideoId = videoId;
    staleRecoveryKey = "";
    consecutiveMismatchChecks = 0;
    clearScheduledChecks();
    clearStaleRecoveryChecks();
  };

  const alignNavigationGenerationToCurrentUrl = () => {
    const currentVideoId = getVideoIdFromUrl(location.href);
    if (!navigationVideoId) {
      navigationVideoId = currentVideoId;
      return false;
    }
    if (currentVideoId === navigationVideoId) return false;

    beginNavigationGeneration(currentVideoId);
    return true;
  };

  const scheduleChecks = () => {
    if (!isWatchPath()) {
      clearStaleRecoveryChecks();
      runCoherenceCheck();
      return;
    }

    const generation = navigationGeneration;
    const videoId = getVideoIdFromUrl(location.href);

    CONFIG.checkDelaysMs.forEach((delay) => {
      if (checkTimers.has(delay)) return;

      const timerId = setTimeout(() => {
        if (checkTimers.get(delay) === timerId) {
          checkTimers.delete(delay);
        }
        if (
          generation !== navigationGeneration ||
          getVideoIdFromUrl(location.href) !== videoId
        ) {
          return;
        }
        runCoherenceCheck();
      }, delay);
      checkTimers.set(delay, timerId);
    });
  };

  const recordNavigationEvent = (type) => {
    const snapshot = buildSnapshot();
    navigationEvents.push({
      type,
      timestamp: Date.now(),
      urlVideoId: snapshot.urlVideoId,
      playerVideoId: snapshot.playerVideoId,
      flexyVideoId: snapshot.flexyVideoId,
      queueVideoId: snapshot.queueVideoId,
      identityStatus: snapshot.identityStatus,
      identityReasons: snapshot.identityReasons,
    });
    if (navigationEvents.length > CONFIG.eventHistoryLimit) {
      navigationEvents.splice(0, navigationEvents.length - CONFIG.eventHistoryLimit);
    }
    publishState(snapshot);
  };

  const handleNavigateStart = () => {
    beginNavigationGeneration();
    recordNavigationEvent("yt-navigate-start");
  };

  const handleNavigationUpdate = (event) => {
    alignNavigationGenerationToCurrentUrl();
    recordNavigationEvent(event.type);
    scheduleChecks();
  };

  const handlePageHide = () => {
    beginNavigationGeneration();
  };

  const handlePageShow = () => {
    beginNavigationGeneration(getVideoIdFromUrl(location.href));
    recordNavigationEvent("pageshow");
    scheduleChecks();
  };

  const buildCss = () => `
    :root[${STALE_ATTRIBUTE}] ytd-watch-metadata h1,
    :root[${STALE_ATTRIBUTE}] ytd-watch-metadata #owner,
    :root[${STALE_ATTRIBUTE}] ytd-watch-metadata #bottom-row,
    :root[${STALE_ATTRIBUTE}] ytd-video-primary-info-renderer h1,
    :root[${STALE_ATTRIBUTE}] ytd-video-primary-info-renderer #info-text,
    :root[${STALE_ATTRIBUTE}] ytd-video-secondary-info-renderer {
      display: none !important;
    }

    :root[${STALE_ATTRIBUTE}] ytd-comments {
      visibility: hidden !important;
      opacity: 0 !important;
      pointer-events: none !important;
    }
  `;

  GM_addStyle(buildCss());

  globalThis.__YT_MASTER_STATE__ = Object.freeze({
    check: runCoherenceCheck,
    events: () => navigationEvents.map((entry) => ({ ...entry })),
    snapshot: () => publishState(buildSnapshot()),
  });

  window.addEventListener("yt-navigate-start", handleNavigateStart, true);
  window.addEventListener("yt-navigate-finish", handleNavigationUpdate, true);
  window.addEventListener("yt-page-data-updated", handleNavigationUpdate, true);
  window.addEventListener("pagehide", handlePageHide, true);
  window.addEventListener("pageshow", handlePageShow, true);
  document.addEventListener(
    "visibilitychange",
    () => {
      if (document.visibilityState !== "visible") return;

      alignNavigationGenerationToCurrentUrl();
      scheduleChecks();
    },
    true,
  );
  document.addEventListener(
    "loadedmetadata",
    (event) => {
      if (!isWatchPath()) return;

      const player = getActivePlayer();
      const activeVideo =
        player?.querySelector("video.html5-main-video") ||
        player?.querySelector("video");
      if (event.target !== activeVideo) return;

      alignNavigationGenerationToCurrentUrl();
      recordNavigationEvent("loadedmetadata");
      scheduleChecks();
    },
    true,
  );

  const flexyIdentityObserver = new MutationObserver((mutations) => {
    if (!isWatchPath()) return;

    const activeFlexy = getActiveWatchFlexy();
    if (
      !mutations.some(
        (mutation) =>
          mutation.type === "attributes" && mutation.target === activeFlexy,
      )
    ) {
      return;
    }

    alignNavigationGenerationToCurrentUrl();
    runCoherenceCheck();
    scheduleChecks();
  });
  flexyIdentityObserver.observe(document.documentElement, {
    attributeFilter: ["video-id"],
    attributes: true,
    subtree: true,
  });

  removeLegacyNotice();
  navigationVideoId = getVideoIdFromUrl(location.href);
  publishState();
  scheduleChecks();
})();
