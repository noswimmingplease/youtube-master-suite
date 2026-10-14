// ==UserScript==
// @name         YouTube Watch Layout Cleaner
// @namespace    Citizen.youtube.watch-layout-cleaner
// @version      1.34
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
