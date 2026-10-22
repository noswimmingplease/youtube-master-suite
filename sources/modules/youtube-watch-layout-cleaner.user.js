// ==UserScript==
// @name         YouTube Watch Layout Cleaner
// @namespace    Citizen.youtube.watch-layout-cleaner
// @version      1.46
// @description  Expands YouTube watch pages, keeps the right rail fixed at SponsorBlock-friendly width, preserves its visible popup, and widens metadata/comments.
// @author       Citizen
// @homepageURL  https://github.com/noswimmingplease/youtube-watch-layout-cleaner
// @supportURL   https://github.com/noswimmingplease/youtube-watch-layout-cleaner/issues
// @updateURL    https://raw.githubusercontent.com/noswimmingplease/youtube-watch-layout-cleaner/main/youtube-watch-layout-cleaner.user.js
// @downloadURL  https://raw.githubusercontent.com/noswimmingplease/youtube-watch-layout-cleaner/main/youtube-watch-layout-cleaner.user.js
// @match        https://www.youtube.com/*
// @run-at       document-start
// @grant        none
// @noframes
// ==/UserScript==

(() => {
  "use strict";

  const CONFIG = {
    sidebarWidthPx: 374,
    queueLayoutBreakpointPx: 1000,
    relatedVideosHideBreakpointPx: 1400,
    showDeArrowQueueButton: true,
  };

  const STYLE_ID = "tm-youtube-watch-layout-cleaner";
  const PLAYLIST_PANEL_SELECTORS = [
    "ytd-playlist-panel-renderer",
    "yt-playlist-panel-renderer",
  ];
  const PLAYLIST_PANEL_SELECTOR = PLAYLIST_PANEL_SELECTORS.join(",");
  const QUEUE_THUMBNAIL_FALLBACK_DELAYS_MS = [750, 1500];
  const QUEUE_ITEM_SELECTOR = [
    "ytd-playlist-panel-video-renderer",
    "yt-playlist-panel-video-renderer",
  ].join(",");
  const QUEUE_THUMBNAIL_TARGET_SELECTOR = [
    "a#thumbnail",
    "ytd-thumbnail",
    "yt-thumbnail-view-model",
    ".ytThumbnailViewModelHost",
  ].join(",");
  const QUEUE_THUMBNAIL_FALLBACK_ATTRIBUTE =
    "data-ywlc-thumbnail-fallback";
  const QUEUE_THUMBNAIL_FALLBACK_CSS_PROPERTY =
    "--ywlc-thumbnail-fallback-image";
  const QUEUE_THUMBNAIL_FALLBACK_ROOT_MARGIN = "200px 0px";
  const QUEUE_THUMBNAIL_FALLBACK_STYLE_SELECTOR = PLAYLIST_PANEL_SELECTORS.map(
    (panelSelector) =>
      `${panelSelector} [${QUEUE_THUMBNAIL_FALLBACK_ATTRIBUTE}="1"]`,
  ).join(",\n");
  const EMPTY_SECONDARY_RAIL_ATTRIBUTE = "data-ywlc-empty-secondary-rail";
  const AUXILIARY_RAIL_SURFACE_SELECTOR = [
    "#sponsorBlockPopupContainer",
    "#sponsorBlockPopupContainer iframe",
  ].join(",");
  const CHAT_SURFACE_SELECTOR = [
    "ytd-live-chat-frame#chat",
    'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-live-chat"]',
    "ytd-engagement-panel-section-list-renderer:has(yt-live-chat-app)",
  ].join(",");
  const ENGAGEMENT_PANEL_SELECTOR =
    "ytd-engagement-panel-section-list-renderer";
  const RAIL_MUTATION_TARGET_SELECTOR = [
    PLAYLIST_PANEL_SELECTOR,
    CHAT_SURFACE_SELECTOR,
    ENGAGEMENT_PANEL_SELECTOR,
    "#chat-container",
    "#panels",
    "#related",
    "#secondary",
    "#secondary-inner",
    AUXILIARY_RAIL_SURFACE_SELECTOR,
  ].join(",");
  const QUEUE_ITEM_MUTATION_ATTRIBUTES = [
    "aria-current",
    "aria-selected",
    "href",
    "selected",
    "src",
  ];
  const SURFACE_STATE_MUTATION_ATTRIBUTES = [
    "aria-current",
    "aria-hidden",
    "aria-selected",
    "class",
    "collapsed",
    "hidden",
    "selected",
    "style",
    "visibility",
  ];
  const DISCOVERY_MUTATION_ATTRIBUTES = [
    ...new Set([
      ...QUEUE_ITEM_MUTATION_ATTRIBUTES,
      ...SURFACE_STATE_MUTATION_ATTRIBUTES,
    ]),
  ];
  const PANEL_MUTATION_ATTRIBUTES = DISCOVERY_MUTATION_ATTRIBUTES;
  const WATCH_FLEXY_SELECTORS = [
    "ytd-watch-flexy[flexy]",
    "ytd-watch-flexy[flexy_]",
    "ytd-watch-flexy[is-two-columns]",
    "ytd-watch-flexy[is-two-columns_]",
    "ytd-watch-flexy[theater]",
    "ytd-watch-flexy[theatre]",
    "ytd-watch-flexy[is-watch-wide]",
  ];
  const WATCH_FLEXY_SELECTOR = WATCH_FLEXY_SELECTORS.join(",\n");
  const TWO_COLUMN_WATCH_FLEXY_SELECTORS = [
    "ytd-watch-flexy[is-two-columns]",
    "ytd-watch-flexy[is-two-columns_]",
  ];
  const TWO_COLUMN_WATCH_FLEXY_SELECTOR =
    TWO_COLUMN_WATCH_FLEXY_SELECTORS.join(",\n");
  const EMPTY_SECONDARY_RAIL_SELECTOR =
    TWO_COLUMN_WATCH_FLEXY_SELECTORS.map(
      (watchSelector) =>
        `${watchSelector}[${EMPTY_SECONDARY_RAIL_ATTRIBUTE}="1"]`,
    ).join(",\n");
  let queueThumbnailFallbackTimers = [];
  let queueThumbnailFallbackObserver = null;
  let observedRailMutationTargets = new Set();
  let queueThumbnailMutationFrame = 0;
  let railStateReconciliationFrame = 0;
  const pendingQueueThumbnailItems = new Set();

  function px(value) {
    return `${value}px`;
  }

  function watchFlexyChildSelector(...childSelectors) {
    return WATCH_FLEXY_SELECTORS.flatMap((watchSelector) =>
      childSelectors.map(
        (childSelector) => `${watchSelector} ${childSelector}`,
      ),
    ).join(",\n");
  }

  function buildQueueCompatibilityCss() {
    const titleParentSelector =
      ":is(ytd-playlist-panel-video-renderer, yt-playlist-panel-video-renderer) " +
      ":has(> #video-title.cbCustomTitle)";
    if (!CONFIG.showDeArrowQueueButton) {
      return `
/* Hide only DeArrow's original-title button in queue rows, not its replacements. */
${titleParentSelector} > .cbShowOriginal {
  display: none !important;
}
`;
    }

    return `
/* Reserve the slot before DeArrow inserts its button so hover cannot reflow titles.
   Keep DeArrow's original/custom title and button visibility rules untouched. */
${titleParentSelector} {
  position: relative !important;
  box-sizing: border-box !important;
  padding-inline-end: 25px !important;
}

${titleParentSelector} > .cbShowOriginal {
  position: absolute !important;
  inset-inline-end: 0 !important;
  top: 0 !important;
  width: 20px !important;
  height: 20px !important;
  max-width: 20px !important;
  max-height: 20px !important;
  box-sizing: border-box !important;
  margin: 0 !important;
  padding: 0 !important;
}
`;
  }

  function buildCss() {
    return `
/* Watch pages only. Keeps the right rail while allowing the player column to use wide screens. */
${WATCH_FLEXY_SELECTOR}{
  --ytd-watch-flexy-max-player-width: none !important;
  --ytd-watch-flexy-max-player-width-wide-screen: none !important;
}

@media (min-width: ${px(CONFIG.queueLayoutBreakpointPx + 1)}) {
  ${TWO_COLUMN_WATCH_FLEXY_SELECTOR}{
    --ytd-watch-flexy-sidebar-width: ${px(CONFIG.sidebarWidthPx)} !important;
  }
}

/* Collapse only a rail confirmed empty by the live DOM-state reconciliation. */
@media (min-width: ${px(CONFIG.queueLayoutBreakpointPx + 1)}) {
  ${EMPTY_SECONDARY_RAIL_SELECTOR}{
    --ytd-watch-flexy-sidebar-width: 0px !important;
  }
}

${watchFlexyChildSelector("#columns.ytd-watch-flexy")}{
  max-width: none !important;
  box-sizing: border-box !important;
}

${watchFlexyChildSelector("#primary.ytd-watch-flexy")}{
  flex: 1 1 auto !important;
  min-width: 0 !important;
  max-width: none !important;
}

${watchFlexyChildSelector(
  "#primary-inner.ytd-watch-flexy",
  "#above-the-fold",
  "#description",
  "#top-row",
  "#player.ytd-watch-flexy",
  "#player-container-outer.ytd-watch-flexy",
)}{
  box-sizing: border-box !important;
  width: 100% !important;
  max-width: none !important;
}

ytd-comments #sections {
  margin-right: 0 !important;
}

ytd-comments,
ytd-comments ytd-item-section-renderer,
ytd-comments ytd-comment-thread-renderer {
  max-width: 100% !important;
}

${QUEUE_THUMBNAIL_FALLBACK_STYLE_SELECTOR} {
  background-image: var(${QUEUE_THUMBNAIL_FALLBACK_CSS_PROPERTY}) !important;
  background-position: center !important;
  background-repeat: no-repeat !important;
  background-size: cover !important;
}

/* Leave only comments below the video once YouTube switches to its narrow layout. */
@media (max-width: ${px(CONFIG.relatedVideosHideBreakpointPx)}) {
  #related {
    display: none !important;
  }
}

${buildQueueCompatibilityCss()}
`;
  }

  function isWatchPath() {
    return location.pathname === "/watch" || location.pathname.startsWith("/live/");
  }

  function ensureStyle() {
    const css = isWatchPath() ? buildCss() : buildQueueCompatibilityCss();
    if (!css) {
      removeStyle();
      return;
    }

    let style = document.getElementById(STYLE_ID);
    if (!style) {
      style = document.createElement("style");
      style.id = STYLE_ID;
      (document.head || document.documentElement).appendChild(style);
    }

    if (style.textContent !== css) style.textContent = css;
  }

  function removeStyle() {
    const style = document.getElementById(STYLE_ID);
    if (style) style.remove();
  }

  function getQueueItemVideoId(item) {
    const links = item.querySelectorAll('a[href*="/watch"]');

    for (const link of links) {
      let videoId = "";
      try {
        videoId = new URL(link.href || link.getAttribute("href"), location.origin)
          .searchParams.get("v") || "";
      } catch {
        continue;
      }

      if (/^[A-Za-z0-9_-]{11}$/.test(videoId)) return videoId;
    }

    return "";
  }

  function hasLoadedQueueThumbnail(item) {
    return Array.from(item.querySelectorAll("img")).some((image) => {
      if (!image.complete || image.naturalWidth <= 0) return false;

      const rect = image.getBoundingClientRect();
      const style = getComputedStyle(image);
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        Number(style.opacity) > 0
      );
    });
  }

  function clearQueueThumbnailFallback(item) {
    item.querySelectorAll(
      `[${QUEUE_THUMBNAIL_FALLBACK_ATTRIBUTE}="1"]`,
    ).forEach((target) => {
      target.removeAttribute(QUEUE_THUMBNAIL_FALLBACK_ATTRIBUTE);
      target.style.removeProperty(QUEUE_THUMBNAIL_FALLBACK_CSS_PROPERTY);
    });
  }

  function applyQueueThumbnailFallback(item) {
    if (hasLoadedQueueThumbnail(item)) {
      clearQueueThumbnailFallback(item);
      return;
    }

    const videoId = getQueueItemVideoId(item);
    if (!videoId) return;

    const thumbnailUrl = `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;
    item.querySelectorAll(QUEUE_THUMBNAIL_TARGET_SELECTOR).forEach(
      (target) => {
        target.setAttribute(QUEUE_THUMBNAIL_FALLBACK_ATTRIBUTE, "1");
        target.style.setProperty(
          QUEUE_THUMBNAIL_FALLBACK_CSS_PROPERTY,
          `url("${thumbnailUrl}")`,
        );
      },
    );
  }

  function getQueueThumbnailFallbackObserver() {
    if (
      queueThumbnailFallbackObserver ||
      typeof IntersectionObserver !== "function"
    ) {
      return queueThumbnailFallbackObserver;
    }

    queueThumbnailFallbackObserver = new IntersectionObserver(
      (entries, observer) => {
        entries.forEach((entry) => {
          if (
            !entry.target.isConnected ||
            !entry.target.closest(PLAYLIST_PANEL_SELECTOR) ||
            !isWatchPath()
          ) {
            observer.unobserve(entry.target);
            pendingQueueThumbnailItems.delete(entry.target);
            return;
          }
          if (!entry.isIntersecting) return;

          observer.unobserve(entry.target);
          applyQueueThumbnailFallback(entry.target);
        });
      },
      { rootMargin: QUEUE_THUMBNAIL_FALLBACK_ROOT_MARGIN },
    );

    return queueThumbnailFallbackObserver;
  }

  function addQueueItemsFromNode(items, node) {
    const element =
      node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
    if (!element) return;

    const closestItem = element.closest?.(QUEUE_ITEM_SELECTOR);
    if (closestItem?.closest(PLAYLIST_PANEL_SELECTOR)) {
      items.add(closestItem);
    }
    element.querySelectorAll?.(QUEUE_ITEM_SELECTOR).forEach((item) => {
      if (item.closest(PLAYLIST_PANEL_SELECTOR)) items.add(item);
    });
  }

  function unobserveRemovedQueueItems(node) {
    if (node?.nodeType !== Node.ELEMENT_NODE) return;

    const items = new Set(node.querySelectorAll(QUEUE_ITEM_SELECTOR));
    if (node.matches(QUEUE_ITEM_SELECTOR)) items.add(node);
    items.forEach((item) => {
      if (item.isConnected && item.closest(PLAYLIST_PANEL_SELECTOR)) return;
      queueThumbnailFallbackObserver?.unobserve(item);
      pendingQueueThumbnailItems.delete(item);
    });
  }

  function flushPendingQueueThumbnailItems() {
    queueThumbnailMutationFrame = 0;
    const items = Array.from(pendingQueueThumbnailItems);
    pendingQueueThumbnailItems.clear();
    if (!isWatchPath()) return;

    const observer = getQueueThumbnailFallbackObserver();
    items.forEach((item) => {
      if (!item.isConnected || !item.closest(PLAYLIST_PANEL_SELECTOR)) return;
      if (observer) {
        observer.observe(item);
      } else {
        applyQueueThumbnailFallback(item);
      }
    });
  }

  function scheduleQueueThumbnailItems(items) {
    items.forEach((item) => pendingQueueThumbnailItems.add(item));
    if (!pendingQueueThumbnailItems.size || queueThumbnailMutationFrame) return;

    queueThumbnailMutationFrame = requestAnimationFrame(
      flushPendingQueueThumbnailItems,
    );
  }

  function canRenderSurface(element) {
    if (
      !element?.isConnected ||
      element.hidden ||
      element.getAttribute("aria-hidden") === "true"
    ) {
      return false;
    }

    const style = getComputedStyle(element);
    return style.display !== "none" && !["hidden", "collapse"].includes(
      style.visibility,
    );
  }

  function isElementOrAncestorHidden(element, boundary) {
    if (!element?.isConnected) return true;

    let current = element;
    while (current) {
      if (!canRenderSurface(current)) return true;
      if (current === boundary) return false;
      current = current.parentElement;
    }
    return true;
  }

  function isActiveChatSurface(surface) {
    return (
      !surface.hasAttribute("collapsed") &&
      !isElementOrAncestorHidden(surface, surface.closest("ytd-watch-flexy"))
    );
  }

  function isActiveQueuePanel(panel) {
    return (
      Boolean(panel.querySelector(QUEUE_ITEM_SELECTOR)) &&
      !isElementOrAncestorHidden(panel, panel.closest("ytd-watch-flexy"))
    );
  }

  function isActiveEngagementPanel(panel) {
    const visibility = panel.getAttribute("visibility");
    return (
      (!visibility || visibility === "ENGAGEMENT_PANEL_VISIBILITY_EXPANDED") &&
      !panel.hasAttribute("collapsed") &&
      !isElementOrAncestorHidden(panel, panel.closest("ytd-watch-flexy"))
    );
  }

  function isActiveAuxiliaryRailSurface(surface) {
    if (
      isElementOrAncestorHidden(surface, surface.closest("ytd-watch-flexy"))
    ) {
      return false;
    }

    const bounds = surface.getBoundingClientRect();
    return bounds.width > 0 && bounds.height > 0;
  }

  function reconcileSecondaryRailState() {
    railStateReconciliationFrame = 0;
    document.querySelectorAll("ytd-watch-flexy").forEach((watchFlexy) => {
      const eligible =
        isWatchPath() && watchFlexy.matches(TWO_COLUMN_WATCH_FLEXY_SELECTOR);
      const related = eligible ? watchFlexy.querySelector("#related") : null;
      const relatedHidden =
        eligible &&
        (!related || isElementOrAncestorHidden(related, watchFlexy));
      const chatVisible =
        eligible &&
        Array.from(watchFlexy.querySelectorAll(CHAT_SURFACE_SELECTOR)).some(
          isActiveChatSurface,
        );
      const queueVisible =
        eligible &&
        Array.from(
          watchFlexy.querySelectorAll(PLAYLIST_PANEL_SELECTOR),
        ).some(isActiveQueuePanel);
      const auxiliarySurfaceVisible =
        eligible &&
        Array.from(
          watchFlexy.querySelectorAll(AUXILIARY_RAIL_SURFACE_SELECTOR),
        ).some(isActiveAuxiliaryRailSurface);
      const engagementPanelVisible =
        eligible &&
        Array.from(
          watchFlexy.querySelectorAll(`#secondary ${ENGAGEMENT_PANEL_SELECTOR}`),
        ).some(isActiveEngagementPanel);
      const railIsEmpty =
        eligible &&
        relatedHidden &&
        !chatVisible &&
        !queueVisible &&
        !auxiliarySurfaceVisible &&
        !engagementPanelVisible;

      if (railIsEmpty) {
        watchFlexy.setAttribute(EMPTY_SECONDARY_RAIL_ATTRIBUTE, "1");
      } else {
        watchFlexy.removeAttribute(EMPTY_SECONDARY_RAIL_ATTRIBUTE);
      }
    });
  }

  function scheduleSecondaryRailStateReconciliation() {
    if (railStateReconciliationFrame) return;
    railStateReconciliationFrame = requestAnimationFrame(
      reconcileSecondaryRailState,
    );
  }

  function getRailMutationTargets() {
    if (!isWatchPath()) return [];

    const targets = new Set();
    document.querySelectorAll("ytd-watch-flexy").forEach((watchFlexy) => {
      watchFlexy
        .querySelectorAll(RAIL_MUTATION_TARGET_SELECTOR)
        .forEach((target) => targets.add(target));
      const secondary = watchFlexy.querySelector("#secondary");
      targets.add(secondary || watchFlexy);
      if (secondary?.parentElement) {
        targets.add(secondary.parentElement);
      }
    });
    return Array.from(targets);
  }

  function getNodeElement(node) {
    return node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
  }

  function nodeContainsRailMutationTarget(node) {
    const element = getNodeElement(node);
    return Boolean(
      element &&
        (element.matches(RAIL_MUTATION_TARGET_SELECTOR) ||
          element.querySelector(RAIL_MUTATION_TARGET_SELECTOR)),
    );
  }

  function nodeContainsQueueItem(node) {
    const element = getNodeElement(node);
    return Boolean(
      element &&
        (element.matches(QUEUE_ITEM_SELECTOR) ||
          element.querySelector(QUEUE_ITEM_SELECTOR)),
    );
  }

  function isDiscoveryMutationTarget(target) {
    return target.matches("ytd-watch-flexy, #secondary");
  }

  function isSecondaryRailMutationAnchor(target) {
    return Array.from(target.children || []).some(
      (child) =>
        child.matches?.("#secondary") &&
        child.closest("ytd-watch-flexy") === target.closest("ytd-watch-flexy"),
    );
  }

  function mutationAffectsRailState(mutation) {
    const element = getNodeElement(mutation.target);
    if (!element) return false;

    if (mutation.type === "attributes") {
      if (
        ["aria-current", "aria-selected", "selected"].includes(
          mutation.attributeName,
        ) &&
        element.closest(QUEUE_ITEM_SELECTOR)
      ) {
        return true;
      }
      return (
        SURFACE_STATE_MUTATION_ATTRIBUTES.includes(mutation.attributeName) &&
        (element.matches(RAIL_MUTATION_TARGET_SELECTOR) ||
          isDiscoveryMutationTarget(element))
      );
    }

    if (mutation.type !== "childList") return false;
    const changedNodes = [...mutation.addedNodes, ...mutation.removedNodes];
    if (element.closest(AUXILIARY_RAIL_SURFACE_SELECTOR)) {
      return true;
    }
    if (element.closest(`${CHAT_SURFACE_SELECTOR}, #chat-container`)) {
      return true;
    }
    if (element.closest(PLAYLIST_PANEL_SELECTOR)) {
      return changedNodes.some(nodeContainsQueueItem);
    }
    return changedNodes.some(
      (node) =>
        nodeContainsRailMutationTarget(node) || nodeContainsQueueItem(node),
    );
  }

  function refreshRailMutationObserver() {
    const nextTargets = new Set(getRailMutationTargets());
    if (
      nextTargets.size === observedRailMutationTargets.size &&
      [...nextTargets].every((target) =>
        observedRailMutationTargets.has(target),
      )
    ) {
      return;
    }

    const registrations = [...nextTargets].map((target) => {
      const isSecondaryRailAnchor =
        isSecondaryRailMutationAnchor(target);
      const isDiscoveryTarget = isDiscoveryMutationTarget(target);
      const isPlaylistPanel = target.matches(PLAYLIST_PANEL_SELECTOR);
      const isAuxiliaryRailSurface = target.matches(
        AUXILIARY_RAIL_SURFACE_SELECTOR,
      );
      return [
        target,
        isSecondaryRailAnchor
          ? {
              childList: true,
            }
          : isDiscoveryTarget
          ? {
              attributeFilter: DISCOVERY_MUTATION_ATTRIBUTES,
              attributes: true,
              childList: true,
              subtree: true,
            }
          : isPlaylistPanel
          ? {
              attributeFilter: PANEL_MUTATION_ATTRIBUTES,
              attributes: true,
              childList: true,
              subtree: true,
            }
          : isAuxiliaryRailSurface
          ? {
              attributeFilter: SURFACE_STATE_MUTATION_ATTRIBUTES,
              attributes: true,
              childList: true,
              subtree: true,
            }
          : {
              attributeFilter: SURFACE_STATE_MUTATION_ATTRIBUTES,
              attributes: true,
              childList: target.matches(
                "#chat-container, ytd-engagement-panel-section-list-renderer",
              ),
            },
      ];
    });
    replaceObserverRegistrations(railMutationObserver, registrations);
    observedRailMutationTargets = nextTargets;
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

  const railMutationObserver = new MutationObserver((mutations) => {
    if (!isWatchPath()) return;

    const items = new Set();
    let railStateMayHaveChanged = false;
    let targetsMayHaveChanged = false;
    mutations.forEach((mutation) => {
      railStateMayHaveChanged ||= mutationAffectsRailState(mutation);
      if (mutation.type === "attributes") {
        if (QUEUE_ITEM_MUTATION_ATTRIBUTES.includes(mutation.attributeName)) {
          addQueueItemsFromNode(items, mutation.target);
        }
        return;
      }
      if (mutation.type !== "childList") return;

      addQueueItemsFromNode(items, mutation.target);
      mutation.addedNodes?.forEach((node) => addQueueItemsFromNode(items, node));
      mutation.removedNodes?.forEach(unobserveRemovedQueueItems);
      targetsMayHaveChanged ||=
        Array.from(mutation.addedNodes || []).some(
          nodeContainsRailMutationTarget,
        ) ||
        Array.from(mutation.removedNodes || []).some(
          nodeContainsRailMutationTarget,
        );
    });
    scheduleQueueThumbnailItems(items);
    if (railStateMayHaveChanged) {
      scheduleSecondaryRailStateReconciliation();
      scheduleQueuePlayingMarkerReconciliation();
    }
    if (targetsMayHaveChanged) refreshRailMutationObserver();
  });

  function applyQueueThumbnailFallbacks() {
    const panels = isWatchPath()
      ? Array.from(document.querySelectorAll(PLAYLIST_PANEL_SELECTOR))
      : [];
    refreshRailMutationObserver();
    scheduleSecondaryRailStateReconciliation();
    if (!panels.length) return;

    const observer = getQueueThumbnailFallbackObserver();
    panels.forEach((panel) => {
      panel.querySelectorAll(QUEUE_ITEM_SELECTOR).forEach((item) => {
        if (observer) {
          observer.observe(item);
        } else {
          applyQueueThumbnailFallback(item);
        }
      });
    });
  }

  function scheduleQueueThumbnailFallbacks() {
    if (queueThumbnailFallbackObserver) {
      queueThumbnailFallbackObserver.disconnect();
      queueThumbnailFallbackObserver.takeRecords();
    }
    queueThumbnailFallbackTimers.forEach((timerId) => clearTimeout(timerId));
    refreshRailMutationObserver();
    scheduleSecondaryRailStateReconciliation();
    queueThumbnailFallbackTimers = QUEUE_THUMBNAIL_FALLBACK_DELAYS_MS.map(
      (delay) => setTimeout(applyQueueThumbnailFallbacks, delay),
    );
  }

  function installQueuePlayingMarkerReconciliation() {
    const panelSelector = "ytd-playlist-panel-renderer, yt-playlist-panel-renderer";
    const rowSelector = "ytd-playlist-panel-video-renderer, yt-playlist-panel-video-renderer";
    const controller = element => element?.polymerController || element?.getPolymerController?.() || element;
    const attempted = new WeakMap();
    let frame = 0;
    let navigating = false;

    function reconcile() {
      frame = 0;
      if (navigating) return;
      const players = [...document.querySelectorAll('#movie_player')].filter(player =>
        player.isConnected && player.getClientRects().length);
      if (players.length !== 1 || players[0].classList.contains('ad-showing') ||
          players[0].classList.contains('ad-interrupting')) return;
      const player = players[0];
      let videoId, listId;
      try {
        videoId = player.getVideoData?.()?.video_id;
        listId = player.getPlaylistId?.();
      } catch { return; }
      if (typeof videoId !== 'string' || !/^[\w-]{11}$/.test(videoId) ||
          typeof listId !== 'string' || !listId.startsWith('TLPQ')) return;
      for (const panel of document.querySelectorAll(panelSelector)) {
        try {
          const owner = controller(panel), data = owner?.data;
          if (!panel.isConnected || data?.playlistId !== listId || !Array.isArray(data.contents) ||
              !data.contents.length || data.contents.length > 1000 ||
              !Number.isInteger(data.currentIndex) ||
              (Number.isInteger(data.totalVideos) && data.totalVideos !== data.contents.length)) continue;
          const videos = data.contents.map(item => item.playlistPanelVideoRenderer);
          const index = data.currentIndex;
          if (videos.some(video => !video || typeof video.videoId !== 'string' || !/^[\w-]{11}$/.test(video.videoId)) ||
              videos[index]?.videoId !== videoId || videos.filter(video => video.videoId === videoId).length !== 1) continue;
          const items = panel.querySelector('#items');
          const rows = items ? [...items.children] : [];
          // Do not touch a partially stamped panel or a DOM move awaiting commit.
          if (rows.length !== videos.length || rows.some((row, i) => !row.matches(rowSelector) ||
              controller(row)?.data?.videoId !== videos[i].videoId ||
              !videos[i].playlistSetVideoId || controller(row)?.data?.playlistSetVideoId !== videos[i].playlistSetVideoId)) continue;
          const reorder = owner.ytReorderableController;
          if (reorder && Object.getOwnPropertyNames(reorder).some(name =>
            name.endsWith('dragListGroup') && reorder[name]?.isDragging?.())) continue;
          const modelMismatch = videos.some((video, i) => Boolean(video.selected) !== (i === index));
          const rowMismatch = (row, i) => {
            const rowOwner = controller(row), selected = i === index;
            return Boolean(rowOwner.data.selected) !== selected ||
              (typeof rowOwner.selected === 'boolean' && rowOwner.selected !== selected) ||
              row.hasAttribute('selected') !== selected;
          };
          if (!modelMismatch && !rows.some(rowMismatch)) { attempted.delete(panel); continue; }
          const signature = JSON.stringify([listId, videoId, index, videos.map((video, i) =>
            [video.playlistSetVideoId, Boolean(video.selected), Boolean(controller(rows[i]).data.selected),
              controller(rows[i]).selected, rows[i].hasAttribute('selected')])]);
          if (attempted.get(panel) === signature) continue; // A native no-op must not create a restamping loop.
          if (modelMismatch) {
            if (typeof owner.set !== 'function') continue;
            attempted.set(panel, signature);
            // Rebind only the panel's display model. The native playlist manager,
            // queue order, endpoints and playback are deliberately left alone.
            owner.set('data', { ...data, contents: data.contents.map((item, i) =>
              Boolean(videos[i].selected) === (i === index) ? item :
                { ...item, playlistPanelVideoRenderer: { ...videos[i], selected: i === index } }) });
            continue; // Let the native stamper finish before checking reused rows.
          }
          rows.forEach((row, i) => {
            const rowOwner = controller(row), selected = i === index;
            if (typeof rowOwner.set !== 'function') return;
            if (rowMismatch(row, i)) {
              attempted.set(panel, signature);
              // selected is a native computed property of data; rebind data rather
              // than overriding that property or hiding its arrow with CSS.
              rowOwner.set('data', { ...rowOwner.data, selected });
            }
          });
        } catch { /* Unknown native bindings are left untouched. */ }
      }
    }

    function schedule() {
      if (!navigating && !frame) frame = requestAnimationFrame(reconcile);
    }
    ['yt-playlist-data-updated', 'yt-page-data-updated'].forEach(type => window.addEventListener(type, schedule, true));
    window.addEventListener('yt-rendererstamper-finished', event => {
      if (event.target?.closest?.(panelSelector)) schedule();
    }, true);
    window.addEventListener('yt-navigate-start', () => {
      navigating = true;
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
    }, true);
    ['yt-navigate-finish', 'pageshow'].forEach(type => window.addEventListener(type, () => {
      navigating = false;
      schedule();
    }, true));
    window.addEventListener('pagehide', () => {
      navigating = true;
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
    }, true);
    schedule();
    return schedule;
  }

  function installQueuePlayNext() {
    const marker = "ytMasterPlayNext";
    const panelSelector = "ytd-playlist-panel-renderer, yt-playlist-panel-renderer";
    const rowSelector = "ytd-playlist-panel-video-renderer, yt-playlist-panel-video-renderer";
    let entries = new WeakMap();
    let sheets = new WeakMap();
    let pending = null;
    let toast = null;
    let toastTimer = 0;
    let menuFrame = 0;

    const controller = (element) => element?.polymerController || element?.getPolymerController?.() || element;
    const validId = (value) => typeof value === "string" && /^[\w-]{11}$/.test(value);

    function sheetData(popup) {
      // Current view-model wrappers deliberately return a Symbol from .data.
      // Their native reactive getter and external .data setter remain separate.
      const read = popup?.componentProps?.data;
      try { return typeof read === "function" ? read() : null; }
      catch { return null; } // A dismissed native sheet may already be disposed.
    }

    function queueCommand(item) {
      const data = item?.menuServiceItemRenderer || item?.listItemViewModel;
      const endpoint = data?.serviceEndpoint || data?.rendererContext?.commandContext?.onTap?.innertubeCommand;
      const actions = endpoint?.signalServiceEndpoint?.actions;
      if (!Array.isArray(actions) || actions.length !== 1) return null;
      const command = actions[0]?.addToPlaylistCommand;
      if (command?.listType !== "PLAYLIST_EDIT_LIST_TYPE_QUEUE") return null;
      const ids = command.videoIds || [command.videoId];
      if (!Array.isArray(ids) || ids.length !== 1 || !validId(ids[0]) ||
          (command.videoId !== undefined && command.videoId !== ids[0])) return null;
      return { endpoint, command, videoId: ids[0] };
    }

    function activeVideoId() {
      const ids = new Set();
      let visible = 0;
      for (const player of document.querySelectorAll('#movie_player')) {
        if (!player.isConnected || !player.getClientRects().length) continue;
        visible++;
        const id = player.getVideoData?.()?.video_id;
        if (validId(id)) ids.add(id);
      }
      return visible === 1 && ids.size === 1 ? [...ids][0] : visible ? undefined : null;
    }

    function activePlayer(anchor) {
      return [...document.querySelectorAll('#movie_player')].find(player =>
        player.isConnected && player.getClientRects().length &&
        player.getVideoData?.()?.video_id === anchor);
    }

    const sameIds = (left, right) => left.length === right.length && left.every((id, i) => id === right[i]);

    function miniplayerQueue(player, anchor) {
      const mini = player?.closest("ytd-miniplayer");
      if (!mini) return null;
      const ids = player.getPlaylist?.();
      if (Array.isArray(ids) && !ids.length) return null; // A standalone video has no existing queue.
      if (!Array.isArray(ids) || !ids.length || ids.length > 1000 || ids.some(id => !validId(id)) ||
          ids.filter(id => id === anchor).length !== 1) return { unavailable: true };
      return { mini, ids: [...ids] };
    }

    function queueState(anchor) {
      const queues = [];
      const player = activePlayer(anchor);
      const activeListId = player?.getPlaylistId?.();
      const missingListId = activeListId == null || activeListId === "";
      if (!missingListId && typeof activeListId !== "string") return { unavailable: true };
      const mini = player?.closest("ytd-miniplayer");
      const miniQueue = miniplayerQueue(player, anchor);
      if (missingListId && miniQueue?.unavailable) return { unavailable: true };
      for (const panel of document.querySelectorAll(panelSelector)) {
        if (!panel.isConnected) continue;
        const owner = controller(panel);
        const data = owner?.data;
        if (typeof data?.playlistId !== "string" || !data.playlistId.startsWith("TLPQ")) continue;
        const ownedMini = mini && panel.closest("ytd-miniplayer") === mini;
        if (missingListId && ownedMini && !miniQueue?.mini) return { unavailable: true };
        if (!panel.getClientRects().length && data.playlistId !== activeListId && !ownedMini) continue;
        // Visible panels can also belong to a previous queue during navigation.
        // On Home the native miniplayer reports no playlist ID. Only its own
        // panel, with the player's exact ordered video IDs, can identify it.
        if (data.playlistId !== activeListId && !(missingListId && ownedMini)) return { unavailable: true };
        if (!Array.isArray(data.contents) || data.contents.length > 1000 || owner.canReorder === false) {
          return { unavailable: true };
        }
        const videos = data.contents.map(item => item.playlistPanelVideoRenderer);
        if (!videos.length || videos.some(video => !validId(video?.videoId))) return { unavailable: true };
        if (missingListId && !sameIds(videos.map(video => video.videoId), miniQueue.ids)) return { unavailable: true };
        // Native display selection can retain the previous playing marker,
        // especially on Home where the miniplayer reports no playlist ID.
        // Prefer the independently verified index and unique playing video;
        // only older models without an index use the strict selection fallback.
        let currentIndex = data.currentIndex;
        if (!("currentIndex" in data)) {
          const selected = videos.filter(video => video.selected === true);
          if (selected.length !== 1 || selected[0].videoId !== anchor) return { unavailable: true };
          currentIndex = videos.indexOf(selected[0]);
        }
        if (!Number.isInteger(currentIndex) || videos[currentIndex]?.videoId !== anchor ||
            videos.filter(video => video.videoId === anchor).length !== 1 ||
            (Number.isInteger(data.totalVideos) && data.totalVideos > videos.length)) return { unavailable: true };
        queues.push({ panel, owner, data, videos, currentIndex, listId: data.playlistId, mini: ownedMini ? mini : null });
      }
      // A collapsed Home queue may not have stamped a panel yet. Never mistake
      // its existing playlist for no queue and send an append-only command.
      if (!queues.length && miniQueue?.mini && (missingListId || activeListId?.startsWith("TLPQ"))) {
        return { awaitingPanel: true, ...miniQueue };
      }
      // A known queue ID still identifies an existing queue when its player
      // playlist API is unavailable or temporarily empty. Without a verified
      // panel there is no safe reorder path, so never fall through to append.
      if (!queues.length && mini && activeListId?.startsWith("TLPQ")) return { unavailable: true };
      return queues.length > 1 ? { unavailable: true } : queues[0] || null;
    }

    function reorderRows(queue) {
      const items = queue.panel.querySelector("#items");
      const rows = items ? [...items.children].filter(row => row.matches(rowSelector)) : [];
      if (typeof queue.owner.handleDrop !== "function" || rows.length !== queue.videos.length ||
          rows.some((row, i) => {
            const data = controller(row)?.data;
            return items.childNodes[i] !== row || data?.videoId !== queue.videos[i].videoId ||
              !data?.playlistSetVideoId || data.playlistSetVideoId !== queue.videos[i].playlistSetVideoId;
          })) return null;
      const reorder = queue.owner.ytReorderableController;
      if (reorder && Object.getOwnPropertyNames(reorder).some(name =>
        name.endsWith("dragListGroup") && reorder[name]?.isDragging?.())) return null;
      return { items, rows };
    }

    function notify(message) {
      clearTimeout(toastTimer);
      toast?.remove();
      toast = document.createElement("div");
      toast.setAttribute("role", "status");
      toast.setAttribute("data-yt-master-queue-status", "");
      toast.textContent = message;
      Object.assign(toast.style, {
        position: "fixed", bottom: "24px", left: "24px", zIndex: "2202",
        padding: "14px 20px", borderRadius: "8px", font: "14px Roboto, Arial, sans-serif",
        background: "var(--yt-spec-raised-background, #212121)",
        color: "var(--yt-spec-text-primary, #fff)", boxShadow: "0 4px 16px #0005",
        maxWidth: "calc(100vw - 48px)", pointerEvents: "none",
      });
      document.body?.appendChild(toast);
      toastTimer = setTimeout(() => { toast?.remove(); toast = null; toastTimer = 0; }, 4000);
    }

    function finish(message) {
      if (pending) {
        pending.observer.disconnect();
        clearTimeout(pending.timer);
        if (pending.frame) cancelAnimationFrame(pending.frame);
        pending = null;
      }
      if (message) notify(message);
    }

    function tryMoveNext() {
      if (!pending) return;
      const operation = pending;
      try {
        if (activeVideoId() !== operation.anchor) {
          finish("Playback changed; the queue was not reordered.");
          return;
        }
        const player = activePlayer(operation.anchor);
        const activeListId = player?.getPlaylistId?.();
        if (operation.listId && activeListId !== operation.listId &&
            !((activeListId == null || activeListId === "") && operation.mini &&
              player?.closest("ytd-miniplayer") === operation.mini)) {
          finish("The queue changed; no item was moved.");
          return;
        }
        const queue = queueState(operation.anchor);
        if (operation.preparing) {
          const current = miniplayerQueue(player, operation.anchor);
          if (!current?.mini || current.mini !== operation.mini || !sameIds(current.ids, operation.ids)) {
            finish("The queue changed; no video was added.");
            return;
          }
          if (!queue || queue.unavailable || queue.awaitingPanel || !reorderRows(queue)) return;
          const { entry, popup } = operation;
          finish();
          begin(entry, popup);
          return;
        }
        if (!queue || queue.unavailable || queue.awaitingPanel) return;
        if (operation.listId && queue.listId !== operation.listId) {
          finish("The queue changed; no item was moved.");
          return;
        }
        const index = queue.videos.findIndex(video => video.videoId === operation.videoId);
        if (index < 0) return;
        const currentIndex = queue.currentIndex;
        if (index === currentIndex || index === currentIndex + 1) { finish("Playing next in queue"); return; }
        if (operation.committed) return; // Wait for native data to confirm, never commit twice.
        const binding = reorderRows(queue);
        if (!binding) return;
        const { items, rows } = binding;
        const row = rows[index];
        // This is the same DOM move + controller commit used by native dragging.
        // Never change the queue model, call a private network API or reload playback.
        items.insertBefore(row, rows[currentIndex].nextSibling);
        operation.committed = true;
        try {
          queue.owner.handleDrop({ currDragItem: row });
          scheduleMove();
        } catch {
          // The native commit may have partially completed. Do not retry it or
          // overwrite native state with a speculative rollback.
          finish("Could not confirm Play next. Please check the queue.");
        }
      } catch {
        finish("Could not move the video next. Please check the queue.");
      }
    }

    function scheduleMove() {
      if (!pending) return;
      const operation = pending;
      // Native stamping can finish inside an animation frame. Waiting for a
      // second frame paints the temporary tail position before moving it next.
      // Coalesce after the native stack, but before paint; readiness and commit
      // guards in tryMoveNext still own every move and confirmation attempt.
      if (!operation.moveQueued) {
        operation.moveQueued = true;
        queueMicrotask(() => {
          if (pending !== operation) return;
          operation.moveQueued = false;
          tryMoveNext();
        });
      }
      // A native row/model binding may settle in a later microtask without
      // another observable mutation. Retain one coalesced frame as a backstop,
      // not a polling loop; an unready attempt waits for the next native signal.
      if (!operation.frame) operation.frame = requestAnimationFrame(() => {
        if (pending !== operation) return;
        operation.frame = 0;
        tryMoveNext();
      });
    }

    function queueDispatcher(popup) {
      const app = document.querySelector("ytd-app");
      // Some older clients expose this method on the host, others only on its
      // controller. Preserve the callable receiver rather than choosing blindly.
      const targets = popup.matches("yt-sheet-view-model") ? [app, popup] : [popup, app];
      for (const target of targets) {
        for (const owner of [target, controller(target)]) {
          if (typeof owner?.resolveCommand === "function") return endpoint => owner.resolveCommand(endpoint);
        }
      }
      if (!app?.isConnected) return null;
      // Current clients no longer expose resolveCommand on elements. This is
      // YouTube's native action-router contract; its handler invokes the internal
      // command service and appends an acknowledgement to returnValue.
      return endpoint => {
        const action = { actionName: "yt-command-executor-command", optionalAction: false,
          args: [endpoint, popup], returnValue: [] };
        app.dispatchEvent(new CustomEvent("yt-action", { detail: action, bubbles: true, composed: true }));
        return action.returnValue.length > 0;
      };
    }

    function observeQueue() {
      const observer = new MutationObserver(records => {
        if (records.some(record => record.target.closest?.(panelSelector) ||
            [...record.addedNodes].some(node => node.matches?.(panelSelector) || node.querySelector?.(panelSelector)))) scheduleMove();
      });
      observer.observe(document.querySelector("ytd-app") || document.documentElement, {
        childList: true, subtree: true, attributes: true,
        attributeFilter: ["selected", "aria-selected", "href"],
      });
      return observer;
    }

    function prepareMiniplayer(entry, popup, anchor) {
      const queue = miniplayerQueue(activePlayer(anchor), anchor);
      const toggles = queue?.mini ? [...queue.mini.querySelectorAll("ytd-miniplayer-info-bar button[aria-expanded]")]
        .filter(button => button.closest("ytd-miniplayer") === queue.mini && button.getClientRects().length) : [];
      if (toggles.length !== 1 || !["true", "false"].includes(toggles[0].getAttribute("aria-expanded"))) {
        notify("Could not prepare Play next. Open the miniplayer queue and try again. Nothing was added.");
        return;
      }
      pending = { anchor, videoId: entry.videoId, entry, popup, preparing: true,
        mini: queue.mini, ids: queue.ids, observer: observeQueue(), moveQueued: false, frame: 0, timer: 0 };
      pending.timer = setTimeout(() => finish("Could not prepare Play next. Nothing was added; please try again."), 2000);
      // The native queue header is outside the player's unrelated expand controls.
      if (toggles[0].getAttribute("aria-expanded") === "false") toggles[0].click();
      scheduleMove();
    }

    function begin(entry, popup) {
      if (entry.used) return;
      if (pending) { notify("Please wait for the queue to update, then try again."); return; }
      const anchor = activeVideoId();
      if (anchor === undefined) { notify("Could not identify the playing video. Please try again."); return; }
      const queue = anchor ? queueState(anchor) : null;
      if (queue?.unavailable) { notify("The queue is still updating. Please try again."); return; }
      if (anchor === entry.videoId) { notify("This video is already playing."); return; }
      if (queue?.awaitingPanel || (queue?.mini && !reorderRows(queue))) {
        prepareMiniplayer(entry, popup, anchor);
        return;
      }
      const playlist = anchor && activePlayer(anchor)?.getPlaylist?.();
      const existing = queue?.videos.some(video => video.videoId === entry.videoId) ||
        (Array.isArray(playlist) && playlist.includes(entry.videoId));
      if (queue && !existing && !reorderRows(queue)) {
        notify("The queue is still updating. Nothing was added; please try again.");
        return;
      }
      const dispatch = existing ? null : queueDispatcher(popup);
      if (!existing && !dispatch) { notify("Play next is unavailable in this menu."); return; }
      entry.used = true; // Only consume a selection once a native operation can start.
      if (anchor) {
        pending = { anchor, videoId: entry.videoId, listId: queue?.listId, mini: queue?.mini,
          observer: observeQueue(), moveQueued: false, frame: 0, timer: 0 };
        pending.timer = setTimeout(() => finish(pending.committed
          ? "Could not confirm Play next. Please check the queue."
          : existing ? "Could not move the queued video next. Please try again."
            : "Added to queue, but could not move it next. Please check the queue."), 8000);
      }
      if (!existing) {
        const command = { ...entry.command, openMiniplayer: anchor ? false : entry.command.openMiniplayer };
        const endpoint = {
          ...entry.endpoint,
          signalServiceEndpoint: { ...entry.endpoint.signalServiceEndpoint,
            actions: [{ ...entry.endpoint.signalServiceEndpoint.actions[0], addToPlaylistCommand: command }] },
        };
        // Keep the original native creation command and metadata. Do not retry:
        // an ambiguous resolver result can still mean the video was added.
        if (dispatch(endpoint) === false) {
          finish("YouTube could not accept Play next. Please check the queue.");
          return;
        }
      }
      scheduleMove();
    }

    function dismissMenu(popup) {
      const dropdown = popup.closest("tp-yt-iron-dropdown");
      for (const owner of new Set([dropdown, controller(dropdown)])) {
        if (typeof owner?.close !== "function") continue;
        owner.close();
        return; // A throwing native close is not retried through another route.
      }
      // Current sheet hosts can omit the dropdown method. Ask YouTube's popup
      // owner to close this renderer, without hiding DOM or clicking elsewhere.
      popup.dispatchEvent(new CustomEvent("yt-action", { bubbles: true, composed: true,
        detail: { actionName: "yt-close-popup-action", optionalAction: false,
          args: [popup.localName], returnValue: [] } }));
    }

    function openMenu(event) {
      const popup = event.target;
      if (!popup?.matches?.("ytd-menu-popup-renderer, yt-sheet-view-model")) return;
      try {
        const sheet = popup.matches("yt-sheet-view-model");
        sheets.delete(popup);
        const owner = controller(popup);
        const data = sheet ? sheetData(popup) : owner?.data;
        const list = data?.content?.listViewModel;
        const sourceItems = sheet ? list?.listItems : data?.items;
        if (!Array.isArray(sourceItems) || sourceItems.length > 60 ||
            (sheet ? typeof popup.setters?.data !== "function" : typeof owner.set !== "function")) return;
        const items = sourceItems.filter(item =>
          (item?.menuServiceItemRenderer || item?.listItemViewModel)?.[marker] !== true);
        if (items.some(item => {
          const icon = item?.menuServiceItemRenderer?.icon?.iconType ||
            item?.listItemViewModel?.leadingImage?.sources?.[0]?.clientResource?.imageName;
          return ["QUEUE_PLAY_NEXT", "ADD_TO_QUEUE_HEAD"].includes(icon?.toUpperCase());
        })) return;
        const index = items.findIndex(item => queueCommand(item));
        if (index < 0 || (sheet && !items[index].listItemViewModel)) return;
        const entry = queueCommand(items[index]);
        const endpoint = { signalServiceEndpoint: { signal: "CLIENT_SIGNAL", actions: [] } };
        if (sheet) {
          const record = {
            ...items[index].listItemViewModel,
            title: { content: "Play next in queue" },
            leadingImage: { sources: [{ clientResource: { imageName: "QUEUE_PLAY_NEXT" } }] },
            rendererContext: { accessibilityContext: { label: "Play next in queue" },
              commandContext: { onTap: { innertubeCommand: endpoint } } },
            targetId: "yt-master-play-next", [marker]: true,
          };
          items.splice(index, 0, { listItemViewModel: record });
          const updated = { ...data, content: { ...data.content, listViewModel: { ...list, listItems: items } } };
          // Native view-model rows do not expose .data. Bind activation to the
          // owned sheet's exact model and native target ID, not text or position.
          sheets.set(popup, { data: updated, entry });
          popup.data = updated;
        } else {
          const record = {
            text: { simpleText: "Play next in queue" }, icon: { iconType: "QUEUE_PLAY_NEXT" },
            serviceEndpoint: endpoint, [marker]: true,
          };
          entries.set(record, entry);
          items.splice(index, 0, { menuServiceItemRenderer: record });
          owner.set("data", { ...data, items });
        }
        // Stamp through the native menu, then let its dropdown fit the extra row.
        if (menuFrame) cancelAnimationFrame(menuFrame);
        menuFrame = requestAnimationFrame(() => {
          menuFrame = 0;
          if (popup.isConnected) popup.closest("tp-yt-iron-dropdown")?.refit?.();
        });
      } catch { /* An unrecognised menu keeps its native Add to queue action. */ }
    }

    function activate(event) {
      const source = event.detail?.sourceEvent;
      if (!event.isTrusted && !(source instanceof Event && source.isTrusted)) return;
      if (event.type === "keydown" && !["Enter", " "].includes(event.key)) return;
      const row = event.target?.closest?.("ytd-menu-service-item-renderer, yt-list-item-view-model");
      const popup = row?.closest("ytd-menu-popup-renderer, yt-sheet-view-model");
      const sheet = sheets.get(popup);
      const entry = row?.matches('yt-list-item-view-model[data-target-id="yt-master-play-next"]')
        ? sheet && sheetData(popup) === sheet.data && sheet.entry
        : row && entries.get(controller(row)?.data);
      if (!entry) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      try { begin(entry, popup); }
      catch { finish("Play next could not be completed. Please check the queue."); }
      finally {
        // Native activation is suppressed above, so dismiss rejected and
        // preparing selections too. Resolve/dispatch before native teardown.
        try { dismissMenu(popup); }
        catch { /* Closing an already disposed native popup is harmless. */ }
      }
    }

    function reset() {
      finish();
      entries = new WeakMap();
      sheets = new WeakMap();
      if (menuFrame) cancelAnimationFrame(menuFrame);
      menuFrame = 0;
      clearTimeout(toastTimer);
      toastTimer = 0;
      toast?.remove();
      toast = null;
    }
    window.addEventListener("yt-popup-opened", openMenu, true);
    ["click", "tap", "keydown"].forEach(type => document.addEventListener(type, activate, true));
    ["yt-playlist-data-updated", "yt-page-data-updated"].forEach(type => window.addEventListener(type, scheduleMove, true));
    ["yt-navigate-start", "pagehide"].forEach(type => window.addEventListener(type, reset, true));
    return reset;
  }

  function installQueueDragAssistance() {
    const panelSelector =
      "ytd-playlist-panel-renderer, yt-playlist-panel-renderer";
    const rowSelector =
      "ytd-playlist-panel-video-renderer, yt-playlist-panel-video-renderer";
    const placeholderAttribute = "data-ywlc-drag-placeholder";
    let gesture = null;

    function setMarkerStyle(css) {
      const style = document.createElement("style");
      style.id = "tm-youtube-watch-layout-cleaner-drag";
      style.textContent = css;
      (document.head || document.documentElement).appendChild(style);
      return style;
    }

    function removeMarkerStyle(style) {
      style?.remove();
    }

    function release(callback) {
      try {
        callback();
      } catch {
        // Native teardown or another script may already have released it.
      }
    }

    function clearGesture() {
      const current = gesture;
      if (!current) return;
      gesture = null;
      current.groupListeners.forEach(([type, listener]) => {
        release(() => current.group.removeEventListener(type, listener));
      });
      current.domListeners.forEach(([target, type, listener]) => {
        release(() => target.removeEventListener(type, listener, true));
      });
      release(() => current.observer?.disconnect());
      release(() => current.motionQuery?.removeEventListener(
        "change", current.motionListener,
      ));
      clearAnimations(current);
      release(() => {
        if (current.marker?.getAttribute(placeholderAttribute) === "1") {
          current.marker.removeAttribute(placeholderAttribute);
        }
      });
      release(() => removeMarkerStyle(current.markerStyle));
      release(() => {
        const style = current.items.style;
        if (
          current.anchor &&
          style.getPropertyValue("overflow-anchor") === "none" &&
          style.getPropertyPriority("overflow-anchor") === ""
        ) {
          if (current.anchor.value) {
            style.setProperty(
              "overflow-anchor", current.anchor.value, current.anchor.priority,
            );
          } else {
            style.removeProperty("overflow-anchor");
          }
        }
      });
      release(() => {
        if (
          current.support && current.scrollDelta &&
          current.support.calculateScrollDelta === current.scrollDelta
        ) {
          // The native timer stays native-owned; discard only our cached step.
          release(() => {
            if (current.support.scrollDelta_) current.support.scrollDelta_.y = 0;
          });
          if (current.scrollDescriptor) {
            Object.defineProperty(
              current.support,
              "calculateScrollDelta",
              current.scrollDescriptor,
            );
          } else {
            delete current.support.calculateScrollDelta;
          }
        }
      });
    }

    function clearAnimations(current = gesture) {
      if (!current?.animations) return;
      current.animations.forEach((animation) => release(() => animation.cancel()));
      current.animations.clear();
      current.positions.clear();
    }

    function ownsNativeDrag(current) {
      return Boolean(
        current === gesture &&
          current.panel.isConnected &&
          current.items.isConnected &&
          current.row.parentElement === current.items &&
          (current.panel.polymerController ||
            current.panel.getPolymerController?.() || current.panel) ===
            current.owner &&
          (current.owner.ytReorderableController ||
            current.panel.ytReorderableController) === current.controller &&
          Object.getOwnPropertyDescriptor(
            current.controller, current.groupProperty,
          )?.value === current.group &&
          current.group.currDragItem_ === current.row &&
          current.group.isDragging() &&
          current.controller.dragScrollSupport === current.support,
      );
    }

    function visibleScrollBounds(items) {
      const rect = items.getBoundingClientRect();
      const bounds = {
        left: Math.max(0, rect.left),
        right: Math.min(window.innerWidth, rect.right),
        top: Math.max(0, rect.top),
        bottom: Math.min(window.innerHeight, rect.bottom),
      };
      for (let element = items; element; element = element.parentElement) {
        const style = getComputedStyle(element);
        if (
          style.display === "none" ||
          style.visibility === "hidden" ||
          style.visibility === "collapse"
        ) {
          return null;
        }
        const clipX = /^(auto|scroll|hidden|clip)$/.test(style.overflowX);
        const clipY = /^(auto|scroll|hidden|clip)$/.test(style.overflowY);
        if (!clipX && !clipY) continue;
        const clip = element.getBoundingClientRect();
        if (clipX) {
          bounds.left = Math.max(bounds.left, clip.left);
          bounds.right = Math.min(bounds.right, clip.right);
        }
        if (clipY) {
          bounds.top = Math.max(bounds.top, clip.top);
          bounds.bottom = Math.min(bounds.bottom, clip.bottom);
        }
      }
      return bounds.right > bounds.left && bounds.bottom > bounds.top
        ? bounds
        : null;
    }

    function innerContainer(row) {
      return Array.from(row.children).find((child) => child.id === "container");
    }

    function recordPositions() {
      const current = gesture;
      if (!current?.active || !ownsNativeDrag(current)) {
        clearGesture();
        return;
      }
      current.positions.clear();
      if (current.motionQuery?.matches) {
        clearAnimations(current);
        return;
      }
      const bounds = visibleScrollBounds(current.items);
      if (!bounds) return;
      const rows = Array.from(current.items.children);
      const index = rows.indexOf(current.row);
      // Bound geometry reads even for long queues; only neighbours can shift.
      const neighbours = rows.slice(Math.max(0, index - 20), index + 21);
      neighbours.forEach((row) => {
        if (
          row === current.row ||
          !row.matches(rowSelector) ||
          current.group.draggerEl_?.contains(row) ||
          getComputedStyle(row).visibility !== "visible"
        ) {
          return;
        }
        const inner = innerContainer(row);
        if (!inner || typeof inner.animate !== "function") return;
        const ownedAnimation = current.animations.get(inner);
        if (
          (inner.getAnimations?.() || []).some(
            (animation) => animation !== ownedAnimation,
          ) ||
          (!ownedAnimation && getComputedStyle(inner).transform !== "none")
        ) {
          return;
        }
        const rect = inner.getBoundingClientRect();
        if (rect.bottom <= bounds.top || rect.top >= bounds.bottom) return;
        current.positions.set(inner, rect.top);
        ownedAnimation?.cancel();
        current.animations.delete(inner);
      });
    }

    function animatePositions() {
      const current = gesture;
      if (!current?.active || !ownsNativeDrag(current)) {
        clearGesture();
        return;
      }
      if (current.motionQuery?.matches) {
        clearAnimations(current);
        return;
      }
      current.positions.forEach((top, inner) => {
        if (
          !inner.isConnected ||
          inner.parentElement?.parentElement !== current.items ||
          inner.parentElement === current.row ||
          getComputedStyle(inner).transform !== "none" ||
          (inner.getAnimations?.() || []).length
        ) {
          return;
        }
        const delta = top - inner.getBoundingClientRect().top;
        if (!Number.isFinite(delta) || Math.abs(delta) < 1) return;
        const animation = inner.animate(
          [
            { transform: `translateY(${delta}px)` },
            { transform: "none" },
          ],
          { duration: 120, easing: "ease-out" },
        );
        current.animations.set(inner, animation);
        animation.onfinish = () => {
          if (current.animations.get(inner) === animation) {
            current.animations.delete(inner);
          }
        };
      });
      current.positions.clear();
    }

    function beginNativeDrag() {
      const current = gesture;
      if (!current || current.active) return;
      const support = current.controller.dragScrollSupport;
      if (
        current.group.currDragItem_ !== current.row ||
        !current.group.isDragging() ||
        support?.containerNode_ !== current.items ||
        support.horizontalScrolling_ !== false ||
        typeof support.calculateScrollDelta !== "function"
      ) {
        clearGesture();
        return;
      }
      current.support = support;
      current.scrollDescriptor = Object.getOwnPropertyDescriptor(
        support,
        "calculateScrollDelta",
      );
      current.scrollDelta = () => {
        try {
          if (!ownsNativeDrag(current) || document.hidden) {
            clearGesture();
            return 0;
          }
          const bounds = visibleScrollBounds(current.items);
          const { x, y } = current.pointer;
          if (
            !bounds ||
            x < bounds.left ||
            x > bounds.right ||
            y < bounds.top ||
            y > bounds.bottom
          ) {
            return 0;
          }
          const edge = Math.min(40, (bounds.bottom - bounds.top) / 2);
          const upwards = y < bounds.top + edge;
          const distance = upwards
            ? bounds.top + edge - y
            : y - (bounds.bottom - edge);
          if (distance <= 0) return 0;
          const step = Math.min(16, (distance / edge) * 16);
          const available = upwards
            ? current.items.scrollTop
            : current.items.scrollHeight - current.items.clientHeight -
              current.items.scrollTop;
          return available > 0 ? (upwards ? -1 : 1) * Math.min(step, available) : 0;
        } catch {
          clearGesture();
          return 0;
        }
      };
      try {
        support.calculateScrollDelta = current.scrollDelta;
        if (support.calculateScrollDelta !== current.scrollDelta) {
          clearGesture();
          return;
        }
      } catch {
        clearGesture();
        return;
      }
      current.active = true;
      const listStyle = current.items.style;
      if (typeof listStyle?.getPropertyValue === "function") {
        current.anchor = {
          value: listStyle.getPropertyValue("overflow-anchor"),
          priority: listStyle.getPropertyPriority("overflow-anchor"),
        };
        // Native placeholder movement must not pull the scrollport with it.
        listStyle.setProperty("overflow-anchor", "none");
      }
      const inner = innerContainer(current.row);
      if (
        inner &&
        !inner.hasAttribute(placeholderAttribute) &&
        ["relative", "absolute", "fixed", "sticky"].includes(
          getComputedStyle(inner).position,
        )
      ) {
        // Reveal only an empty outline, never the hidden row's real contents.
        const style = setMarkerStyle(`[${placeholderAttribute}="1"]::after {
  content: "";
  position: absolute;
  inset: 3px;
  visibility: visible;
  pointer-events: none;
  border: 1px solid var(--yt-spec-call-to-action, #3ea6ff);
  border-radius: 4px;
  box-sizing: border-box;
}`);
        current.marker = inner;
        current.markerStyle = style;
        inner.setAttribute(placeholderAttribute, "1");
      }
    }

    function armDrag(event) {
      if (
        !event.isTrusted || event.button !== 0 || document.hidden ||
        event.ctrlKey || event.altKey || event.metaKey ||
        !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)
      ) {
        return;
      }
      clearGesture();
      const target = event.target;
      if (
        !target?.closest ||
        target.closest(
          'button, input, textarea, select, [role="button"], ' +
            '[contenteditable]:not([contenteditable="false"])',
        )
      ) {
        return;
      }
      const row = target.closest(rowSelector);
      const panel = row?.closest(panelSelector);
      const items = row?.parentElement;
      if (
        !panel?.isConnected ||
        items?.id !== "items" ||
        panel.querySelector("#items") !== items ||
        (!panel.closest("ytd-miniplayer") &&
          location.pathname !== "/watch" &&
          !location.pathname.startsWith("/live/")) ||
        !visibleScrollBounds(items)
      ) {
        return;
      }
      let owner;
      let controller;
      let group;
      let groupProperty;
      try {
        owner = panel.polymerController ||
          panel.getPolymerController?.() || panel;
        if (owner.canReorder === false || panel.canReorder === false) return;
        controller = owner.ytReorderableController ||
          panel.ytReorderableController;
        if (!controller) return;
        const entry = Object.getOwnPropertyNames(controller)
          .filter((name) => name.endsWith("dragListGroup"))
          .map((name) => ({
            name, value: Object.getOwnPropertyDescriptor(controller, name)?.value,
          }))
          .find(({ value }) =>
            value &&
            typeof value.addEventListener === "function" &&
            typeof value.removeEventListener === "function" &&
            typeof value.isDragging === "function" &&
            typeof value.getHandleForDragItem_ === "function",
          );
        group = entry?.value;
        groupProperty = entry?.name;
        if (!group || group.isDragging()) return;
        const handle = group.getHandleForDragItem_(row);
        if (!handle || !row.contains(handle) || !handle.contains(target)) return;
      } catch {
        return;
      }
      const current = {
        panel, items, row, owner, controller, group, groupProperty,
        pointer: { x: event.clientX, y: event.clientY },
        viewport: { width: window.innerWidth, height: window.innerHeight },
        active: false,
        groupListeners: [],
        domListeners: [],
        animations: new Map(),
        positions: new Map(),
        motionQuery: typeof matchMedia === "function"
          ? matchMedia("(prefers-reduced-motion: reduce)")
          : null,
      };
      gesture = current;
      function listen(target, type, listener) {
        current.domListeners.push([target, type, listener]);
        target.addEventListener(type, listener, true);
      }
      [
        ["dragstart", beginNativeDrag],
        ["beforedragmove", recordPositions],
        ["dragmove", animatePositions],
        ["dragend", clearGesture],
        ["e", clearGesture],
      ].forEach(([type, listener]) => {
        const guarded = (...args) => {
          try {
            listener(...args);
          } catch {
            // Never let assistance interrupt native insertBefore/drop handling.
            clearGesture();
          }
        };
        current.groupListeners.push([type, guarded]);
        group.addEventListener(type, guarded);
      });
      listen(document, "mousemove", (move) => {
        if (!move.isTrusted) return;
        if (
          !(move.buttons & 1) ||
          !Number.isFinite(move.clientX) || !Number.isFinite(move.clientY)
        ) {
          clearGesture();
          return;
        }
        current.pointer = { x: move.clientX, y: move.clientY };
      });
      listen(document, "mouseup", clearGesture);
      listen(document, "pointercancel", clearGesture);
      listen(document, "keydown", (key) => {
        if (key.key === "Escape") clearGesture();
      });
      listen(document, "visibilitychange", () => {
        if (document.hidden) clearGesture();
      });
      ["blur", "pagehide", "yt-navigate-start"].forEach((type) => {
        listen(window, type, clearGesture);
      });
      listen(window, "resize", (resize) => {
        // Suite/YouTube layout notifications are not actual viewport changes.
        if (
          resize.isTrusted ||
          window.innerWidth !== current.viewport.width ||
          window.innerHeight !== current.viewport.height
        ) {
          clearGesture();
        }
      });
      current.motionListener = () => clearAnimations(current);
      current.motionQuery?.addEventListener("change", current.motionListener);
      if (typeof MutationObserver === "function") {
        current.observer = new MutationObserver(() => {
          if (!panel.isConnected || !items.isConnected || !items.contains(row)) {
            clearGesture();
          }
        });
        current.observer.observe(document.documentElement, {
          childList: true,
          subtree: true,
        });
      }
    }

    const onMouseDown = (event) => {
      try {
        armDrag(event);
      } catch {
        clearGesture();
      }
    };
    document.addEventListener("mousedown", onMouseDown, true);
    return () => {
      clearGesture();
      document.removeEventListener("mousedown", onMouseDown, true);
    };
  }

  const scheduleQueuePlayingMarkerReconciliation = installQueuePlayingMarkerReconciliation();
  installQueuePlayNext();
  installQueueDragAssistance();
  ensureStyle();
  scheduleQueueThumbnailFallbacks();

  const narrowLayoutMediaQuery = matchMedia(
    `(max-width: ${px(CONFIG.queueLayoutBreakpointPx)})`,
  );
  narrowLayoutMediaQuery.addEventListener(
    "change",
    scheduleQueueThumbnailFallbacks,
  );
  const relatedVideosMediaQuery = matchMedia(
    `(max-width: ${px(CONFIG.relatedVideosHideBreakpointPx)})`,
  );
  relatedVideosMediaQuery.addEventListener(
    "change",
    scheduleSecondaryRailStateReconciliation,
  );

  // YouTube is an SPA; re-apply after in-site navigation
  window.addEventListener(
    "yt-navigate-finish",
    () => {
      ensureStyle();
      scheduleQueueThumbnailFallbacks();
    },
    true,
  );
  window.addEventListener(
    "yt-page-data-updated",
    () => {
      ensureStyle();
      scheduleQueueThumbnailFallbacks();
    },
    true,
  );
  window.addEventListener(
    "pageshow",
    () => {
      ensureStyle();
      scheduleQueueThumbnailFallbacks();
    },
    true,
  );
})();
