// ==UserScript==
// @name         YouTube Watch Layout Cleaner
// @namespace    Citizen.youtube.watch-layout-cleaner
// @version      1.30
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
  const RAIL_MUTATION_TARGET_SELECTOR = [
    PLAYLIST_PANEL_SELECTOR,
    CHAT_SURFACE_SELECTOR,
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
`;
  }

  function isWatchPath() {
    return location.pathname === "/watch" || location.pathname.startsWith("/live/");
  }

  function ensureStyle() {
    if (!isWatchPath()) {
      removeStyle();
      return;
    }

    let style = document.getElementById(STYLE_ID);
    if (!style) {
      style = document.createElement("style");
      style.id = STYLE_ID;
      (document.head || document.documentElement).appendChild(style);
    }

    const css = buildCss();
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
          if (!entry.isIntersecting) return;

          observer.unobserve(entry.target);
          if (!entry.target.isConnected || !isWatchPath()) return;
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
      const railIsEmpty =
        eligible &&
        relatedHidden &&
        !chatVisible &&
        !queueVisible &&
        !auxiliarySurfaceVisible;

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
