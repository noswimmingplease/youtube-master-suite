// ==UserScript==
// @name         YouTube Master Suite
// @namespace    youtube.master-suite
// @version      1.2.19
// @description  Video mirroring, volume and quality controls, scrolling miniplayer, fullscreen comments, play next in queue, queue layout, feed and comment cleanup, colour settings, clean video links and optional-cookie rejection.
// @author       Citizen
// @license      GNU GPLv3
// @homepageURL  https://github.com/noswimmingplease/youtube-master-suite
// @supportURL   https://github.com/noswimmingplease/youtube-master-suite/issues
// @updateURL    none
// @downloadURL  none
// @match        https://www.youtube.com/*
// @match        https://consent.youtube.com/*
// @run-at       document-start
// @grant        none
// @noframes
// ==/UserScript==

(() => {
  "use strict";

  const rejectYouTubeOptionalCookies = function rejectYouTubeOptionalCookies(window, document, options = {}) {
  const idle = { stop() {}, get status() { return "not-applicable"; } };
  if (window.location.protocol !== "https:" || window.top !== window ||
      !["www.youtube.com", "consent.youtube.com"].includes(window.location.hostname)) return idle;

  const timeoutMs = options.timeoutMs ?? 10000;
  const intervalMs = options.intervalMs ?? 250;
  let status = "waiting", timer = null, deadline = null;
  const stop = () => {
    if (timer !== null) window.clearTimeout(timer);
    if (deadline !== null) window.clearTimeout(deadline);
    timer = deadline = null;
    window.removeEventListener("pagehide", stop);
    document.removeEventListener("DOMContentLoaded", check);
    if (status === "waiting") status = "stopped";
  };
  const visible = element => {
    if (!element.isConnected || element.closest("[hidden], [inert]")) return false;
    if (typeof element.checkVisibility === "function" &&
        !element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
    const style = window.getComputedStyle(element);
    return style.visibility !== "hidden" && style.display !== "none" &&
      [...element.getClientRects()].some(rect => rect.width > 0 && rect.height > 0);
  };
  function check() {
    if (status !== "waiting") return;
    const scopes = window.location.hostname === "www.youtube.com"
      ? [...document.querySelectorAll("ytd-consent-bump-v2-lightbox, ytd-consent-bump-lightbox")]
      : document.body && [...document.querySelectorAll("h1, h2, [role=heading]")].some(
          heading => visible(heading) && /^Before you continue to YouTube$/i.test(heading.textContent.trim()))
        ? [document.body] : [];
    // YouTube's lightbox is an inline custom element with a zero-sized box;
    // its actual buttons are laid out inside the dialog. Validate those buttons
    // rather than assuming the wrapper itself has visible geometry.
    const candidates = [...new Set(scopes.filter(scope => scope.isConnected)
      .flatMap(scope => [...scope.querySelectorAll("button")]))]
      .filter(button => {
        const label = button.textContent.replace(/\s+/g, " ").trim();
        const aria = (button.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim();
        return visible(button) && !button.disabled && button.getAttribute("aria-disabled") !== "true" &&
          label === "Reject all" && ["", "Reject all",
            "Reject the use of cookies and other data for the purposes described"].includes(aria);
      });
    if (candidates.length === 1) {
      // Mark the attempt and clear every timer before invoking the native UI.
      // An ignored/failed click must never cause repeated submissions.
      status = "rejection-requested";
      stop();
      try { candidates[0].click(); }
      catch { status = "action-failed"; }
      return;
    }
    if (candidates.length > 1) {
      status = "ambiguous";
      stop();
      return;
    }
    if (timer !== null) window.clearTimeout(timer);
    timer = window.setTimeout(check, intervalMs);
  }
  window.addEventListener("pagehide", stop, { once: true });
  document.addEventListener("DOMContentLoaded", check, { once: true });
  deadline = window.setTimeout(() => { status = "timed-out"; stop(); }, timeoutMs);
  check();
  return { stop, get status() { return status; } };
};
  rejectYouTubeOptionalCookies(window, document);
  // Consent pages need only the rejection action, not player/feed modules.
  if (window.location.hostname !== "www.youtube.com") return;

  const MASTER_VERSION = "1.2.19";
  const EXPECTED_MODULE_COUNT = 8;
  const HEALTH_ATTRIBUTE = "data-yt-master-suite";
  const ENABLED_MODULES = Object.freeze({
    commentCleaner: true,
    feedUiCleaner: true,
    miniplayerButtonRestorer: true,
    pageCoherence: true,
    playerPreferencesLite: true,
    scrollMiniplayer: true,
    watchLayoutCleaner: true,
    suiteSettings: true,
  });
  const DIAGNOSTICS = Object.freeze({
    enabled: false,
    reportIntervalMs: 30000,
  });
  const DIAGNOSTICS_ATTRIBUTE = "data-yt-master-diagnostics";
  const RUNTIME_ERRORS_ATTRIBUTE = "data-yt-master-runtime-errors";
  const MAX_RUNTIME_ERRORS = 20;

  const NativeMutationObserver = globalThis.MutationObserver;
  const SHARED_WINDOW_EVENTS = new Set([
    "pageshow",
    "yt-navigate-finish",
    "yt-navigate-start",
    "yt-page-data-updated",
  ]);
  const STYLE_ORDER = [
    "commentCleaner",
    "feedUiCleaner",
    "miniplayerButtonRestorer",
    "pageCoherence",
    "playerPreferencesLite",
    "scrollMiniplayer",
    "watchLayoutCleaner",
    "suiteSettings",
  ];
  const sharedWindowListeners = new Map();
  const sharedMutationObservers = new Set();
  const styleParts = new Map();
  const idleModules = [];
  const preservedMutationBatches = [];
  const registeredModuleIds = new Set();
  const moduleStates = new Map();
  const diagnosticStats = new Map();
  const runtimeErrors = [];
  let nativeMutationObserver = null;
  let nativeMutationCoverage = null;
  let nativeLogicalObserverStates = new Map();
  let styleElement = null;
  let batchDepth = 0;
  let activeModuleId = "suite";
  let mutationRefreshPending = false;
  let preservedMutationFlushPending = false;
  let runtimeErrorPublishPending = false;
  let styleRenderPending = false;

  function mutationOptionsCover(availableOptions, requestedOptions) {
    for (const optionName of [
      "attributes",
      "attributeOldValue",
      "childList",
      "characterData",
      "characterDataOldValue",
      "subtree",
    ]) {
      if (requestedOptions[optionName] && !availableOptions[optionName]) {
        return false;
      }
    }

    if (!requestedOptions.attributes) return true;

    const availableFilter = availableOptions.attributeFilter;
    const requestedFilter = requestedOptions.attributeFilter;
    if (!requestedFilter?.length) return !availableFilter?.length;
    if (!availableFilter?.length) return true;
    return requestedFilter.every((attributeName) =>
      availableFilter.includes(attributeName),
    );
  }

  function mergeMutationOptions(leftOptions, rightOptions) {
    const optionSets = [leftOptions, rightOptions].filter(Boolean);
    const attributes = optionSets.some((options) => options.attributes);
    const observeAllAttributes = optionSets.some(
      (options) => options.attributes && !options.attributeFilter?.length,
    );
    const mergedOptions = {
      attributes,
      attributeOldValue: optionSets.some((options) => options.attributeOldValue),
      childList: optionSets.some((options) => options.childList),
      characterData: optionSets.some((options) => options.characterData),
      characterDataOldValue: optionSets.some(
        (options) => options.characterDataOldValue,
      ),
      subtree: optionSets.some((options) => options.subtree),
    };

    if (attributes && !observeAllAttributes) {
      const attributeFilter = [
        ...new Set(
          optionSets.flatMap((options) => options.attributeFilter || []),
        ),
      ];
      if (attributeFilter.length) mergedOptions.attributeFilter = attributeFilter;
    }

    return mergedOptions;
  }

  function mutationCoverageCovers(availableCoverage, requestedCoverage) {
    if (
      !availableCoverage ||
      !requestedCoverage ||
      !(availableCoverage.registrations instanceof Map) ||
      !(requestedCoverage.registrations instanceof Map) ||
      availableCoverage.registrations.size !==
        requestedCoverage.registrations.size
    ) {
      return false;
    }

    // Require the same targets and equivalent per-target options. Retaining a
    // broader native registration after logical observers narrow would preserve
    // needless DOM traffic, while retaining removed targets can keep detached
    // YouTube surfaces alive.
    return [...requestedCoverage.registrations].every(
      ([target, requestedOptions]) => {
        const availableOptions = availableCoverage.registrations.get(target);
        return Boolean(
          availableOptions &&
            mutationOptionsCover(availableOptions, requestedOptions) &&
            mutationOptionsCover(requestedOptions, availableOptions),
        );
      },
    );
  }

  function normaliseMutationOptions(options = {}) {
    options ??= {};
    const normalisedOptions = {
      ...options,
      attributes: Boolean(options.attributes),
      attributeOldValue: Boolean(options.attributeOldValue),
      childList: Boolean(options.childList),
      characterData: Boolean(options.characterData),
      characterDataOldValue: Boolean(options.characterDataOldValue),
      subtree: Boolean(options.subtree),
    };

    if (
      options.attributes === undefined &&
      (options.attributeOldValue !== undefined ||
        options.attributeFilter !== undefined)
    ) {
      normalisedOptions.attributes = true;
    }
    if (
      options.characterData === undefined &&
      options.characterDataOldValue !== undefined
    ) {
      normalisedOptions.characterData = true;
    }
    if (options.attributeFilter !== undefined) {
      normalisedOptions.attributeFilter = [...options.attributeFilter].map(String);
    } else {
      delete normalisedOptions.attributeFilter;
    }

    if (
      !normalisedOptions.attributes &&
      !normalisedOptions.childList &&
      !normalisedOptions.characterData
    ) {
      throw new TypeError(
        "MutationObserver options must enable attributes, childList, or characterData",
      );
    }
    if (
      !normalisedOptions.attributes &&
      (normalisedOptions.attributeOldValue ||
        options.attributeFilter !== undefined)
    ) {
      throw new TypeError(
        "MutationObserver attribute options require attributes to be enabled",
      );
    }
    if (
      !normalisedOptions.characterData &&
      normalisedOptions.characterDataOldValue
    ) {
      throw new TypeError(
        "MutationObserver characterDataOldValue requires characterData",
      );
    }

    return normalisedOptions;
  }

  function setLogicalMutationRegistration(registrations, target, options) {
    registrations.set(target, normaliseMutationOptions(options));
  }

  function clearLogicalMutationRegistrations(registrations) {
    registrations.clear();
  }

  function setSharedMutationObserverRegistryState(
    observers,
    observer,
    active,
  ) {
    if (active) {
      observers.add(observer);
    } else {
      observers.delete(observer);
    }
  }

  function logicalMutationOptionsEqual(leftOptions, rightOptions) {
    for (const optionName of [
      "attributes",
      "attributeOldValue",
      "childList",
      "characterData",
      "characterDataOldValue",
      "subtree",
    ]) {
      if (leftOptions[optionName] !== rightOptions[optionName]) return false;
    }

    const leftHasAttributeFilter = Object.hasOwn(
      leftOptions,
      "attributeFilter",
    );
    const rightHasAttributeFilter = Object.hasOwn(
      rightOptions,
      "attributeFilter",
    );
    if (leftHasAttributeFilter !== rightHasAttributeFilter) return false;
    if (!leftHasAttributeFilter) return true;

    const leftFilter = new Set(leftOptions.attributeFilter);
    const rightFilter = new Set(rightOptions.attributeFilter);
    return (
      leftFilter.size === rightFilter.size &&
      [...leftFilter].every((attributeName) => rightFilter.has(attributeName))
    );
  }

  function logicalMutationRegistrationsEqual(leftRegistrations, rightRegistrations) {
    if (leftRegistrations.size !== rightRegistrations.size) return false;

    return [...rightRegistrations].every(([target, rightOptions]) => {
      const leftOptions = leftRegistrations.get(target);
      return Boolean(
        leftOptions &&
          logicalMutationOptionsEqual(leftOptions, rightOptions),
      );
    });
  }

  function refreshImmediatelyPreservingPendingState(
    getPending,
    setPending,
    refresh,
  ) {
    const wasPending = getPending();
    try {
      return refresh();
    } catch (error) {
      setPending(wasPending);
      throw error;
    }
  }

  function replaceLogicalMutationRegistrations(
    observer,
    observers,
    registrations,
    refresh,
  ) {
    const nextRegistrations = new Map();
    for (const [target, options] of registrations) {
      setLogicalMutationRegistration(nextRegistrations, target, options);
    }

    const wasActive = observer.active;
    const nextActive = nextRegistrations.size > 0;
    if (
      wasActive === nextActive &&
      logicalMutationRegistrationsEqual(
        observer.registrations,
        nextRegistrations,
      )
    ) {
      return false;
    }

    const previousRegistrations = observer.registrations;
    const previousGeneration = observer.generation;
    const wasRegistered = observers.has(observer);
    observer.registrations = nextRegistrations;
    observer.active = nextActive;
    // Active-to-active replacement retains the generation so records already
    // queued under the old native coverage remain deliverable against the
    // captured registration snapshot.
    if (wasActive !== nextActive) observer.generation += 1;
    setSharedMutationObserverRegistryState(
      observers,
      observer,
      nextActive,
    );
    try {
      refresh();
    } catch (error) {
      observer.registrations = previousRegistrations;
      observer.active = wasActive;
      observer.generation = previousGeneration;
      setSharedMutationObserverRegistryState(
        observers,
        observer,
        wasRegistered,
      );
      throw error;
    }
    return true;
  }

  function installReplacementMutationObserver(
    NativeObserver,
    callback,
    requestedCoverage,
    currentObserver,
    preserveRecords,
  ) {
    const replacementObserver = new NativeObserver(callback);
    try {
      requestedCoverage.registrations.forEach((options, target) =>
        replacementObserver.observe(target, options),
      );
    } catch (error) {
      replacementObserver.disconnect();
      throw error;
    }

    if (currentObserver) {
      try {
        preserveRecords(currentObserver.takeRecords());
        currentObserver.disconnect();
      } catch (error) {
        replacementObserver.disconnect();
        throw error;
      }
    }
    return replacementObserver;
  }

  function cloneLogicalMutationRegistrations(registrations) {
    return new Map(
      [...registrations].map(([target, options]) => [
        target,
        {
          ...options,
          ...(options.attributeFilter
            ? { attributeFilter: [...options.attributeFilter] }
            : {}),
        },
      ]),
    );
  }

  function mutationMatchesRegistrations(
    registrations,
    mutation,
    ignoredAttributeName,
  ) {
    if (
      mutation.type === "attributes" &&
      mutation.attributeName === ignoredAttributeName
    ) {
      return false;
    }

    for (const [target, options] of registrations) {
      // Reject irrelevant types/attributes before asking the DOM about scope.
      // Shared delivery includes records requested only by other modules.
      const matchesType =
        (mutation.type === "childList" && options.childList) ||
        (mutation.type === "characterData" && options.characterData) ||
        (mutation.type === "attributes" && options.attributes &&
          (!options.attributeFilter || options.attributeFilter.includes(mutation.attributeName)));
      if (!matchesType) continue;
      if (
        mutation.target === target ||
        (options.subtree && target.contains(mutation.target))
      ) {
        return true;
      }
    }

    return false;
  }

  function buildMutationCoverage(activeObservers) {
    const registrations = new Map();
    activeObservers.forEach((observer) => {
      observer.registrations.forEach((options, target) => {
        registrations.set(
          target,
          mergeMutationOptions(registrations.get(target), options),
        );
      });
    });

    return { registrations };
  }

  function publishRuntimeErrors() {
    const root = document.documentElement;
    if (!root || !runtimeErrors.length) return false;
    root.setAttribute(RUNTIME_ERRORS_ATTRIBUTE, JSON.stringify(runtimeErrors));
    return true;
  }

  function recordRuntimeError(ownerId, operation, error) {
    runtimeErrors.push({
      module: String(ownerId || "suite").slice(0, 100),
      operation: String(operation || "runtime").slice(0, 160),
      message: String(error?.message || error).slice(0, 500),
      timestamp: new Date().toISOString(),
    });
    if (runtimeErrors.length > MAX_RUNTIME_ERRORS) {
      runtimeErrors.splice(0, runtimeErrors.length - MAX_RUNTIME_ERRORS);
    }

    if (publishRuntimeErrors() || runtimeErrorPublishPending) return;
    runtimeErrorPublishPending = true;
    document.addEventListener(
      "readystatechange",
      () => {
        runtimeErrorPublishPending = false;
        publishRuntimeErrors();
      },
      { once: true },
    );
  }

  function reportModuleError(ownerId, label, error) {
    console.error(
      `[YouTube Master Suite] [${ownerId}] ${label} failed`,
      error,
    );
    recordRuntimeError(ownerId, label, error);
  }

  function now() {
    return globalThis.performance?.now?.() ?? Date.now();
  }

  function recordDiagnosticMeasurement(moduleId, operation, units, elapsedMs) {
    const key = `${moduleId}:${operation}`;
    const current = diagnosticStats.get(key) || {
      module: moduleId,
      operation,
      calls: 0,
      units: 0,
      totalMs: 0,
      maxMs: 0,
    };
    current.calls += 1;
    current.units += units;
    current.totalMs += elapsedMs;
    current.maxMs = Math.max(current.maxMs, elapsedMs);
    diagnosticStats.set(key, current);
  }

  function runWithDiagnostics(moduleId, operation, units, callback) {
    if (!DIAGNOSTICS.enabled) {
      return callback();
    }

    const startedAt = now();
    try {
      return callback();
    } finally {
      recordDiagnosticMeasurement(
        moduleId,
        operation,
        units,
        now() - startedAt,
      );
    }
  }

  function getDiagnosticsSnapshot() {
    return [...diagnosticStats.values()]
      .map((entry) => ({
        ...entry,
        averageMs: entry.calls ? entry.totalMs / entry.calls : 0,
      }))
      .sort(
        (left, right) =>
          right.totalMs - left.totalMs ||
          left.module.localeCompare(right.module) ||
          left.operation.localeCompare(right.operation),
      );
  }

  function reportDiagnostics() {
    const snapshot = getDiagnosticsSnapshot();
    document.documentElement?.setAttribute(
      DIAGNOSTICS_ATTRIBUTE,
      JSON.stringify(snapshot),
    );
    if (snapshot.length) {
      console.table(snapshot);
    }
    return snapshot;
  }

  function installDiagnostics() {
    if (!DIAGNOSTICS.enabled) return;

    globalThis.__YT_MASTER_DIAGNOSTICS__ = Object.freeze({
      clear: () => {
        diagnosticStats.clear();
        reportDiagnostics();
      },
      report: reportDiagnostics,
      snapshot: getDiagnosticsSnapshot,
    });
    reportDiagnostics();
    setInterval(reportDiagnostics, DIAGNOSTICS.reportIntervalMs);
  }

  function beginBatch() {
    batchDepth += 1;
  }

  function endBatch() {
    batchDepth -= 1;
    if (batchDepth > 0) return;

    if (mutationRefreshPending) refreshNativeMutationObserver();
    if (styleRenderPending) renderStyles();
  }

  function getCapture(options) {
    return typeof options === "boolean" ? options : Boolean(options?.capture);
  }

  function invokeEventListener(listener, event) {
    if (typeof listener === "function") {
      listener.call(globalThis, event);
      return;
    }
    listener?.handleEvent?.(event);
  }

  function addWindowListener(type, listener, options) {
    const ownerId = activeModuleId;
    if (!SHARED_WINDOW_EVENTS.has(type)) {
      const registeredListener = DIAGNOSTICS.enabled
        ? (event) =>
            runWithDiagnostics(ownerId, `event:${type}`, 1, () =>
              invokeEventListener(listener, event),
            )
        : listener;
      globalThis.addEventListener(type, registeredListener, options);
      return;
    }

    const capture = getCapture(options);
    const key = `${type}|${capture ? "capture" : "bubble"}`;
    let group = sharedWindowListeners.get(key);
    if (!group) {
      group = { listeners: [] };
      sharedWindowListeners.set(key, group);
      globalThis.addEventListener(
        type,
        (event) => {
          beginBatch();
          try {
            for (const registeredListener of [...group.listeners]) {
              try {
                runWithDiagnostics(
                  registeredListener.ownerId,
                  `event:${type}`,
                  1,
                  () => invokeEventListener(registeredListener.listener, event),
                );
              } catch (error) {
                reportModuleError(
                  registeredListener.ownerId,
                  `${type} event listener`,
                  error,
                );
              }
            }
          } finally {
            try {
              endBatch();
            } catch (error) {
              reportModuleError(
                "suite",
                `${type} batch finalisation`,
                error,
              );
            }
          }
        },
        capture,
      );
    }
    group.listeners.push({ listener, ownerId });
  }

  function mutationMatches(observer, mutation) {
    return mutationMatchesRegistrations(
      observer.registrations,
      mutation,
      RUNTIME_ERRORS_ATTRIBUTE,
    );
  }

  function dispatchMutationsWithDiagnostics(mutations) {
    const dispatchStartedAt = now();
    let accountedMs = 0;
    try {
      for (const observer of [...sharedMutationObservers]) {
        if (!observer.active) continue;
        const filterStartedAt = now();
        let matchingMutations;
        try {
          matchingMutations = mutations.filter((mutation) =>
            mutationMatches(observer, mutation),
          );
        } finally {
          const filterElapsedMs = now() - filterStartedAt;
          recordDiagnosticMeasurement(
            observer.ownerId,
            "mutation:filter",
            mutations.length,
            filterElapsedMs,
          );
          accountedMs += now() - filterStartedAt;
        }
        if (!matchingMutations.length) continue;

        const callbackStartedAt = now();
        try {
          runWithDiagnostics(
            observer.ownerId,
            "mutation",
            matchingMutations.length,
            () => observer.callback(matchingMutations, observer),
          );
        } catch (error) {
          reportModuleError(
            observer.ownerId,
            "mutation observer callback",
            error,
          );
        } finally {
          accountedMs += now() - callbackStartedAt;
        }
      }
    } finally {
      recordDiagnosticMeasurement(
        "suite",
        "mutation:dispatch-overhead",
        mutations.length,
        Math.max(0, now() - dispatchStartedAt - accountedMs),
      );
    }
  }

  function dispatchMutations(mutations) {
    // A native observer notification may already be queued when a rebuild
    // drains its records. Flush that older batch before any records captured
    // by the replacement observer so logical callbacks retain DOM order.
    flushPreservedMutationBatches();

    if (DIAGNOSTICS.enabled) {
      dispatchMutationsWithDiagnostics(mutations);
      return;
    }

    for (const observer of [...sharedMutationObservers]) {
      if (!observer.active) continue;
      const matchingMutations = mutations.filter((mutation) =>
        mutationMatches(observer, mutation),
      );
      if (!matchingMutations.length) continue;

      try {
        observer.callback(matchingMutations, observer);
      } catch (error) {
        reportModuleError(
          observer.ownerId,
          "mutation observer callback",
          error,
        );
      }
    }
  }

  function snapshotLogicalMutationObservers(activeObservers) {
    return new Map(
      activeObservers.map((observer) => [
        observer,
        {
          observer,
          generation: observer.generation,
          registrations: cloneLogicalMutationRegistrations(
            observer.registrations,
          ),
        },
      ]),
    );
  }

  function dispatchPreservedMutationBatch({ records, observerStates }) {
    const dispatch = () => {
      for (const state of observerStates) {
        const { observer } = state;
        if (
          !observer.active ||
          observer.generation !== state.generation
        ) {
          continue;
        }

        const filter = () =>
          records.filter((mutation) => mutationMatches(state, mutation));
        const matchingMutations = DIAGNOSTICS.enabled
          ? runWithDiagnostics(
              observer.ownerId,
              "mutation:filter",
              records.length,
              filter,
            )
          : filter();
        if (!matchingMutations.length) continue;

        try {
          if (DIAGNOSTICS.enabled) {
            runWithDiagnostics(
              observer.ownerId,
              "mutation",
              matchingMutations.length,
              () => observer.callback(matchingMutations, observer),
            );
          } else {
            observer.callback(matchingMutations, observer);
          }
        } catch (error) {
          reportModuleError(
            observer.ownerId,
            "mutation observer callback",
            error,
          );
        }
      }
    };

    if (DIAGNOSTICS.enabled) {
      runWithDiagnostics(
        "suite",
        "mutation:preserved-dispatch",
        records.length,
        dispatch,
      );
    } else {
      dispatch();
    }
  }

  function preserveNativeMutationRecords(records) {
    if (!records.length) return;
    const observerStates = [...nativeLogicalObserverStates.values()].filter(
      ({ observer, generation }) =>
        observer.active && observer.generation === generation,
    );
    if (!observerStates.length) return;

    preservedMutationBatches.push({ records, observerStates });
    if (preservedMutationFlushPending) return;
    preservedMutationFlushPending = true;
    queueMicrotask(flushPreservedMutationBatches);
  }

  function flushPreservedMutationBatches() {
    preservedMutationFlushPending = false;
    const batches = preservedMutationBatches.splice(0);
    batches.forEach(dispatchPreservedMutationBatch);
  }

  function requestMutationRefresh() {
    mutationRefreshPending = true;
    if (!batchDepth) refreshNativeMutationObserver();
  }

  function refreshNativeMutationObserver() {
    mutationRefreshPending = false;
    const activeObservers = [...sharedMutationObservers].filter(
      (observer) => observer.active,
    );
    if (!activeObservers.length) {
      nativeMutationObserver?.disconnect();
      nativeMutationObserver = null;
      nativeMutationCoverage = null;
      nativeLogicalObserverStates = new Map();
      return;
    }

    const requestedCoverage = buildMutationCoverage(activeObservers);
    const requestedLogicalObserverStates =
      snapshotLogicalMutationObservers(activeObservers);
    if (
      nativeMutationObserver &&
      mutationCoverageCovers(nativeMutationCoverage, requestedCoverage)
    ) {
      preserveNativeMutationRecords(nativeMutationObserver.takeRecords());
      nativeLogicalObserverStates = requestedLogicalObserverStates;
      return;
    }

    const replacementObserver = installReplacementMutationObserver(
      NativeMutationObserver,
      dispatchMutations,
      requestedCoverage,
      nativeMutationObserver,
      preserveNativeMutationRecords,
    );
    nativeMutationObserver = replacementObserver;
    nativeMutationCoverage = requestedCoverage;
    nativeLogicalObserverStates = requestedLogicalObserverStates;
  }

  class SharedMutationObserver {
    constructor(callback) {
      if (typeof callback !== "function") {
        throw new TypeError("MutationObserver callback must be a function");
      }
      this.callback = callback;
      this.ownerId = activeModuleId;
      this.registrations = new Map();
      this.active = false;
      this.generation = 0;
    }

    observe(target, options) {
      const wasActive = this.active;
      setLogicalMutationRegistration(this.registrations, target, options);
      if (!wasActive) this.generation += 1;
      this.active = true;
      setSharedMutationObserverRegistryState(
        sharedMutationObservers,
        this,
        true,
      );
      requestMutationRefresh();
    }

    replaceRegistrations(registrations) {
      replaceLogicalMutationRegistrations(
        this,
        sharedMutationObservers,
        registrations,
        () =>
          refreshImmediatelyPreservingPendingState(
            () => mutationRefreshPending,
            (pending) => {
              mutationRefreshPending = pending;
            },
            refreshNativeMutationObserver,
          ),
      );
    }

    disconnect() {
      if (!this.active) return;
      clearLogicalMutationRegistrations(this.registrations);
      this.active = false;
      this.generation += 1;
      setSharedMutationObserverRegistryState(
        sharedMutationObservers,
        this,
        false,
      );
      requestMutationRefresh();
    }

    takeRecords() {
      return [];
    }
  }

  function getCombinedCss() {
    return STYLE_ORDER.filter((id) => styleParts.has(id))
      .map((id) => `/* ${id} */\n${styleParts.get(id)}`)
      .join("\n\n");
  }

  function requestStyleRender() {
    styleRenderPending = true;
    if (!batchDepth) renderStyles();
  }

  function renderStyles() {
    styleRenderPending = false;
    const css = getCombinedCss();
    if (!css) {
      styleElement?.remove();
      styleElement = null;
      return;
    }

    let restored = false;
    if (!styleElement?.isConnected) {
      const parent = document.head || document.documentElement;
      if (!parent) {
        styleRenderPending = true;
        return;
      }
      styleElement = document.createElement("style");
      styleElement.id = "yt-master-suite-style";
      parent.appendChild(styleElement);
      restored = true;
    }
    if (restored || styleElement.textContent !== css) {
      styleElement.textContent = css;
    }
  }

  function setStyle(id, css) {
    const normalisedCss = String(css || "");
    const changed = styleParts.get(id) !== normalisedCss;
    const missingElement = !styleElement?.isConnected;
    if (changed) styleParts.set(id, normalisedCss);
    if (changed || missingElement) requestStyleRender();
    return changed || missingElement;
  }

  function removeStyle(id) {
    if (!styleParts.delete(id)) return false;
    requestStyleRender();
    return true;
  }

  function executeModule(id, label, initialise) {
    if (!ENABLED_MODULES[id]) {
      moduleStates.set(id, { status: "disabled" });
      return;
    }
    const previousModuleId = activeModuleId;
    activeModuleId = id;
    try {
      runWithDiagnostics(id, "initialise", 1, initialise);
      moduleStates.set(id, { status: "initialised" });
    } catch (error) {
      moduleStates.set(id, {
        status: "failed",
        error: String(error?.message || error).slice(0, 500),
      });
      reportModuleError(id, label, error);
    } finally {
      activeModuleId = previousModuleId;
    }
  }

  function registerModule(id, label, phase, initialise) {
    if (!Object.hasOwn(ENABLED_MODULES, id)) {
      throw new Error(`Unknown module registration: ${id}`);
    }
    if (registeredModuleIds.has(id)) {
      throw new Error(`Duplicate module registration: ${id}`);
    }
    registeredModuleIds.add(id);
    moduleStates.set(id, {
      status: ENABLED_MODULES[id] ? "pending" : "disabled",
    });

    if (phase === "document-start") {
      executeModule(id, label, initialise);
      return;
    }
    idleModules.push({ id, label, initialise });
  }

  function startIdleModules() {
    const start = () => {
      beginBatch();
      try {
        idleModules.forEach(({ id, label, initialise }) =>
          executeModule(id, label, initialise),
        );
      } finally {
        endBatch();
        publishHealthMarker();
      }
    };

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", start, { once: true });
    } else {
      queueMicrotask(start);
    }
  }

  function publishHealthMarker() {
    const root = document.documentElement;
    if (!root) return false;

    const registeredModules = registeredModuleIds.size;
    const states = [...registeredModuleIds].map((id) => ({
      id,
      ...(moduleStates.get(id) || { status: "pending" }),
    }));
    const moduleIdsWithStatus = (status) =>
      states.filter((entry) => entry.status === status).map(({ id }) => id);
    const enabledModules = states
      .filter((entry) => entry.status !== "disabled")
      .map(({ id }) => id);
    const initialisedModules = moduleIdsWithStatus("initialised");
    const pendingModules = moduleIdsWithStatus("pending");
    const disabledModules = moduleIdsWithStatus("disabled");
    const failedModules = states
      .filter((entry) => entry.status === "failed")
      .map(({ id, error }) => ({ id, error }));
    const ready = pendingModules.length === 0;
    root.setAttribute(
      HEALTH_ATTRIBUTE,
      JSON.stringify({
        version: MASTER_VERSION,
        registeredModules,
        expectedModules: EXPECTED_MODULE_COUNT,
        enabledModules,
        initialisedModules,
        pendingModules,
        disabledModules,
        failedModules,
        ready,
        healthy:
          registeredModules === EXPECTED_MODULE_COUNT &&
          ready &&
          failedModules.length === 0,
      }),
    );
    return true;
  }

  const createSuiteSettings = function createSuiteSettings(getStorage, isDarkTheme) {
  const key = "yt-master-suite.settings.v1";
  const cornerKey = "yt-master-suite.scroll-miniplayer.corner.v1";
  const defaults = Object.freeze({
    colourMode: "default", palette: "teal-coral", viewerColour: "#82A3E6", ownerColour: "#FF9F1C",
    compactComments: true, hideCommentControls: true,
    hideShorts: true, hideWatchedVideos: true, hideMixes: true, hidePodcasts: true, hideMembersOnly: true,
    watchedThreshold: "90", yellowCaptions: true, mirrorButton: true, theatreMode: true,
    preferredVideoQuality: "off", hideFullscreenQuickActions: false,
    wheelVolume: true, wheelStep: "5", hideRelated: true, hideChat: true, hideInfoCards: true,
    hideEndScreens: true, fullscreenComments: true, disableTitleHashtagLinks: false, miniplayerEnabled: true,
    corner: "top-right", queueInfo: true,
    headerSettingsIcon: "colour", playerSettingsIcon: "monochrome",
    showRydTooltipBar: false,
    showDeArrowTitleButton: false,
    showDeArrowQueueButton: true,
    menuShowDownload: false, menuGroupChannelTools: true, menuShowAgeLimit: true,
    menuShowNotInterested: true, menuShowDontRecommend: true, menuShowReport: true,
    menuItemOrder: Object.freeze(["playNext", "addToQueue", "watchLater", "savePlaylist", "download", "share",
      "notInterested", "dontRecommend", "report", "channelAge", "channelTools"]),
  });
  const choices = Object.freeze({
    colourMode: ["default", "preset", "custom", "off"],
    palette: ["teal-coral", "lavender-gold", "cyan-rose"],
    watchedThreshold: ["80", "90", "95", "100"], wheelStep: ["1", "2", "5", "10"],
    preferredVideoQuality: ["off", "highest", "tiny", "small", "medium", "large", "hd720", "hd1080", "hd1440", "hd2160"],
    corner: ["top-right", "bottom-right", "bottom-left", "top-left"],
    headerSettingsIcon: ["off", "colour", "monochrome"], playerSettingsIcon: ["off", "colour", "monochrome"],
  });
  const palettes = Object.freeze({
    dark: {
      "teal-coral": ["#80CBC4", "#FFAB91"], "lavender-gold": ["#B39DDB", "#FFD54F"], "cyan-rose": ["#81D4FA", "#F48FB1"],
    },
    light: {
      "teal-coral": ["#00695C", "#A83222"], "lavender-gold": ["#65409B", "#806000"], "cyan-rose": ["#006A8E", "#A82659"],
    },
  });
  function normaliseHex(value) {
    return typeof value === "string" && /^#?[0-9a-f]{6}$/i.test(value.trim())
      ? "#" + value.trim().replace(/^#/, "").toUpperCase() : null;
  }
  function validate(input) {
    const result = { ...defaults, menuItemOrder: [...defaults.menuItemOrder] };
    if (!input || typeof input !== "object" || Array.isArray(input)) return result;
    for (const [name, fallback] of Object.entries(defaults)) {
      if (!Object.hasOwn(input, name)) continue;
      const value = input[name];
      if (typeof fallback === "boolean") {
        if (typeof value === "boolean") result[name] = value;
      } else if (name === "menuItemOrder") {
        if (Array.isArray(value) && value.length <= defaults.menuItemOrder.length) {
          const order = [...new Set(value.filter(item => typeof item === "string" && defaults.menuItemOrder.includes(item)))];
          result[name] = [...order, ...defaults.menuItemOrder.filter(item => !order.includes(item))];
        }
      } else if (name === "viewerColour" || name === "ownerColour") {
        result[name] = normaliseHex(value) || fallback;
      } else if (choices[name]?.includes(value)) result[name] = value;
    }
    // Recover a corrupted or manually edited record without hiding all access.
    if (result.headerSettingsIcon === "off" && result.playerSettingsIcon === "off") result.headerSettingsIcon = defaults.headerSettingsIcon;
    return result;
  }
  function read() {
    try {
      const storage = getStorage();
      const raw = storage.getItem(key);
      let record = null;
      if (raw && raw.length <= 8192) {
        try { record = JSON.parse(raw); } catch { /* Keep defaults, but still read the existing corner. */ }
      }
      const values = validate(record?.version === 1 ? record.values : null);
      // Keep the miniplayer's existing synchronised corner as its one source of truth.
      const corner = storage.getItem(cornerKey);
      if (choices.corner.includes(corner)) values.corner = corner;
      return values;
    } catch { return { ...defaults, menuItemOrder: [...defaults.menuItemOrder] }; }
  }
  const initialValues = read();
  Object.freeze(initialValues.menuItemOrder);
  const initial = Object.freeze(initialValues);
  function save(input) {
    if (input?.headerSettingsIcon === "off" && input?.playerSettingsIcon === "off") {
      return { ok: false, error: "Keep at least one settings button enabled." };
    }
    const values = validate(input);
    let storage, previous;
    try {
      storage = getStorage(); previous = storage.getItem(key);
      storage.setItem(key, JSON.stringify({ version: 1, values }));
      if (storage.getItem(cornerKey) !== values.corner) storage.setItem(cornerKey, values.corner);
      return { ok: true, values };
    } catch {
      // Do not leave half-saved panel preferences if writing the legacy corner fails.
      try {
        if (previous === null) storage?.removeItem(key);
        else if (previous !== undefined) storage?.setItem(key, previous);
      } catch { /* Storage may remain unavailable; report the failure below. */ }
      return { ok: false, error: "Settings could not be saved. Browser storage is unavailable or full." };
    }
  }
  function colours(values = initial, dark = isDarkTheme()) {
    const checked = validate(values);
    if (checked.colourMode === "off") return null;
    if (checked.colourMode === "preset") return palettes[dark ? "dark" : "light"][checked.palette];
    if (checked.colourMode === "custom") return [checked.viewerColour, checked.ownerColour];
    return [defaults.viewerColour, defaults.ownerColour];
  }
  function overrides(id, config) {
    const values = initial;
    if (id === "commentCleaner") {
      const pair = colours();
      return {
        compactComments: values.compactComments, hideCommentControls: values.hideCommentControls,
        colourCommenters: values.colourMode !== "off",
        commenterColour: values.colourMode === "preset" ? "var(--ytms-viewer-colour, #82a3e6)" : (pair?.[0] || defaults.viewerColour),
        uploaderColour: values.colourMode === "preset" ? "var(--ytms-owner-colour, #ff9f1c)" : (pair?.[1] || defaults.ownerColour),
      };
    }
    if (id === "feedUiCleaner") return {
      filterProfiles: Object.fromEntries(Object.entries(config.filterProfiles).map(([route, profile]) => [route, {
        ...profile, mixes: values.hideMixes, membersOnly: values.hideMembersOnly, podcasts: values.hidePodcasts,
      }])),
    };
    if (id === "playerPreferencesLite") return {
      hideShorts: values.hideShorts, hideWatchedVideos: values.hideWatchedVideos,
      watchedVideoThresholdPercent: Number(values.watchedThreshold),
      useReadableYellowCaptions: values.yellowCaptions, enableVideoMirrorButton: values.mirrorButton,
      enableTheaterMode: values.theatreMode, enablePlayerWheelVolume: values.wheelVolume,
      preferredVideoQuality: values.preferredVideoQuality, hideFullscreenQuickActions: values.hideFullscreenQuickActions,
      wheelVolumeStep: Number(values.wheelStep), hideRelatedVideos: values.hideRelated,
      hideChat: values.hideChat, hideInfoCards: values.hideInfoCards,
      hideEndScreenRecommendationGrid: values.hideEndScreens, enableFullscreenComments: values.fullscreenComments,
      disableTitleHashtagLinks: values.disableTitleHashtagLinks,
      showRydTooltipBar: values.showRydTooltipBar,
      showDeArrowTitleButton: values.showDeArrowTitleButton,
      feedFilterProfiles: Object.fromEntries(Object.entries(config.feedFilterProfiles).map(([route, profile]) => [route, {
        ...profile, watchedVideos: route === "history" ? false : values.hideWatchedVideos,
      }])),
    };
    if (id === "scrollMiniplayer") return { enabled: values.miniplayerEnabled, showCompactQueueInfo: values.queueInfo };
    if (id === "watchLayoutCleaner") return {
      relatedVideosHideBreakpointPx: values.hideRelated ? config.relatedVideosHideBreakpointPx : 0,
      showDeArrowQueueButton: values.showDeArrowQueueButton,
    };
    return {};
  }
  return Object.freeze({ key, cornerKey, defaults, initial, read, save, validate, colours, normaliseHex, overrides });
};
  const createChannelAgeService = function createChannelAgeService(getStorage, now = () => Date.now()) {
  const key = "yt-master-suite.channel-age.v1";
  const idPattern = /^UC[A-Za-z0-9_-]{22}$/;
  const day = 86400000;
  const units = ["days", "weeks", "months", "years"];
  let current = [];
  let enabledRules = new Map();

  function normaliseChannelId(input) {
    if (typeof input !== "string") return null;
    const value = input.trim();
    if (idPattern.test(value)) return value;
    const match = /^https:\/\/www\.youtube\.com\/channel\/(UC[A-Za-z0-9_-]{22})\/?$/.exec(value);
    return match ? match[1] : null;
  }

  function label(input) {
    return typeof input === "string"
      ? input.replace(/[\u0000-\u001f\u007f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 100)
      : "";
  }

  function validateRules(input) {
    if (!Array.isArray(input)) return [];
    const result = [];
    const seen = new Set();
    // Bound work even for a malformed manually edited storage record.
    for (const value of input.slice(0, 100)) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const channelId = normaliseChannelId(value.channelId);
      if (!channelId || seen.has(channelId) || !Number.isInteger(value.maxAge) || value.maxAge < 1 || value.maxAge > 1000 || !units.includes(value.unit)) continue;
      if (value.enabled !== undefined && typeof value.enabled !== "boolean") continue;
      if (value.blocked !== undefined && typeof value.blocked !== "boolean") continue;
      seen.add(channelId);
      result.push({ channelId, name: label(value.name), maxAge: value.maxAge, unit: value.unit, enabled: value.enabled !== false, blocked: value.blocked === true });
    }
    return result;
  }

  function snapshot(rules) {
    return rules.map(rule => ({ ...rule }));
  }

  function setCurrent(rules) {
    current = snapshot(rules);
    enabledRules = new Map(current.filter(rule => rule.enabled).map(rule => [rule.channelId, rule]));
  }

  function storedRules(raw) {
    const record = raw && raw.length <= 65536 ? JSON.parse(raw) : null;
    return validateRules(record?.version === 1 ? record.rules : null);
  }

  function read() {
    try {
      setCurrent(storedRules(getStorage().getItem(key)));
    } catch {
      // Unavailable/corrupted storage must not hide any videos.
      setCurrent([]);
    }
    return snapshot(current);
  }

  function save(input, expectedRules) {
    let rules;
    try { rules = validateRules(input); } catch { rules = []; }
    if (!Array.isArray(input) || input.length > 100 || rules.length !== input.length) {
      return { ok: false, error: "Use up to 100 unique channel IDs, each with a whole-number age from 1 to 1000 and a valid unit." };
    }
    let storage, previous;
    try {
      storage = getStorage();
      previous = storage.getItem(key);
      if (expectedRules !== undefined) {
        let latest = [];
        try { latest = storedRules(previous); } catch { /* A corrupt record follows read()'s empty-rule fallback. */ }
        if (JSON.stringify(latest) !== JSON.stringify(expectedRules)) {
          setCurrent(latest);
          return { ok: false, error: 'Channel filters changed in another window. Your draft has been kept. Cancel and reopen before saving.' };
        }
      }
      storage.setItem(key, JSON.stringify({ version: 1, rules }));
      setCurrent(rules);
      return { ok: true, rules: snapshot(rules) };
    } catch {
      // The live snapshot changes only after a successful complete write.
      try {
        if (previous === null) storage?.removeItem(key);
        else if (previous !== undefined) storage?.setItem(key, previous);
      } catch { /* Storage is unavailable; preserve the current in-memory rules. */ }
      return { ok: false, error: "Channel filters could not be saved. Browser storage is unavailable or full." };
    }
  }

  function getRules() {
    return snapshot(current);
  }

  function hasEnabledRules() {
    return enabledRules.size > 0;
  }

  function text(value) {
    if (typeof value === "string") return value.slice(0, 500);
    if (!value || typeof value !== "object") return "";
    if (typeof value.simpleText === "string") return value.simpleText.slice(0, 500);
    if (typeof value.content === "string") return value.content.slice(0, 500);
    return Array.isArray(value.runs) ? value.runs.slice(0, 10).map(run => typeof run?.text === "string" ? run.text : "").join("").slice(0, 500) : "";
  }

  function records(card) {
    const found = [];
    const nodes = [card, ...Array.from(card?.querySelectorAll?.("ytd-rich-grid-media, yt-lockup-view-model, ytm-lockup-view-model") || []).slice(0, 4)];
    for (const node of nodes) {
      let controller, componentData;
      try {
        controller = node?.polymerController || (typeof node?.getPolymerController === "function" ? node.getPolymerController() : null);
      } catch { /* An unavailable renderer controller must not prevent DOM identity checks. */ }
      try {
        if (typeof node?.componentProps?.data === "function") componentData = node.componentProps.data();
      } catch { /* A detached current component retains the existing DOM/legacy fallback. */ }
      for (const value of [node?.data, node?.__data?.data, controller?.data, controller?.__data?.data, componentData]) {
        if (!value || typeof value !== "object") continue;
        found.push(value);
        for (const candidate of [value.videoRenderer, value.compactVideoRenderer, value.gridVideoRenderer, value.content?.videoRenderer, value.content?.richItemRenderer?.content?.videoRenderer, value.lockupViewModel]) {
          if (candidate && typeof candidate === "object") found.push(candidate);
        }
      }
    }
    return found.slice(0, 30);
  }

  function metadataParts(record) {
    const rows = record?.metadata?.lockupMetadataViewModel?.metadata?.contentMetadataViewModel?.metadataRows
      || record?.metadata?.contentMetadataViewModel?.metadataRows;
    return Array.isArray(rows) ? rows.slice(0, 4).flatMap(row => Array.isArray(row?.metadataParts) ? row.metadataParts.slice(0, 5) : []) : [];
  }

  function channelFromRecords(card, data) {
    const candidates = new Map();
    function add(id, name) {
      const channelId = normaliseChannelId(id);
      if (!channelId) return;
      candidates.set(channelId, candidates.get(channelId) || label(name));
    }
    const bylineSelector = [
      "#channel-name a[href]", "#byline a[href]", "ytd-channel-name a[href]",
      ".yt-content-metadata-view-model__metadata-text a[href]",
      ".yt-content-metadata-view-model__metadata-row a[href]",
      ".ytContentMetadataViewModelMetadataText a[href]",
    ].join(",");
    for (const anchor of Array.from(card.querySelectorAll(bylineSelector)).slice(0, 20)) {
      const href = anchor.getAttribute("href") || "";
      add(href.startsWith("/channel/") ? `https://www.youtube.com${href}` : href, anchor.textContent);
    }
    for (const record of data) {
      // Current History lockups keep the owner endpoint on the avatar, while
      // their visible byline is plain text rather than a clickable channel link.
      const avatar = record.metadata?.lockupMetadataViewModel?.image?.decoratedAvatarViewModel;
      add(avatar?.rendererContext?.commandContext?.onTap?.innertubeCommand?.browseEndpoint?.browseId,
        text(metadataParts(record)[0]?.text));
      for (const byline of [record.ownerText, record.shortBylineText, record.longBylineText]) {
        for (const run of Array.isArray(byline?.runs) ? byline.runs.slice(0, 5) : []) {
          add(run?.navigationEndpoint?.browseEndpoint?.browseId, run?.text);
        }
      }
      for (const part of metadataParts(record)) {
        for (const run of Array.isArray(part?.text?.commandRuns) ? part.text.commandRuns.slice(0, 5) : []) {
          const command = run?.onTap?.innertubeCommand || run?.onTap;
          add(command?.browseEndpoint?.browseId, text(part.text));
        }
      }
    }
    if (candidates.size !== 1) return null;
    const [channelId, name] = candidates.entries().next().value;
    return { channelId, name: name || channelId };
  }

  function channelFromCard(card) {
    return card?.querySelectorAll ? channelFromRecords(card, records(card)) : null;
  }

  function liveOrUpcoming(card, data) {
    if (card.matches?.('[data-ytppl-upcoming-hidden="1"]') || card.querySelector('[overlay-style="LIVE"], [overlay-style="UPCOMING"], [data-ytppl-upcoming-hidden="1"]')) return true;
    for (const element of Array.from(card.querySelectorAll("ytd-badge-supported-renderer, ytd-thumbnail-overlay-time-status-renderer, .yt-badge-shape__text, .ytBadgeShapeBadgeText")).slice(0, 20)) {
      if (/^(?:live|live now|upcoming|premiere|scheduled)$/i.test(String(element.textContent || "").trim())) return true;
    }
    return data.some(record => record.isLiveNow === true || Boolean(record.upcomingEventData)
      || (Array.isArray(record.badges) && record.badges.slice(0, 5).some(badge => /LIVE_NOW|UPCOMING/.test(badge?.metadataBadgeRenderer?.style || "")))
      || (Array.isArray(record.thumbnailOverlays) && record.thumbnailOverlays.slice(0, 5).some(overlay => /^(?:LIVE|UPCOMING)$/.test(overlay?.thumbnailOverlayTimeStatusRenderer?.style || ""))));
  }

  function subtractMonths(timestamp, count) {
    const date = new Date(timestamp);
    const originalDay = date.getUTCDate();
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() - count);
    const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
    date.setUTCDate(Math.min(originalDay, lastDay));
    return date.getTime();
  }

  function cutoff(rule, timestamp) {
    if (rule.unit === "months" || rule.unit === "years") return subtractMonths(timestamp, rule.maxAge * (rule.unit === "years" ? 12 : 1));
    return timestamp - rule.maxAge * (rule.unit === "weeks" ? 7 : 1) * day;
  }

  function latestPublication(value, timestamp) {
    const source = String(value || "").replace(/\s+/g, " ").trim();
    const relative = /^(?:(?:streamed|premiered)\s+)?(\d{1,4})\s+(second|minute|hour|day|week|month|year)s?\s+ago$/i.exec(source);
    if (relative) {
      const number = Number(relative[1]);
      if (!number || number > 1000) return null;
      // YouTube rounds relative labels. Use the youngest possible date, never
      // a midpoint. Months use 28 days so short calendar months remain safe.
      const minimumMs = { second: 1000, minute: 60000, hour: 3600000, day, week: 7 * day, month: 28 * day, year: 365 * day }[relative[2].toLowerCase()];
      return timestamp - number * minimumMs;
    }
    if (/^(?:today|yesterday|just now)$/i.test(source)) return timestamp;
    if (/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)?$/.test(source)) {
      const result = Date.parse(source);
      if (!Number.isFinite(result)) return null;
      // Reject date overflow such as February 31 rather than normalising it.
      if (new Date(result).toISOString().slice(0, 10) !== source.slice(0, 10)) return null;
      return source.length === 10 ? result + day - 1 : result;
    }
    const months = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
    const absolute = /^(?:(?:streamed|premiered)\s+(?:on\s+)?)?([A-Za-z]{3,9})\s+(\d{1,2}),\s+(\d{4})$/i.exec(source)
      || /^(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})$/.exec(source);
    if (!absolute) return null;
    const monthFirst = /^[A-Za-z]/.test(absolute[1]);
    const month = months[(monthFirst ? absolute[1] : absolute[2]).slice(0, 3).toLowerCase()];
    const date = Number(monthFirst ? absolute[2] : absolute[1]);
    const year = Number(absolute[3]);
    if (month === undefined || year < 2005 || year > 9999 || date < 1 || date > 31) return null;
    const result = new Date(Date.UTC(year, month, date));
    if (result.getUTCMonth() !== month || result.getUTCDate() !== date) return null;
    return result.getTime() + day - 1;
  }

  function isOlderThanRule(card, rule, data) {
    const timestamp = Number(now());
    if (!Number.isFinite(timestamp)) return false;
    if (liveOrUpcoming(card, data)) return false;
    const dates = [];
    for (const record of data) {
      dates.push(text(record.publishedTimeText));
      for (const part of metadataParts(record)) dates.push(text(part.text));
    }
    const selector = '#metadata-line > span, #metadata-line > yt-formatted-string, #metadata > span, .yt-content-metadata-view-model__metadata-text, .ytContentMetadataViewModelMetadataText, time[datetime]';
    for (const element of Array.from(card.querySelectorAll(selector)).slice(0, 20)) {
      dates.push(element.getAttribute("datetime") || element.textContent);
    }
    const publications = dates.map(value => latestPublication(value, timestamp)).filter(value => value !== null);
    // A fresh DOM date alongside stale renderer data must keep the card visible
    // while YouTube recycles it. Ambiguous dates therefore fail open.
    return publications.length > 0 && Math.max(...publications) < cutoff(rule, timestamp);
  }

  function cardFilterReason(card) {
    if (!enabledRules.size || !card?.querySelectorAll) return null;
    // Renderers can be recycled between calls; share this snapshot only here.
    const data = records(card);
    const owner = channelFromRecords(card, data);
    const rule = owner && enabledRules.get(owner.channelId);
    if (!rule) return null;
    // Suite-owned blocks are not YouTube recommendation-feedback history.
    // Deliberately hide all uploads, including undated/live cards, but only
    // on the feed surfaces selected by the caller.
    if (rule.blocked) return "Channel hidden";
    return isOlderThanRule(card, rule, data) ? "Channel age" : null;
  }

  function isCardTooOld(card) {
    return cardFilterReason(card) === "Channel age";
  }

  read();
  return { key, normaliseChannelId, validateRules, read, save, getRules, hasEnabledRules, channelFromCard, cardFilterReason, isCardTooOld };
};
  const suite = {
    version: MASTER_VERSION,
    SharedMutationObserver,
    addWindowListener,
    registerModule,
    reportModuleError,
    removeStyle,
    setStyle,
    settings: createSuiteSettings(() => window.localStorage, () => document.documentElement.hasAttribute("dark")),
    channelAge: createChannelAgeService(() => window.localStorage),
    createChannelAgeDialog: function createChannelAgeDialog(document, service) {
  function element(tag, attributes = {}, ...children) {
    const node = document.createElement(tag);
    for (const [name, value] of Object.entries(attributes)) {
      if (value === true) node.setAttribute(name, '');
      else if (value !== false && value != null) node.setAttribute(name, String(value));
    }
    node.append(...children);
    return node;
  }
  const button = (id, text, className = 'ytms-age-button') =>
    element('button', { id, type: 'button', class: className }, text);
  const title = element('h2', { id: 'ytms-age-title' }, 'Channel upload filters');
  const closeButton = button('ytms-age-close', '×', 'ytms-age-close');
  closeButton.setAttribute('aria-label', 'Close channel upload filters');
  const intro = element('p', { id: 'ytms-age-intro', class: 'ytms-age-note' },
    'Hide older uploads or block all uploads from selected channels in feeds and search. Watched-video filtering remains separate. Queues, saved playlists, Watch History and directly opened videos are left unchanged.');
  const instructions = element('p', { class: 'ytms-age-note' },
    'Use a UC channel ID or a youtube.com/channel/ URL, not a handle. Each age limit moves forwards automatically; uncertain dates stay visible unless the whole channel is blocked. These Suite filters are separate from YouTube’s Don’t recommend channel choices.');
  const list = element('div', { id: 'ytms-age-list', role: 'list', 'aria-label': 'Channel upload filters' });
  const empty = element('p', { class: 'ytms-age-note', id: 'ytms-age-empty' }, 'No channel upload filters. Channels are unaffected until you add and save a rule.');
  const addButton = button('ytms-age-add', 'Add another channel', 'ytms-age-button ytms-age-outlined');
  const status = element('p', { id: 'ytms-age-status', class: 'ytms-age-status', role: 'status', hidden: true });
  const cancel = button('ytms-age-cancel', 'Cancel');
  const save = button('ytms-age-save', 'Save filters', 'ytms-age-button ytms-age-primary');
  const content = element('div', { class: 'ytms-age-content' }, intro, instructions, list, empty, addButton);
  const dialog = element('dialog', {
    id: 'ytms-age-dialog', lang: 'en-GB', 'aria-labelledby': title.id, 'aria-describedby': intro.id,
  }, element('div', { class: 'ytms-age-panel' },
    element('header', {}, title, closeButton), content,
    element('footer', {}, status, element('span', { class: 'ytms-age-spacer' }), cancel, save)));
  document.body.append(dialog);
  let saved = [];
  let draft = [];
  let rowSequence = 0;
  let newRules = new WeakSet();

  function markChanged() {
    status.hidden = true;
    status.classList.remove('ytms-age-error');
  }
  function showStatus(message, error = false) {
    status.textContent = message;
    status.classList.toggle('ytms-age-error', error);
    status.hidden = false;
  }
  function render(focusRule) {
    list.replaceChildren();
    empty.hidden = draft.length !== 0;
    addButton.disabled = draft.length >= 100;
    for (const rule of draft) {
      const sequence = ++rowSequence;
      const card = element('div', { class: 'ytms-age-rule', role: 'listitem' });
      const editing = rule === focusRule;
      const heading = element('h3', {}, rule.name || rule.channelId || 'New channel filter');
      const summary = element('div', { class: 'ytms-age-summary', hidden: editing },
        element('p', { class: 'ytms-age-channel-id' }, service.normaliseChannelId(rule.channelId) || rule.channelId),
        element('p', {}, rule.blocked ? 'All uploads hidden' :
          `Maximum upload age: ${rule.maxAge} ${rule.maxAge === 1 ? rule.unit.slice(0, -1) : rule.unit}`),
        element('p', {}, `Status: ${rule.enabled ? 'Enabled' : 'Disabled'}`));
      const labelField = (labelText, input, className = '') => {
        const label = element('span', { id: `${input.id}-label` }, labelText);
        input.setAttribute('aria-labelledby', label.id);
        return element('label', { class: `ytms-age-field ${className}`, for: input.id }, label, input);
      };
      const name = element('input', {
        id: `ytms-age-name-${sequence}`, type: 'text', maxlength: 120,
        autocomplete: 'off', value: rule.name, placeholder: 'Optional display name',
      });
      name.addEventListener('input', () => { rule.name = name.value; updateIdentity(); markChanged(); });
      const channel = element('input', {
        id: `ytms-age-channel-${sequence}`, type: 'text', maxlength: 256,
        autocomplete: 'off', spellcheck: 'false', value: rule.channelId,
        placeholder: 'UC… or https://www.youtube.com/channel/UC…',
      });
      channel.addEventListener('input', () => { rule.channelId = channel.value; updateIdentity(); markChanged(); });
      const maxAge = element('input', {
        id: `ytms-age-value-${sequence}`, type: 'number', min: 1, max: 1000, step: 1,
        inputmode: 'numeric', value: rule.maxAge,
      });
      maxAge.addEventListener('input', () => { rule.maxAge = Number(maxAge.value); markChanged(); });
      const unit = element('select', { id: `ytms-age-unit-${sequence}` },
        ...[['days', 'Days'], ['weeks', 'Weeks'], ['months', 'Months'], ['years', 'Years']]
          .map(([value, text]) => element('option', { value }, text)));
      unit.value = rule.unit;
      unit.addEventListener('change', () => { rule.unit = unit.value; markChanged(); });
      const enabled = element('input', { id: `ytms-age-enabled-${sequence}`, type: 'checkbox' });
      enabled.checked = rule.enabled;
      enabled.addEventListener('change', () => { rule.enabled = enabled.checked; markChanged(); });
      const blocked = element('input', { id: `ytms-age-blocked-${sequence}`, type: 'checkbox' });
      blocked.checked = rule.blocked === true;
      maxAge.disabled = unit.disabled = blocked.checked;
      blocked.addEventListener('change', () => {
        rule.blocked = blocked.checked; maxAge.disabled = unit.disabled = blocked.checked; markChanged();
      });
      const edit = button(`ytms-age-edit-${sequence}`, 'Edit filter', 'ytms-age-button ytms-age-outlined ytms-age-edit');
      edit.hidden = editing;
      edit.setAttribute('aria-expanded', String(editing));
      edit.setAttribute('aria-controls', `ytms-age-fields-${sequence}`);
      edit.addEventListener('click', () => { if (validateDraft()) render(rule); });
      const apply = button(`ytms-age-apply-${sequence}`, newRules.has(rule) ? 'Add filter' : 'Update filter', 'ytms-age-button ytms-age-outlined');
      apply.hidden = !editing;
      apply.addEventListener('click', () => {
        if (!validateDraft()) return;
        const added = newRules.has(rule);
        newRules.delete(rule);
        render();
        showStatus(`${rule.name || service.normaliseChannelId(rule.channelId)} ${added ? 'added to' : 'updated in'} this draft. Choose Save filters to apply it.`);
        list.children[draft.indexOf(rule)]?.querySelector('.ytms-age-edit')?.focus();
      });
      const remove = button(`ytms-age-remove-${sequence}`, 'Remove filter', 'ytms-age-button ytms-age-danger');
      const updateIdentity = () => {
        const label = rule.name || rule.channelId;
        heading.textContent = label || 'New channel filter';
        edit.setAttribute('aria-label', `Edit filter for ${label || 'this channel'}`);
        remove.setAttribute('aria-label', `Remove filter for ${label || 'this channel'}`);
      };
      updateIdentity();
      remove.addEventListener('click', () => {
        const index = draft.indexOf(rule);
        draft.splice(index, 1); markChanged(); render(draft[Math.min(index, draft.length - 1)]);
        if (!draft.length) addButton.focus();
      });
      const fields = element('div', { id: `ytms-age-fields-${sequence}`, class: 'ytms-age-fields', hidden: !editing },
        labelField('Channel name', name), labelField('Channel ID or channel URL', channel, 'ytms-age-wide'),
        element('div', { class: 'ytms-age-limit' }, labelField('Maximum age', maxAge), labelField('Unit', unit)),
        element('label', { class: 'ytms-age-blocked', for: blocked.id }, blocked, ' Hide this channel — all uploads'));
      card.append(heading, summary, fields,
        element('div', { class: 'ytms-age-actions' }, element('label', { for: enabled.id, hidden: !editing }, enabled, ' Enabled'),
          element('span', { class: 'ytms-age-spacer' }), edit, apply, remove));
      list.append(card);
      if (rule === focusRule) channel.focus();
    }
  }
  function appendRule(channel = {}) {
    if (draft.length >= 100) {
      showStatus('You can save up to 100 channel rules. Remove an existing rule before adding another.', true);
      return null;
    }
    const rule = { channelId: channel.channelId || '', name: channel.name || '', maxAge: 1, unit: 'weeks', enabled: true, blocked: channel.blocked === true };
    newRules.add(rule);
    draft.push(rule); markChanged(); render(rule);
    return rule;
  }
  addButton.addEventListener('click', () => { if (validateDraft()) appendRule(); });
  function close() { if (dialog.open) dialog.close(); }
  closeButton.addEventListener('click', close);
  cancel.addEventListener('click', close);
  dialog.addEventListener('keydown', event => event.stopPropagation());
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) close();
  });
  function validateDraft() {
    const ids = new Set();
    const invalidIndex = draft.findIndex(rule => {
      const id = service.normaliseChannelId(rule.channelId);
      const invalid = !id || ids.has(id) || !Number.isSafeInteger(rule.maxAge) || rule.maxAge < 1 || rule.maxAge > 1000 ||
        !['days', 'weeks', 'months', 'years'].includes(rule.unit) || typeof rule.name !== 'string' || typeof rule.enabled !== 'boolean' ||
        (rule.blocked !== undefined && typeof rule.blocked !== 'boolean');
      ids.add(id);
      return invalid;
    });
    if (invalidIndex >= 0) {
      render(draft[invalidIndex]);
      showStatus(`Rule ${invalidIndex + 1}: enter a unique UC channel ID or channel URL and a whole-number age from 1 to 1,000. Each channel can have one rule.`, true);
      return false;
    }
    return true;
  }
  save.addEventListener('click', () => {
    if (!validateDraft()) return;
    let result;
    try { result = service.save(draft, saved); }
    catch { showStatus('Could not save channel upload filters. Your previous filters are unchanged.', true); return; }
    if (!result?.ok) {
      showStatus(result?.error || 'Could not save channel upload filters. Your previous filters are unchanged.', true);
      return;
    }
    saved = service.getRules();
    document.defaultView.dispatchEvent(new document.defaultView.CustomEvent('yt-master-channel-age-changed'));
    close();
  });
  return {
    open(channel) {
      if (!dialog.open) {
        saved = service.read();
        draft = saved.map(rule => ({ ...rule }));
        newRules = new WeakSet();
        markChanged(); render(draft[0]); dialog.showModal(); content.scrollTop = 0;
      }
      const channelId = channel && service.normaliseChannelId(channel.channelId);
      if (channelId) {
        const existing = draft.find(rule => service.normaliseChannelId(rule.channelId) === channelId);
        if (channel.remove === true) {
          if (existing) {
            draft.splice(draft.indexOf(existing), 1); render();
            showStatus(`${existing.name || channelId} removed from this draft. Choose Save filters to apply it.`);
            save.focus();
          } else showStatus('This channel is not in the current filter draft. Nothing has been removed.');
        } else if (existing) render(existing);
        else appendRule({ channelId, name: typeof channel.name === 'string' ? channel.name : '', blocked: channel.blocked });
      } else if (!draft.length) addButton.focus();
      else closeButton.focus();
    },
    close,
  };
},
    installVideoMenu: function installVideoMenu(suite) {
  const preferences = suite.settings.initial;
  const cardSelector = 'ytd-video-renderer, ytd-grid-video-renderer, ytd-rich-item-renderer, ytd-compact-video-renderer, yt-lockup-view-model, ytd-playlist-video-renderer, ytd-playlist-panel-video-renderer, yt-playlist-panel-video-renderer';
  const popupSelector = 'ytd-menu-popup-renderer, yt-sheet-view-model';
  const rowSelector = 'ytd-menu-service-item-renderer, ytd-menu-navigation-item-renderer, ytd-menu-service-item-download-renderer, yt-list-item-view-model, yt-download-list-item-view-model';
  const defaultOrder = ['playNext', 'addToQueue', 'watchLater', 'savePlaylist', 'download', 'share', 'notInterested', 'dontRecommend', 'report', 'channelAge', 'channelTools'];
  const order = [...new Set([...(Array.isArray(preferences.menuItemOrder) ? preferences.menuItemOrder.filter(id => defaultOrder.includes(id)) : []), ...defaultOrder])];
  const controller = element => element?.polymerController || element?.getPolymerController?.() || element;
  let trigger = null;
  let active = null;
  let waiting = null;
  let firstFrame = 0;
  let secondFrame = 0;
  let refitFrame = 0;
  let style = null;
  let disposed = false;
  let triggerReason = 'missing-trigger';
  const compatibilityStates = {
    idle: 'not-checked', disposed: 'not-checked', ready: 'recognised',
    'missing-trigger': 'not-applicable',
    'captured-trigger': 'awaiting-menu', 'waiting-for-menu': 'awaiting-menu', 'waiting-for-visible-popup': 'awaiting-menu',
    'unavailable-model': 'loading-menu', 'unsupported-model': 'loading-menu', 'row-count': 'loading-menu', 'row-binding': 'loading-menu',
  };

  function compatibility(status) {
    const root = document.documentElement;
    if (root?.getAttribute?.('data-ytms-video-menu-compatibility') !== status) root?.setAttribute?.('data-ytms-video-menu-compatibility', status);
  }

  function diagnostic(reason) {
    // Fixed reason codes only: never expose titles, channel IDs, URLs or account data.
    const root = document.documentElement;
    if (root?.getAttribute?.('data-ytms-video-menu-status') !== reason) root?.setAttribute?.('data-ytms-video-menu-status', reason);
    compatibility(compatibilityStates[reason] || 'unsupported');
    return false;
  }

  function endpointFor(item) {
    const model = item?.menuServiceItemRenderer || item?.menuNavigationItemRenderer || item?.menuServiceItemDownloadRenderer || item?.listItemViewModel;
    return model?.serviceEndpoint || model?.navigationEndpoint || model?.rendererContext?.commandContext?.onTap?.innertubeCommand;
  }

  function queuedVideoId(item) {
    const actions = endpointFor(item)?.signalServiceEndpoint?.actions;
    if (!Array.isArray(actions) || actions.length !== 1) return null;
    const command = actions[0]?.addToPlaylistCommand;
    const ids = command?.videoIds || [command?.videoId];
    return command?.listType === 'PLAYLIST_EDIT_LIST_TYPE_QUEUE' && Array.isArray(ids) && ids.length === 1 &&
      typeof ids[0] === 'string' && /^[\w-]{11}$/.test(ids[0]) &&
      (command.videoId === undefined || command.videoId === ids[0]) ? ids[0] : null;
  }

  function identify(item, selection) {
    if (item?.downloadListItemViewModel) return 'download';
    const model = item?.menuServiceItemRenderer || item?.menuNavigationItemRenderer || item?.menuServiceItemDownloadRenderer || item?.listItemViewModel;
    const icon = String(model?.icon?.iconType || model?.leadingImage?.sources?.[0]?.clientResource?.imageName || '').toUpperCase();
    if (['QUEUE_PLAY_NEXT', 'ADD_TO_QUEUE_HEAD'].includes(icon) || model?.targetId === 'yt-master-play-next') return 'playNext';
    if (queuedVideoId(item)) return 'addToQueue';
    if (['WATCH_LATER', 'WATCH_LATER_OUTLINE'].includes(icon)) return 'watchLater';
    if (['PLAYLIST_ADD', 'ADD_TO_PLAYLIST', 'PLAYLIST_ADD_OUTLINE', 'BOOKMARK_BORDER'].includes(icon)) return 'savePlaylist';
    if (['DOWNLOAD', 'OFFLINE_DOWNLOAD', 'FILE_DOWNLOAD'].includes(icon) || item?.menuServiceItemDownloadRenderer) return 'download';
    if (['SHARE', 'SHARE_OUTLINE'].includes(icon)) return 'share';
    const library = location.pathname === '/feed/history' || location.pathname === '/playlist' ||
      selection.card.matches('ytd-playlist-video-renderer, ytd-playlist-panel-video-renderer, yt-playlist-panel-video-renderer');
    if (['NOT_INTERESTED', 'NOT_INTERESTED_OUTLINE'].includes(icon) || (!library && icon === 'HIDE')) return 'notInterested';
    if (icon === 'DONT_RECOMMEND_CHANNEL' || (!library && ['REMOVE', 'DO_NOT_DISTURB_ON', 'BLOCK'].includes(icon) && endpointFor(item)?.feedbackEndpoint)) return 'dontRecommend';
    if (['FLAG', 'FLAG_OUTLINE', 'REPORT'].includes(icon)) return 'report';
    return null; // Unrecognised actions retain their native position and behaviour.
  }

  function videoIdFromCard(card) {
    const ids = new Set();
    for (const anchor of card.querySelectorAll('a[href]')) {
      try {
        const url = new URL(anchor.getAttribute('href'), location.origin);
        if (url.origin !== location.origin) continue;
        const id = url.pathname === '/watch' ? url.searchParams.get('v') : /^\/shorts\/([\w-]{11})\/?$/.exec(url.pathname)?.[1];
        if (typeof id === 'string' && /^[\w-]{11}$/.test(id)) ids.add(id);
      } catch { /* Malformed links cannot identify a menu target. */ }
    }
    if (ids.size !== 1) return null;
    const id = [...ids][0];
    try {
      const model = typeof card.componentProps?.data === 'function' ? card.componentProps.data() : controller(card)?.data;
      if (model?.contentType && model.contentType !== 'LOCKUP_CONTENT_TYPE_VIDEO') return null;
      if (model?.videoId && model.videoId !== id) return null;
      if (model?.contentType === 'LOCKUP_CONTENT_TYPE_VIDEO' && model.contentId && model.contentId !== id) return null;
    } catch { return null; }
    return id;
  }

  function menuSignature(items) {
    if (!Array.isArray(items) || !items.length || items.length > 60) return null;
    try {
      let fields = 0;
      const value = JSON.stringify(items, (_key, entry) => {
        if (++fields > 4000 || (typeof entry === 'string' && entry.length > 16384)) throw new Error('Menu model exceeds its bound');
        return entry;
      });
      return value.length <= 131072 ? value : null;
    } catch { return null; }
  }

  function nativeMenuSignature(button, card) {
    // Some queue/library menus have no Add to queue command. Require their
    // exact native model instead; a trusted click alone cannot bind a popup.
    const host = button.closest('ytd-menu-renderer');
    if (!host || !card.contains(host)) return null;
    try {
      const items = controller(host)?.data?.items;
      return Array.isArray(items) && !items.some(queuedVideoId) ? menuSignature(items) : null;
    } catch { return null; }
  }

  function matchesNativeMenu(items, selection) {
    return Boolean(selection.nativeSignature) && menuSignature(items) === selection.nativeSignature;
  }

  function captureTrigger(event) {
    if (!event.isTrusted || (event.type === 'keydown' && !['Enter', ' ', 'ArrowDown'].includes(event.key))) return;
    const button = event.target?.closest?.('button, tp-yt-paper-icon-button, yt-icon-button, [role="button"]');
    const card = button?.closest(cardSelector);
    if (!card || !button.closest('ytd-menu-renderer, .ytLockupMetadataViewModelMenuButton, [aria-haspopup="menu"], [aria-haspopup="true"]') ||
        card.closest('#movie_player')) {
      if (!active?.popup.contains(event.target)) {
        trigger = null;
        triggerReason = card ? 'unsupported-trigger' : 'missing-trigger';
        if (waiting) reset();
      }
      return;
    }
    reset();
    const videoId = videoIdFromCard(card);
    if (!videoId) { trigger = null; triggerReason = 'card-identity'; diagnostic(triggerReason); return; }
    trigger = { button, card, videoId, time: performance.now(), nativeSignature: nativeMenuSignature(button, card),
      keyboard: event.type === 'keydown' || event.detail === 0 };
    triggerReason = 'captured-trigger';
    diagnostic(triggerReason);
    startDiscovery(trigger);
  }

  function ensureStyle() {
    if (style?.isConnected) return;
    style = document.createElement('style');
    style.textContent = `
      .ytms-video-menu-action { box-sizing: border-box; border: 0; border-radius: 0; background: transparent;
        color: var(--yt-sys-color-baseline--text-primary, var(--yt-spec-text-primary, inherit)); cursor: pointer; display: flex; align-items: center; gap: 12px;
        min-height: 40px; width: 100%; padding: 8px 16px; text-align: start; font: 400 14px/20px Roboto, Arial, sans-serif; }
      ytd-menu-popup-renderer .ytms-video-menu-action { min-height: 36px; padding-block: 6px; }
      .ytms-video-menu-action:hover, .ytms-video-menu-action:focus-visible { background: var(--yt-spec-badge-chip-background, #8883); }
      .ytms-video-menu-action:focus-visible { outline: 2px solid var(--yt-spec-call-to-action, #3ea6ff); outline-offset: -2px; }
      .ytms-video-menu-action[aria-disabled="true"] { opacity: .55; cursor: default; }
      .ytms-video-menu-action svg { width: 24px; height: 24px; flex: 0 0 24px; fill: currentColor; }
      .ytms-video-menu-action small { display: block; white-space: normal; max-width: 240px; font-size: 12px; line-height: 16px; margin-top: 3px; }
      .ytms-video-menu-action[hidden] { display: none !important; }
      [data-ytms-video-menu="1"]:focus { outline: none; }
      /* Native mouseover classes can outlive row movement; retain real hover and keyboard focus. */
      [data-ytms-video-menu="1"] .ytListItemViewModelHovered:not(:hover):not(:focus-within) { background-color: transparent !important; }
    `;
    (document.head || document.documentElement).append(style);
  }

  function customAction(id, label, path) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ytms-video-menu-action';
    button.dataset.ytmsMenuAction = id;
    button.setAttribute('role', 'menuitem');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const shape = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    shape.setAttribute('d', path);
    svg.append(shape);
    const text = document.createElement('span');
    text.textContent = label;
    button.append(svg, text);
    return button;
  }

  function focusable(row) {
    // Current sheets can put tabindex on a presentation wrapper as well as on
    // their real button. Focus the action, not its non-activating wrapper.
    const actions = 'button, a[href], [role="menuitem"]';
    const candidates = [...(row.matches(actions) ? [row] : []), ...row.querySelectorAll(actions),
      ...(row.hasAttribute('tabindex') ? [row] : []), ...row.querySelectorAll('[tabindex]')];
    return candidates.find(element => element.getAttribute('role') !== 'presentation' &&
      !element.matches(':disabled, [disabled]') && !element.closest('[inert]') &&
      (element.matches('button, a[href]') || element.hasAttribute('tabindex')) && visiblePopup(element)) || null;
  }

  function navigableRows(current) {
    return [...current.parent.children].filter(row => row === current.back ? current.tools :
      row === current.group ? !current.group.hidden :
        current.entries.some(entry => entry.row === row && entry.enabled && (current.tools ? entry.grouped : !entry.grouped)))
      .map(row => ({ row, target: focusable(row) })).filter(entry => entry.target);
  }

  function focusTarget(current, target) {
    if (!target || active !== current || current.redirectingFocus) return;
    current.redirectingFocus = true;
    try { if (document.activeElement !== target) target.focus({ preventScroll: true }); }
    finally { current.redirectingFocus = false; }
  }

  function focusPage(current) {
    const target = current.keyboard ? (current.tools ? current.back : current.group) : current.popup;
    focusTarget(current, target === current.popup ? target : focusable(target));
  }

  function focused(event) {
    const current = active;
    if (!current || current.redirectingFocus || !current.popup.contains(event.target) || event.target === current.popup) return;
    // A late native autofocus can otherwise light up the original Add to queue
    // after Play next was inserted above it. Keep neutral container focus for
    // pointer input; the native :hover styling and action handlers stay intact.
    if (current.keyboard && current.interacted) return;
    if (event.target.matches('input, textarea, select, [contenteditable]')) return;
    // Finish native focus handlers first, including their focus/blur classes.
    // No timer, frame loop or page-wide mutation observer is needed.
    if (current.focusQueued) return;
    current.focusQueued = true;
    queueMicrotask(() => {
      current.focusQueued = false;
      if (active !== current || !current.popup.contains(document.activeElement)) return;
      if (!current.keyboard) focusTarget(current, current.popup);
      else if (!current.interacted) focusTarget(current, navigableRows(current)[0]?.target);
    });
  }

  function pointer(event) {
    const current = active;
    if (!current || !event.isTrusted || !current.popup.contains(event.target)) return;
    current.interacted = true;
    if (current.keyboard) {
      current.keyboard = false;
      focusTarget(current, current.popup);
    }
  }

  function refit() {
    const current = active;
    if (!current) return;
    const resize = () => {
      if (active !== current || !visiblePopup(current.popup)) return;
      try { controller(current.popup.closest('tp-yt-iron-dropdown'))?.refit?.(); } catch { /* A dismissed popup may no longer have a native controller. */ }
    };
    resize();
    if (refitFrame) cancelAnimationFrame(refitFrame);
    // Legacy popup rows settle after their first native measurement. One
    // coalesced frame avoids retaining the submenu's stale size constraints.
    refitFrame = requestAnimationFrame(() => {
      refitFrame = 0;
      resize();
      // Legacy menus briefly hide their native rows while reopening/refitting.
      // Recheck initial keyboard focus once they settle, without moving focus
      // after the user has navigated, switched input or left the popup.
      if (active === current && current.keyboard && !current.interacted && current.popup.contains(document.activeElement)) {
        focusTarget(current, navigableRows(current)[0]?.target);
      }
    });
  }

  function restoreRow(row, saved) {
    if (saved.value) row.style.setProperty('display', saved.value, saved.priority);
    else row.style.removeProperty('display');
  }

  function setPage(tools, focus = true) {
    const current = active;
    if (!current || !current.popup.isConnected) return;
    current.tools = tools;
    for (const entry of current.entries) {
      const show = entry.enabled && (tools ? entry.grouped : !entry.grouped);
      if (show) restoreRow(entry.row, entry.display);
      else entry.row.style.setProperty('display', 'none', 'important');
    }
    current.back.hidden = !tools;
    current.group.hidden = tools || !current.entries.some(entry => entry.enabled && entry.grouped);
    current.group.setAttribute('aria-expanded', String(tools));
    refit();
    if (focus) focusPage(current);
  }

  function reset() {
    if (waiting) {
      waiting.observer.disconnect();
      clearTimeout(waiting.timer);
      waiting = null;
      compatibility('not-checked');
    }
    if (firstFrame) cancelAnimationFrame(firstFrame);
    if (secondFrame) cancelAnimationFrame(secondFrame);
    if (refitFrame) cancelAnimationFrame(refitFrame);
    refitFrame = 0;
    firstFrame = secondFrame = 0;
    if (!active) return;
    const current = active;
    active = null;
    if (current.ownsTabIndex && current.popup.getAttribute('tabindex') === '-1') current.popup.removeAttribute('tabindex');
    current.back.remove();
    current.group.remove();
    current.age?.remove();
    for (const entry of current.entries) {
      if (!entry.custom) restoreRow(entry.row, entry.display);
    }
    // Only restore a still-owned, fully stamped list. Do not resurrect detached native rows.
    if (current.original.every(row => row.parentElement === current.parent)) {
      current.parent.append(...current.original);
    }
    if (current.popup.getAttribute('data-ytms-video-menu') === '1') current.popup.removeAttribute('data-ytms-video-menu');
  }

  function decorate(popup, selection) {
    if (disposed || trigger !== selection || !selection.card.isConnected || !popup.isConnected ||
        performance.now() - selection.time > 5000 || videoIdFromCard(selection.card) !== selection.videoId) return diagnostic('stale-target');
    const sheet = popup.matches('yt-sheet-view-model');
    let data;
    try { data = sheet ? popup.componentProps?.data?.() : controller(popup)?.data; } catch { return diagnostic('unavailable-model'); }
    const items = sheet ? data?.content?.listViewModel?.listItems : data?.items;
    if (!Array.isArray(items) || !items.length || items.length > 60) return diagnostic('unsupported-model');
    const queueIds = items.map(queuedVideoId).filter(Boolean);
    if (!queueIds.length && !matchesNativeMenu(items, selection)) return diagnostic('no-queue-action');
    if (queueIds.length && !queueIds.includes(selection.videoId)) return diagnostic('queue-target-mismatch');
    // Native Download is an outer action host containing its own list-item row.
    // Keep that original host and handler intact; do not count or move its child.
    const rows = [...popup.querySelectorAll(rowSelector)].filter(row => {
      const downloadHost = row.closest('yt-download-list-item-view-model');
      return !downloadHost || row === downloadHost;
    });
    if (rows.length !== items.length) return diagnostic('row-count');
    if (rows.some(row => row.parentElement !== rows[0].parentElement)) return diagnostic('row-parent');
    const parent = rows[0].parentElement;
    if (sheet && rows.some((row, index) => items[index]?.downloadListItemViewModel
      ? !row.matches('yt-download-list-item-view-model')
      : !items[index]?.listItemViewModel || !row.matches('yt-list-item-view-model'))) return diagnostic('row-binding');
    if (rows.some(row => !popup.contains(row)) || rows.some((row, index) => {
      if (sheet) return false;
      const model = items[index].menuServiceItemRenderer || items[index].menuNavigationItemRenderer || items[index].menuServiceItemDownloadRenderer;
      return !model || typeof model !== 'object' || controller(row)?.data !== model;
    })) return diagnostic('row-binding');
    const ids = items.map(item => identify(item, selection));
    // Ambiguous duplicate recognised actions and mismatched native lists remain untouched.
    if (ids.some((id, index) => id && ids.indexOf(id) !== index)) return diagnostic('duplicate-actions');
    let channel = null;
    try { channel = suite.channelAge?.channelFromCard(selection.card) || null; } catch { /* A missing stable ID leaves manual settings available. */ }
    ensureStyle();
    const grouped = preferences.menuGroupChannelTools !== false;
    const isEnabled = id => id === 'download' ? preferences.menuShowDownload === true :
      id === 'notInterested' ? preferences.menuShowNotInterested !== false :
      id === 'dontRecommend' ? preferences.menuShowDontRecommend !== false :
      id === 'report' ? preferences.menuShowReport !== false : true;
    const entries = rows.map((row, index) => ({ row, id: ids[index], enabled: isEnabled(ids[index]),
      grouped: grouped && ['dontRecommend', 'report'].includes(ids[index]),
      display: { value: row.style.getPropertyValue('display'), priority: row.style.getPropertyPriority('display') } }));
    let age = null;
    if (preferences.menuShowAgeLimit !== false) {
      age = customAction('channelAge', 'Filter channel uploads…', 'M7 2v2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2V2h-2v2H9V2H7zm12 8v10H5V10h14zM5 6h14v2H5V6zm6 6v5h5v-2h-3v-3h-2z');
      if (!channel?.channelId) {
        age.setAttribute('aria-disabled', 'true');
        const note = document.createElement('small');
        note.textContent = 'Channel ID unavailable; add it manually in Channels settings.';
        age.lastElementChild.append(note);
      }
      entries.push({ row: age, id: 'channelAge', enabled: true, grouped, custom: true, display: { value: '', priority: '' } });
    }
    const group = customAction('channelTools', 'Channel tools', 'M9 5l7 7-7 7-1.4-1.4 5.6-5.6-5.6-5.6L9 5z');
    group.setAttribute('aria-haspopup', 'menu');
    const back = customAction('back', 'Back', 'M15 5l-7 7 7 7 1.4-1.4-5.6-5.6 5.6-5.6L15 5z');
    // Keep unknown rows in their original slots; reorder only recognised action slots.
    const sorted = entries.filter(entry => entry.id).sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    let index = 0;
    const arranged = entries.map(entry => entry.id ? sorted[index++] : entry);
    const groupRank = order.indexOf('channelTools');
    const beforeGroup = arranged.findIndex(entry => entry.id && order.indexOf(entry.id) > groupRank);
    const nodes = arranged.map(entry => entry.row);
    nodes.splice(beforeGroup < 0 ? nodes.length : beforeGroup, 0, group);
    active = { popup, parent, original: rows, entries, age, group, back, channel, card: selection.card, videoId: selection.videoId,
      trigger: selection.button, tools: false, keyboard: selection.keyboard, interacted: false, redirectingFocus: false,
      ownsTabIndex: !popup.hasAttribute('tabindex') };
    if (active.ownsTabIndex) popup.setAttribute('tabindex', '-1');
    parent.append(back, ...nodes);
    popup.setAttribute('data-ytms-video-menu', '1');
    setPage(false, false);
    const focusedElement = document.activeElement;
    if (focusedElement === selection.button || focusedElement === document.body || popup.contains(focusedElement)) {
      focusTarget(active, selection.keyboard ? navigableRows(active)[0]?.target || popup : popup);
    }
    diagnostic('ready');
    return true;
  }

  function visiblePopup(popup) {
    if (!popup.isConnected || !popup.getClientRects().length) return false;
    for (let element = popup; element; element = element.parentElement) {
      if (element.hidden || element.getAttribute('aria-hidden') === 'true') return false;
      const css = getComputedStyle(element);
      if (css.display === 'none' || ['hidden', 'collapse'].includes(css.visibility)) return false;
    }
    return true;
  }

  function matchesSelection(popup, selection) {
    try {
      const data = popup.matches('yt-sheet-view-model') ? popup.componentProps?.data?.() : controller(popup)?.data;
      const items = popup.matches('yt-sheet-view-model') ? data?.content?.listViewModel?.listItems : data?.items;
      if (!Array.isArray(items) || items.length > 60) return false;
      const queueIds = items.map(queuedVideoId).filter(Boolean);
      return queueIds.length ? queueIds.includes(selection.videoId) : matchesNativeMenu(items, selection);
    } catch { return false; }
  }

  function startDiscovery(selection, eventPopup = null) {
    reset();
    const containers = [...document.querySelectorAll('ytd-popup-container')];
    const existing = eventPopup ? [eventPopup] : [...document.querySelectorAll(popupSelector)];
    const roots = containers.length ? containers : [...new Set(existing.map(popup => popup.closest('tp-yt-iron-dropdown') || popup))];
    diagnostic('waiting-for-menu');
    let request;
    function attempt() {
      secondFrame = 0;
      if (waiting !== request || trigger !== selection) return;
      try {
        const visible = [...document.querySelectorAll(popupSelector)].filter(popup =>
          roots.some(root => root === popup || root.contains(popup)) && visiblePopup(popup));
        if (visible.length) request.sawPopup = true;
        const matching = visible.filter(popup => matchesSelection(popup, selection));
        if (matching.length > 1 || (visible.length > 1 && matching.length !== 1)) {
          diagnostic('ambiguous-popup'); return;
        }
        const popup = matching[0] || (visible.length === 1 ? visible[0] : null);
        if (!popup) { diagnostic('waiting-for-visible-popup'); return; }
        // A visible old menu for another video is not owned by this request.
        request.popup = matching.length === 1 ? popup : null;
        if (decorate(popup, selection) && waiting === request) {
          request.observer.disconnect();
          clearTimeout(request.timer);
          waiting = null;
        }
      } catch { reset(); compatibility('unsupported'); }
    }
    // YouTube reuses cached sheets without another yt-popup-opened event. Watch
    // only known popup containers after this trusted activation, never the page.
    const observer = new MutationObserver(() => {
      if (waiting === request && !firstFrame && !secondFrame) secondFrame = requestAnimationFrame(attempt);
    });
    for (const root of roots) observer.observe(root, { childList: true, subtree: true,
      attributes: true, attributeFilter: ['hidden', 'style', 'aria-hidden', 'opened'] });
    request = { popup: eventPopup && matchesSelection(eventPopup, selection) ? eventPopup : null, roots, observer, sawPopup: false, timer: setTimeout(() => {
      if (waiting === request) {
        observer.disconnect(); waiting = null;
        if (trigger === selection) { trigger = null; triggerReason = 'expired-trigger'; }
        if (firstFrame) cancelAnimationFrame(firstFrame);
        if (secondFrame) cancelAnimationFrame(secondFrame);
        firstFrame = secondFrame = 0;
        compatibility(request.sawPopup ? 'unsupported' : 'no-menu');
      }
    }, 1500) };
    waiting = request;
    // Play next first rebinds the native model; the second frame sees its stamped rows.
    firstFrame = requestAnimationFrame(() => {
      firstFrame = 0;
      secondFrame = requestAnimationFrame(attempt);
    });
  }

  function opened(event) {
    const popup = event.target;
    if (!popup?.matches?.(popupSelector)) return;
    if (!trigger) { diagnostic(triggerReason); return; }
    startDiscovery(trigger, popup);
  }

  function activate(event) {
    const current = active;
    if (!current) return;
    if (!current.popup.contains(event.target)) {
      // Automatic theatre-mode and other native helpers use synthetic clicks.
      // They must not cancel a menu that the user has just opened.
      if (event.isTrusted) { reset(); trigger = null; triggerReason = 'missing-trigger'; }
      return;
    }
    const action = event.target.closest?.('[data-ytms-menu-action]')?.dataset.ytmsMenuAction;
    if (!action) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!event.isTrusted) return;
    current.keyboard = event.detail === 0;
    current.interacted = true;
    if (action === 'channelTools') setPage(true);
    else if (action === 'back') setPage(false);
    else if (action === 'channelAge' && current.channel?.channelId) {
      let channel;
      try { channel = suite.channelAge?.channelFromCard(current.card); } catch { return; }
      if (!current.card.isConnected || videoIdFromCard(current.card) !== current.videoId || channel?.channelId !== current.channel.channelId) return;
      try { current.popup.closest('tp-yt-iron-dropdown')?.close?.(); } catch { /* Settings can still open if the native dropdown has already closed. */ }
      reset(); trigger = null; triggerReason = 'missing-trigger';
      suite.openChannelAgeSettings?.(channel);
    }
  }

  function keyboard(event) {
    const current = active;
    if (!current || !current.popup.contains(event.target) || !event.isTrusted) return;
    current.keyboard = true;
    current.interacted = true;
    if ((event.key === 'ArrowRight' && event.target.closest?.('[data-ytms-menu-action="channelTools"]')) ||
        ((event.key === 'ArrowLeft' || event.key === 'Escape') && current.tools)) {
      event.preventDefault(); event.stopImmediatePropagation();
      setPage(!current.tools); return;
    }
    if (event.key === 'Escape') { reset(); trigger = null; triggerReason = 'missing-trigger'; return; }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' '].includes(event.key)) return;
    const rows = navigableRows(current);
    if (!rows.length) return;
    const focused = rows.findIndex(({ row }) => row === event.target || row.contains(event.target));
    if (event.key === 'Enter' || event.key === ' ') {
      if (focused < 0) {
        // A neutral pointer-open menu has no selected action. The first key
        // selects a visible action; it must not execute a stale native default.
        event.preventDefault(); event.stopImmediatePropagation();
        focusTarget(current, rows[0].target);
      }
      return;
    }
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 :
      focused < 0 ? (event.key === 'ArrowDown' ? 0 : rows.length - 1) :
        (focused + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length;
    event.preventDefault(); event.stopImmediatePropagation();
    focusTarget(current, rows[next].target);
  }

  function closed(event) {
    const popup = active?.popup || waiting?.popup;
    if ((popup && (event.target === popup || event.target?.contains?.(popup))) ||
        (!active && waiting?.roots.some(root => root === event.target))) {
      reset(); trigger = null; triggerReason = 'missing-trigger';
    }
  }

  function navigated() { reset(); trigger = null; triggerReason = 'missing-trigger'; compatibility('not-checked'); }
  document.addEventListener('click', captureTrigger, true);
  document.addEventListener('keydown', captureTrigger, true);
  document.addEventListener('click', activate, true);
  document.addEventListener('keydown', keyboard, true);
  document.addEventListener('focusin', focused, true);
  document.addEventListener('pointerdown', pointer, true);
  document.addEventListener('pointermove', pointer, { capture: true, passive: true });
  window.addEventListener('yt-popup-opened', opened, true);
  const closeEvents = ['yt-popup-closed', 'iron-overlay-closed'];
  closeEvents.forEach(type => window.addEventListener(type, closed, true));
  const resetEvents = ['yt-navigate-start', 'pagehide'];
  resetEvents.forEach(type => window.addEventListener(type, navigated, true));
  diagnostic('idle');
  return function disposeVideoMenu() {
    disposed = true;
    navigated();
    style?.remove(); style = null;
    document.removeEventListener('click', captureTrigger, true);
    document.removeEventListener('keydown', captureTrigger, true);
    document.removeEventListener('click', activate, true);
    document.removeEventListener('keydown', keyboard, true);
    document.removeEventListener('focusin', focused, true);
    document.removeEventListener('pointerdown', pointer, true);
    document.removeEventListener('pointermove', pointer, true);
    window.removeEventListener('yt-popup-opened', opened, true);
    closeEvents.forEach(type => window.removeEventListener(type, closed, true));
    resetEvents.forEach(type => window.removeEventListener(type, navigated, true));
    diagnostic('disposed');
  };
},
    settingsAssets: {"css":"\n#ytms-settings-dialog, #ytms-settings-button, #ytms-age-dialog {\n      color-scheme: dark;\n      --page: #0f0f0f; --surface: #212121; --hover: #383838; --text: #f1f1f1;\n      --muted: #aaa; --line: #3f3f3f; --accent: #ff0033; --accent-text: #fff; --button-accent: #c00; --link: #ff6b6b;\n      --error: #ff9a9a; --field: #181818;\n    }\n:root:not([dark]) #ytms-settings-dialog, :root:not([dark]) #ytms-settings-button, :root:not([dark]) #ytms-age-dialog {\n      color-scheme: light;\n      --page: #fff; --surface: #fff; --hover: #eee; --text: #0f0f0f;\n      --muted: #606060; --line: #d5d5d5; --accent: #c00; --accent-text: #fff; --link: #c00;\n      --error: #b3261e; --field: #fafafa;\n    }\n#ytms-settings-dialog * { box-sizing: border-box; }\n#ytms-settings-dialog [hidden] { display: none !important; }\n#ytms-settings-dialog button,\n#ytms-settings-dialog input,\n#ytms-settings-dialog select { font: inherit; }\n#ytms-settings-dialog button { border: 0; color: inherit; background: transparent; cursor: pointer; }\n#ytms-settings-dialog button:disabled { opacity: .5; cursor: default; }\n#ytms-settings-dialog button:focus-visible,\n#ytms-settings-dialog input:focus-visible,\n#ytms-settings-dialog select:focus-visible,\n#ytms-settings-dialog summary:focus-visible {\n      outline: 2px solid var(--accent); outline-offset: 3px;\n    }\n#ytms-settings-dialog .icon-button { display: grid; place-items: center; width: 40px; height: 40px; border-radius: 50%; flex: 0 0 auto; }\n#ytms-settings-dialog .icon-button:hover { background: var(--hover); }\n#ytms-settings-dialog .icon-button svg,\n#ytms-settings-dialog .icon-button img { width: 24px; height: 24px; }\n#ytms-settings-dialog .icon-button img { display: block; pointer-events: none; }\n#ytms-settings-dialog .text-button { padding: 8px 14px; border-radius: 20px; font-weight: 600; white-space: nowrap; }\n#ytms-settings-dialog .text-button:hover { background: var(--hover); }\n#ytms-settings-dialog .primary { background: var(--button-accent); color: var(--accent-text); }\n#ytms-settings-dialog .primary:hover:not(:disabled) { filter: brightness(.92); background: var(--button-accent); }\n#ytms-settings-dialog .outlined-button, #ytms-settings-dialog .danger-button { border: 1px solid var(--line); background: var(--field); }\n#ytms-settings-dialog .danger-button { border-color: var(--error); color: var(--error); }\n#ytms-settings-dialog .primary:disabled { background: var(--line); color: var(--muted); opacity: 1; }\n#ytms-settings-dialog {\n      box-sizing: border-box; width: min(760px, calc(100vw - 24px)); height: min(720px, calc(100dvh - 24px)); max-height: calc(100dvh - 24px);\n      padding: 0; border: 1px solid var(--line); border-radius: 12px;\n      color: var(--text); background: var(--surface); box-shadow: 0 12px 48px #0008;\n    }\n#ytms-settings-dialog::backdrop { background: #0008; }\n#ytms-settings-dialog .panel { display: flex; flex-direction: column; height: 100%; min-height: 0; }\n#ytms-settings-dialog .panel-header { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px 4px 24px; flex-shrink: 0; }\n#ytms-settings-dialog .panel-header h2 { font-size: 20px; font-weight: 600; margin: 0; }\n#ytms-settings-dialog .panel-header .close { font-size: 28px; font-weight: 400; line-height: 1; }\n#ytms-settings-dialog nav { display: flex; gap: 4px; overflow-x: auto; padding: 0 20px; border-bottom: 1px solid var(--line); flex-shrink: 0; }\n#ytms-settings-dialog nav button { padding: 10px 3px; white-space: nowrap; color: var(--muted); border-bottom: 2px solid transparent; }\n#ytms-settings-dialog nav button[aria-selected=\"true\"] { color: var(--text); border-color: var(--accent); }\n#ytms-settings-dialog .content { padding: 4px 24px 18px; overflow: auto; scrollbar-gutter: stable; min-height: 0; flex: 1; }\n#ytms-settings-dialog .row { display: flex; gap: 24px; justify-content: space-between; align-items: center; padding: 14px 0; border-bottom: 1px solid var(--line); }\n#ytms-settings-dialog .row > label { flex: 1; }\n#ytms-settings-dialog .row > .row-label { flex: 1; min-width: 0; }\n#ytms-settings-dialog .description { display: block; color: var(--muted); font-size: 12px; margin-top: 3px; }\n#ytms-settings-dialog .switch {\n      appearance: none; width: 36px; height: 20px; border-radius: 12px; position: relative;\n      margin: 0 2px; background: #717171; cursor: pointer; flex: 0 0 auto;\n    }\n#ytms-settings-dialog .switch::after { content: \"\"; position: absolute; width: 16px; height: 16px; border-radius: 50%; top: 2px; left: 2px; background: white; }\n#ytms-settings-dialog .switch:checked { background: var(--accent); }\n#ytms-settings-dialog .switch:checked::after { left: 18px; }\n#ytms-settings-dialog select,\n#ytms-settings-dialog .hex { background: var(--field); color: var(--text); border: 1px solid var(--line); border-radius: 6px; padding: 7px 9px; max-width: 190px; }\n#ytms-settings-dialog .hex { width: 108px; font-family: ui-monospace, monospace; text-transform: uppercase; }\n#ytms-settings-dialog .hex[aria-invalid=\"true\"] { border-color: var(--error); }\n#ytms-settings-dialog .colour-rows { padding-top: 8px; }\n#ytms-settings-dialog .colour-row { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin: 12px 0; }\n#ytms-settings-dialog .colour-row label { flex: 1; min-width: 145px; }\n#ytms-settings-dialog .swatch { width: 36px; height: 32px; border: 1px solid var(--line); border-radius: 6px; background: var(--swatch); }\n#ytms-settings-dialog .swatch:hover { outline: 2px solid var(--accent); outline-offset: 2px; }\n#ytms-settings-dialog .field-error { color: var(--error); font-size: 12px; width: 100%; margin: 0; }\n#ytms-settings-dialog .picker { background: var(--field); border: 1px solid var(--line); border-radius: 8px; padding: 14px; margin: 12px 0; }\n#ytms-settings-dialog .picker-heading { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }\n#ytms-settings-dialog .picker h3 { margin: 0; font-size: 14px; font-weight: 500; }\n#ytms-settings-dialog .channel { display: grid; grid-template-columns: 42px 1fr 36px; gap: 12px; align-items: center; margin: 10px 0; }\n#ytms-settings-dialog .channel output { text-align: right; font-size: 12px; font-variant-numeric: tabular-nums; }\n#ytms-settings-dialog input[type=\"range\"] { appearance: none; width: 100%; height: 6px; border-radius: 4px; margin: 8px 0; cursor: pointer; }\n#ytms-settings-dialog input[type=\"range\"]::-moz-range-thumb { width: 14px; height: 14px; background: #fff; border: 1px solid #666; border-radius: 50%; }\n#ytms-settings-dialog input[type=\"range\"]::-webkit-slider-thumb { appearance: none; width: 14px; height: 14px; background: #fff; border: 1px solid #666; border-radius: 50%; }\n#ytms-settings-dialog .preview { background: var(--page); border: 1px solid var(--line); border-radius: 8px; padding: 14px; margin-top: 16px; }\n#ytms-settings-dialog .preview p { margin: 4px 0 12px; }\n#ytms-settings-dialog .preview p:last-child { margin-bottom: 0; }\n#ytms-settings-dialog .preview .name { font-weight: 700; }\n#ytms-settings-dialog .preview time { color: var(--muted); margin-left: 10px; font-size: 12px; }\n#ytms-settings-dialog .preview .pin { color: var(--owner-colour, var(--muted)); font-size: 12px; margin-bottom: 6px; }\n#ytms-settings-dialog .preview .owner { color: var(--owner-colour, var(--text)); }\n#ytms-settings-dialog .preview .viewer { color: var(--viewer-colour, var(--text)); }\n#ytms-settings-dialog .preview[data-mode=\"off\"] .name { font-weight: 500; }\n#ytms-settings-dialog .warning { color: var(--error); font-size: 12px; margin: 10px 0 0; }\n#ytms-settings-dialog .section-note { font-size: 12px; color: var(--muted); margin: 16px 0 0; }\n#ytms-settings-dialog .support-tools > section { padding: 16px 0; border-bottom: 1px solid var(--line); }\n#ytms-settings-dialog .support-tools h3 { margin: 0; font-size: 16px; }\n#ytms-settings-dialog .support-tools h4 { margin: 0 0 8px; font-size: 14px; }\n#ytms-settings-dialog .support-tools .section-note { margin-top: 8px; }\n#ytms-settings-dialog .support-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }\n#ytms-settings-dialog .support-file-field { display: flex; flex-direction: column; gap: 8px; margin-top: 18px; }\n#ytms-settings-dialog .support-file-field input { min-width: 0; max-width: 100%; }\n#ytms-settings-dialog .support-file-field input::file-selector-button { font: inherit; color: var(--text); background: var(--field); border: 1px solid var(--line); border-radius: 20px; padding: 8px 14px; cursor: pointer; margin-right: 8px; }\n#ytms-settings-dialog .support-preview { padding: 14px; margin-top: 16px; border: 1px solid var(--line); border-radius: 8px; overflow-wrap: anywhere; }\n#ytms-settings-dialog .support-preview p { margin: 8px 0; font-size: 12px; }\n#ytms-settings-dialog .support-preview summary { cursor: pointer; }\n#ytms-settings-dialog .support-preview ul { padding-left: 20px; font-size: 12px; }\n#ytms-settings-dialog .support-confirm { display: flex; align-items: flex-start; gap: 8px; margin-top: 14px; }\n#ytms-settings-dialog .support-confirm input { accent-color: var(--accent); flex: 0 0 auto; margin-top: 4px; }\n#ytms-settings-dialog #ytms-support-report { display: block; width: 100%; min-height: 120px; margin-top: 12px; padding: 10px; border: 1px solid var(--line); border-radius: 6px; color: var(--text); background: var(--field); font: 12px/1.5 ui-monospace, monospace; resize: vertical; }\n#ytms-settings-dialog textarea:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }\n#ytms-settings-dialog .support-tools .support-error { color: var(--error); }\n#ytms-settings-dialog footer { border-top: 1px solid var(--line); padding: 12px 16px; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; flex-shrink: 0; }\n#ytms-settings-dialog footer .spacer { flex: 1; }\n#ytms-settings-dialog .footer-actions { display: flex; align-items: center; gap: 8px; min-width: 0; max-width: 100%; margin-left: auto; }\n#ytms-settings-dialog .footer-actions > button { flex: 0 0 auto; }\n#ytms-settings-dialog #ytms-settings-status { flex: 0 1 176px; max-width: 176px; min-width: 0; color: var(--muted); font-size: 12px; margin: 0; overflow-wrap: anywhere; }\n@media (max-width: 480px) {\n#ytms-settings-dialog .row { gap: 10px; }\n#ytms-settings-dialog nav,\n#ytms-settings-dialog .content { padding-left: 16px; padding-right: 16px; }\n#ytms-settings-dialog footer .spacer { display: none; }\n#ytms-settings-dialog footer .text-button { padding: 8px 10px; }\n#ytms-settings-dialog select { max-width: 145px; }\n    }\n#ytms-settings-dialog { font: 14px/1.5 Roboto, Arial, sans-serif; margin: auto; }\n#ytms-settings-dialog button { line-height: 1.5; }\n#ytms-settings-button { display: inline-grid; place-items: center; flex: 0 0 40px; width: 40px; height: 40px; padding: 0; margin: 0 8px 0 0; border: 0; border-radius: 50%; background: transparent; cursor: pointer; }\n#ytms-settings-button:hover { background: var(--hover); }\n#ytms-settings-button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }\n#ytms-settings-button img { display: block; width: 32px; height: 32px; pointer-events: none; }\n:root:not([dark]) #ytms-settings-button[data-icon=\"monochrome\"] img { filter: brightness(0); }\n#ytms-settings-dialog .credits { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 24px 0; text-align: center; }\n#ytms-settings-dialog .credits img { width: 96px; height: 96px; }\n#ytms-settings-dialog .credits h3 { margin: 0; font-size: 20px; font-weight: 600; }\n#ytms-settings-dialog .credits p { margin: 0; color: var(--muted); }\n#ytms-settings-dialog .credits a { color: var(--link); text-decoration: none; border-radius: 4px; padding: 6px 8px; }\n#ytms-settings-dialog .credits a:hover { text-decoration: underline; }\n#ytms-settings-dialog .credits a:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }\n#ytms-section-extensions > h3 { font-size: 16px; font-weight: 600; margin: 14px 0 0; }\n#ytms-section-extensions > .section-note { margin-top: 6px; }\n#ytms-settings-dialog .extension-card { display: flex; gap: 16px; padding: 18px 0; border-bottom: 1px solid var(--line); }\n#ytms-settings-dialog .extension-card > img { display: block; width: 40px; height: 40px; object-fit: contain; flex: 0 0 40px; }\n#ytms-settings-dialog .extension-details { min-width: 0; flex: 1; }\n#ytms-settings-dialog .extension-details h4 { font-size: 14px; font-weight: 600; margin: 0 0 4px; }\n#ytms-settings-dialog .extension-details p { margin: 0 0 6px; overflow-wrap: anywhere; }\n#ytms-settings-dialog .extension-details .extension-note { font-size: 12px; color: var(--muted); }\n#ytms-settings-dialog .extension-link { display: inline-block; color: var(--link); text-decoration: none; border-radius: 4px; }\n#ytms-settings-dialog .extension-link:hover { text-decoration: underline; }\n#ytms-settings-dialog .extension-link:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }\n#ytms-player-settings-button.ytp-button { display: inline-flex !important; align-items: center !important; justify-content: center !important; padding: 0 !important; margin: 0 !important; line-height: 0 !important; }\n#ytms-player-settings-button img { box-sizing: border-box !important; display: block !important; width: 36px !important; height: 36px !important; min-width: 36px !important; min-height: 36px !important; max-width: 36px !important; max-height: 36px !important; padding: 4px !important; pointer-events: none !important; }\n#ytms-player-settings-button:focus-visible { outline: 2px solid white; outline-offset: -2px; }\n#ytms-player-settings-tooltip { position: absolute !important; z-index: 1000 !important; display: flex !important; align-items: center !important; box-sizing: border-box !important; max-width: calc(100% - 16px) !important; padding: 5px 9px !important; border-radius: 2px !important; background: rgba(0, 0, 0, 0.9) !important; color: #eee !important; font: 500 12px/1.2 Roboto, Arial, sans-serif !important; text-shadow: none !important; pointer-events: none !important; }\n\n#ytms-settings-dialog .menu-order { margin-top: 20px; }\n#ytms-settings-dialog #ytms-video-menu-settings { margin: 20px 0 0; border: 1px solid var(--line); border-radius: 8px; padding: 0 12px; }\n#ytms-settings-dialog #ytms-video-menu-settings > summary { cursor: pointer; font-size: 16px; font-weight: 600; padding: 12px 0; }\n#ytms-settings-dialog #ytms-video-menu-settings > .menu-order { margin-bottom: 16px; }\n#ytms-settings-dialog .channel-filter-card { padding: 16px 0; border-bottom: 1px solid var(--line); }\n#ytms-settings-dialog .channel-filter-card h3 { font-size: 14px; font-weight: 600; margin: 0 0 6px; overflow-wrap: anywhere; }\n#ytms-settings-dialog .channel-filter-card p { margin: 4px 0; font-size: 12px; overflow-wrap: anywhere; }\n#ytms-settings-dialog .channel-filter-id { font-family: ui-monospace, monospace; color: var(--muted); }\n#ytms-settings-dialog .channel-filter-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }\n#ytms-settings-dialog .channel-filter-help { display: inline-block; margin: 8px 0; font-size: 12px; color: var(--link); text-decoration: none; overflow-wrap: anywhere; }\n#ytms-settings-dialog .channel-filter-help:hover { text-decoration: underline; }\n#ytms-settings-dialog .channel-filter-help:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }\n#ytms-settings-dialog .menu-order h3 { font-size: 16px; margin: 0; }\n#ytms-settings-dialog .menu-order .section-note { margin: 6px 0 12px; }\n#ytms-settings-dialog #ytms-menu-order { padding: 0; margin: 0; list-style: none; }\n#ytms-settings-dialog #ytms-menu-order li { display: flex; gap: 8px; align-items: center; padding: 6px 0; border-bottom: 1px solid var(--line); }\n#ytms-settings-dialog #ytms-menu-order li > span { flex: 1; min-width: 0; overflow-wrap: anywhere; }\n#ytms-settings-dialog .menu-order-move { width: 32px; height: 32px; padding: 0; border-radius: 50%; font-size: 18px; flex: 0 0 auto; }\n#ytms-settings-dialog .menu-order-move:hover:not(:disabled) { background: var(--hover); }\n#ytms-age-dialog { box-sizing: border-box; width: min(640px, calc(100vw - 24px)); height: min(720px, calc(100dvh - 24px)); max-height: calc(100dvh - 24px); margin: auto; padding: 0; border: 1px solid var(--line); border-radius: 12px; background: var(--surface); color: var(--text); box-shadow: 0 12px 48px #0008; font: 14px/1.5 Roboto, Arial, sans-serif; }\n#ytms-age-dialog::backdrop { background: #0008; }\n#ytms-age-dialog * { box-sizing: border-box; }\n#ytms-age-dialog [hidden] { display: none !important; }\n#ytms-age-dialog .ytms-age-panel { display: flex; flex-direction: column; height: 100%; min-height: 0; }\n#ytms-age-dialog header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 16px 4px 24px; flex-shrink: 0; }\n#ytms-age-dialog h2 { font-size: 20px; font-weight: 600; margin: 0; }\n#ytms-age-dialog button, #ytms-age-dialog input, #ytms-age-dialog select { font: inherit; }\n#ytms-age-dialog button { border: 0; background: transparent; color: inherit; cursor: pointer; }\n#ytms-age-dialog button:disabled { opacity: .5; cursor: default; }\n#ytms-age-dialog button:focus-visible, #ytms-age-dialog input:focus-visible, #ytms-age-dialog select:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }\n#ytms-age-dialog .ytms-age-close { flex: 0 0 40px; width: 40px; height: 40px; padding: 0; border-radius: 50%; font-size: 28px; line-height: 1; }\n#ytms-age-dialog .ytms-age-close:hover, #ytms-age-dialog .ytms-age-button:hover { background: var(--hover); }\n#ytms-age-dialog .ytms-age-content { min-height: 0; overflow: auto; flex: 1; padding: 0 24px 20px; scrollbar-gutter: stable; }\n#ytms-age-dialog .ytms-age-note { color: var(--muted); font-size: 12px; margin: 10px 0 14px; }\n#ytms-age-dialog .ytms-age-rule { display: flex; flex-direction: column; gap: 12px; padding: 16px 0; border-bottom: 1px solid var(--line); }\n#ytms-age-dialog .ytms-age-rule h3 { margin: 0; font-size: 14px; overflow-wrap: anywhere; }\n#ytms-age-dialog .ytms-age-summary p { margin: 4px 0; font-size: 12px; overflow-wrap: anywhere; }\n#ytms-age-dialog .ytms-age-channel-id { color: var(--muted); font-family: ui-monospace, monospace; }\n#ytms-age-dialog .ytms-age-fields { display: flex; flex-direction: column; gap: 12px; }\n#ytms-age-dialog #ytms-age-add { margin-top: 16px; }\n#ytms-age-dialog .ytms-age-field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }\n#ytms-age-dialog .ytms-age-field > span { color: var(--muted); font-size: 12px; }\n#ytms-age-dialog .ytms-age-field input, #ytms-age-dialog .ytms-age-field select { min-width: 0; width: 100%; background: var(--field); color: var(--text); border: 1px solid var(--line); border-radius: 6px; padding: 7px 9px; }\n#ytms-age-dialog .ytms-age-wide input { font-family: ui-monospace, monospace; font-size: 12px; }\n#ytms-age-dialog .ytms-age-limit { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 16px; }\n#ytms-age-dialog .ytms-age-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }\n#ytms-age-dialog .ytms-age-actions label { display: flex; gap: 6px; align-items: center; }\n#ytms-age-dialog .ytms-age-blocked { display: flex; gap: 6px; align-items: flex-start; font-size: 12px; }\n#ytms-age-dialog input[type=\"checkbox\"] { accent-color: var(--accent); }\n#ytms-age-dialog .ytms-age-button { padding: 8px 14px; border-radius: 20px; font-weight: 600; white-space: nowrap; }\n#ytms-age-dialog .ytms-age-outlined, #ytms-age-dialog .ytms-age-danger { border: 1px solid var(--line); background: var(--field); }\n#ytms-age-dialog .ytms-age-danger { border-color: var(--error); color: var(--error); }\n#ytms-age-dialog .ytms-age-primary, #ytms-age-dialog .ytms-age-primary:hover { background: var(--button-accent); color: var(--accent-text); }\n#ytms-age-dialog .ytms-age-primary:hover { filter: brightness(.92); }\n#ytms-age-dialog footer { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; border-top: 1px solid var(--line); padding: 12px 16px; flex-shrink: 0; }\n#ytms-age-dialog .ytms-age-status { width: 100%; margin: 0; font-size: 12px; color: var(--muted); overflow-wrap: anywhere; }\n#ytms-age-dialog .ytms-age-status.ytms-age-error { color: var(--error); }\n#ytms-age-dialog .ytms-age-spacer { flex: 1; }\n@media (max-width: 480px) {\n  #ytms-age-dialog header { padding-left: 16px; }\n  #ytms-age-dialog .ytms-age-content { padding-left: 16px; padding-right: 16px; }\n  #ytms-age-dialog h2 { font-size: 18px; }\n}\n\n","logo":"data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiPz4KPHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMDI0IiBoZWlnaHQ9IjEwMjQiIHZpZXdCb3g9IjAgMCAxMDI0IDEwMjQiIHJvbGU9ImltZyIgYXJpYS1sYWJlbGxlZGJ5PSJsb2dvLXRpdGxlIGxvZ28tZGVzY3JpcHRpb24iPgogIDx0aXRsZSBpZD0ibG9nby10aXRsZSI+WW91VHViZSBNYXN0ZXIgU3VpdGUgbG9nbzwvdGl0bGU+CiAgPGRlc2MgaWQ9ImxvZ28tZGVzY3JpcHRpb24iPkEgcmVkIGNvZyB3aXRoIGFuIG9mZi13aGl0ZSB2aWRlbyBwYW5lbCBhbmQgYSByZWQgcGxheSB0cmlhbmdsZS48L2Rlc2M+CiAgPCEtLSBPcmlnaW5hbCBjb2cgYW5kIHZpZGVvLXBhbmVsIGdlb21ldHJ5IGZyb20gU1ZHIFJlcG8uIC0tPgogIDxwYXRoIGlkPSJjb2ciIGZpbGw9IiNmNjAwMDIiIHRyYW5zZm9ybT0ibWF0cml4KDgzLjg0MjEzOCAwIDAgODMuODQyMTM4IC0xNTguNTI4MjExIC0xNTguNTI4MjExKSIgZD0iTTYuODIzMiwybC0yLjIxNjguOTE0NC41MTUyLDEuMjQ4OGE0Ljc0Mjg2LDQuNzQyODYsMCwwLDAtLjk0OTYuOTQ0OEwyLjkyNDgsNC41ODk2LDIuMDAzMiw2LjgwMjRsMS4yNDcyLjUxOTJhNC44Miw0LjgyLDAsMCwwLS4wMDI0LDEuMzRMMiw5LjE3NmwuOTEzNiwyLjIxNzYsMS4yNDg4LS41MTQ0YTQuODI0NDUsNC44MjQ0NSwwLDAsMCwuOTQ0OC45NDg4bC0uNTE4NCwxLjI0NzIsMi4yMTQ0LjkyMDguNTE4NC0xLjI0NjRhNC42Nzk1Miw0LjY3OTUyLDAsMCwwLC42NzQ0LjA0OCw0LjczOTcyLDQuNzM5NzIsMCwwLDAsLjY2NTYtLjA0NjRMOS4xNzYsMTRsMi4yMTc2LS45MTM2LS41MTQ0LTEuMjQ4OGE0LjgyODIyLDQuODI4MjIsMCwwLDAsLjk0OTYtLjk0NDhsMS4yNDU2LjUxODQuOTIxNi0yLjIxNDQtMS4yNDcyLS41MTg0YTQuNzI5ODQsNC43Mjk4NCwwLDAsMCwuMDAyNC0xLjM0TDE0LDYuODI0bC0uOTE0NC0yLjIxNzYtMS4yNDg4LjUxNDRhNC43Mzg5MSw0LjczODkxLDAsMCwwLS45NDQ4LS45NDg4bC41MTg0LTEuMjQ2NEw5LjE5NzYsMi4wMDQsOC42Nzg0LDMuMjUxMmE0LjcxNCw0LjcxNCwwLDAsMC0uNjc2OC0uMDQ4OCw0LjgwOCw0LjgwOCwwLDAsMC0uNjYyNC4wNDY0WiIvPgogIDxwYXRoIGlkPSJ2aWRlby1wYW5lbCIgZmlsbD0iI2Y2ZjZmNiIgdHJhbnNmb3JtPSJzY2FsZSgxNC4yMjIyMjIyMjIyKSIgZD0iTTU5LjUyLDI2LjMzNDE2MjcgQzU5LjUyLDI2LjMzNDE2MjcgNTkuMDUwNSwyMy4wMDMxOTkgNTcuNjEyLDIxLjUzNjM2NjUgQzU1Ljc4NjUsMTkuNjEwMjk5IDUzLjc0MDUsMTkuNjAxMjM1MiA1Mi44MDMsMTkuNDg5NDQ3NyBDNDYuMDg2LDE5IDM2LjAxMDUsMTkgMzYuMDEwNSwxOSBMMzUuOTg5NSwxOSBDMzUuOTg5NSwxOSAyNS45MTQsMTkgMTkuMTk3LDE5LjQ4OTQ0NzcgQzE4LjI1OCwxOS42MDEyMzUyIDE2LjIxMzUsMTkuNjEwMjk5IDE0LjM4NjUsMjEuNTM2MzY2NSBDMTIuOTQ4LDIzLjAwMzE5OSAxMi40OCwyNi4zMzQxNjI3IDEyLjQ4LDI2LjMzNDE2MjcgQzEyLjQ4LDI2LjMzNDE2MjcgMTIsMzAuMjQ2NzIzMiAxMiwzNC4xNTc3NzMxIEwxMiwzNy44MjU2MDk4IEMxMiw0MS43MzgxNzAzIDEyLjQ4LDQ1LjY0OTIyMDIgMTIuNDgsNDUuNjQ5MjIwMiBDMTIuNDgsNDUuNjQ5MjIwMiAxMi45NDgsNDguOTgwMTgzOSAxNC4zODY1LDUwLjQ0NzAxNjUgQzE2LjIxMzUsNTIuMzczMDgzOSAxOC42MTIsNTIuMzEyNjU4MyAxOS42OCw1Mi41MTM1NzM2IEMyMy41Miw1Mi44ODUxOTEzIDM2LDUzIDM2LDUzIEMzNiw1MyA0Ni4wODYsNTIuOTg0ODkzNiA1Mi44MDMsNTIuNDk1NDQ1OSBDNTMuNzQwNSw1Mi4zODIxNDc4IDU1Ljc4NjUsNTIuMzczMDgzOSA1Ny42MTIsNTAuNDQ3MDE2NSBDNTkuMDUwNSw0OC45ODAxODM5IDU5LjUyLDQ1LjY0OTIyMDIgNTkuNTIsNDUuNjQ5MjIwMiBDNTkuNTIsNDUuNjQ5MjIwMiA2MCw0MS43MzgxNzAzIDYwLDM3LjgyNTYwOTggTDYwLDM0LjE1Nzc3MzEgQzYwLDMwLjI0NjcyMzIgNTkuNTIsMjYuMzM0MTYyNyA1OS41MiwyNi4zMzQxNjI3IEw1OS41MiwyNi4zMzQxNjI3IFoiLz4KICA8cGF0aCBpZD0icGxheS10cmlhbmdsZSIgZmlsbD0iI2Y2MDAwMiIgdHJhbnNmb3JtPSJzY2FsZSgxNC4yMjIyMjIyMjIyKSIgZD0iTTMxLjA0NCw0Mi4yNjk5MTYgTDMxLjA0MjUsMjguNjg3NzQxNiBMNDQuMDExNSwzNS41MDIyNDM3IEwzMS4wNDQsNDIuMjY5OTE2IFoiLz4KPC9zdmc+Cg==","playerLogo":"data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzNiIgaGVpZ2h0PSIzNiIgdmlld0JveD0iMCAwIDEwMjQgMTAyNCI+CiAgPCEtLSBNb25vY2hyb21lIHZhcmlhbnQgb2YgdGhlIG9yaWdpbmFsIHN1aXRlIGxvZ287IHRyYW5zcGFyZW50IHBhbmVsIHdpdGggd2hpdGUgcGxheSB0cmlhbmdsZS4gLS0+CiAgPGRlZnM+CiAgICA8bWFzayBpZD0ic3VpdGUtbG9nby1tYXNrIiBtYXNrVW5pdHM9InVzZXJTcGFjZU9uVXNlIiB4PSIwIiB5PSIwIiB3aWR0aD0iMTAyNCIgaGVpZ2h0PSIxMDI0IiBzdHlsZT0ibWFzay10eXBlOmx1bWluYW5jZSI+CiAgICAgIDxwYXRoIGlkPSJjb2ciIGZpbGw9IiNmZmYiIHRyYW5zZm9ybT0ibWF0cml4KDgzLjg0MjEzOCAwIDAgODMuODQyMTM4IC0xNTguNTI4MjExIC0xNTguNTI4MjExKSIgZD0iTTYuODIzMiwybC0yLjIxNjguOTE0NC41MTUyLDEuMjQ4OGE0Ljc0Mjg2LDQuNzQyODYsMCwwLDAtLjk0OTYuOTQ0OEwyLjkyNDgsNC41ODk2LDIuMDAzMiw2LjgwMjRsMS4yNDcyLjUxOTJhNC44Miw0LjgyLDAsMCwwLS4wMDI0LDEuMzRMMiw5LjE3NmwuOTEzNiwyLjIxNzYsMS4yNDg4LS41MTQ0YTQuODI0NDUsNC44MjQ0NSwwLDAsMCwuOTQ0OC45NDg4bC0uNTE4NCwxLjI0NzIsMi4yMTQ0LjkyMDguNTE4NC0xLjI0NjRhNC42Nzk1Miw0LjY3OTUyLDAsMCwwLC42NzQ0LjA0OCw0LjczOTcyLDQuNzM5NzIsMCwwLDAsLjY2NTYtLjA0NjRMOS4xNzYsMTRsMi4yMTc2LS45MTM2LS41MTQ0LTEuMjQ4OGE0LjgyODIyLDQuODI4MjIsMCwwLDAsLjk0OTYtLjk0NDhsMS4yNDU2LjUxODQuOTIxNi0yLjIxNDQtMS4yNDcyLS41MTg0YTQuNzI5ODQsNC43Mjk4NCwwLDAsMCwuMDAyNC0xLjM0TDE0LDYuODI0bC0uOTE0NC0yLjIxNzYtMS4yNDg4LjUxNDRhNC43Mzg5MSw0LjczODkxLDAsMCwwLS45NDQ4LS45NDg4bC41MTg0LTEuMjQ2NEw5LjE5NzYsMi4wMDQsOC42Nzg0LDMuMjUxMmE0LjcxNCw0LjcxNCwwLDAsMC0uNjc2OC0uMDQ4OCw0LjgwOCw0LjgwOCwwLDAsMC0uNjYyNC4wNDY0WiIvPgogICAgICA8cGF0aCBpZD0idmlkZW8tcGFuZWwiIGZpbGw9IiMwMDAiIHRyYW5zZm9ybT0ic2NhbGUoMTQuMjIyMjIyMjIyMikiIGQ9Ik01OS41MiwyNi4zMzQxNjI3IEM1OS41MiwyNi4zMzQxNjI3IDU5LjA1MDUsMjMuMDAzMTk5IDU3LjYxMiwyMS41MzYzNjY1IEM1NS43ODY1LDE5LjYxMDI5OSA1My43NDA1LDE5LjYwMTIzNTIgNTIuODAzLDE5LjQ4OTQ0NzcgQzQ2LjA4NiwxOSAzNi4wMTA1LDE5IDM2LjAxMDUsMTkgTDM1Ljk4OTUsMTkgQzM1Ljk4OTUsMTkgMjUuOTE0LDE5IDE5LjE5NywxOS40ODk0NDc3IEMxOC4yNTgsMTkuNjAxMjM1MiAxNi4yMTM1LDE5LjYxMDI5OSAxNC4zODY1LDIxLjUzNjM2NjUgQzEyLjk0OCwyMy4wMDMxOTkgMTIuNDgsMjYuMzM0MTYyNyAxMi40OCwyNi4zMzQxNjI3IEMxMi40OCwyNi4zMzQxNjI3IDEyLDMwLjI0NjcyMzIgMTIsMzQuMTU3NzczMSBMMTIsMzcuODI1NjA5OCBDMTIsNDEuNzM4MTcwMyAxMi40OCw0NS42NDkyMjAyIDEyLjQ4LDQ1LjY0OTIyMDIgQzEyLjQ4LDQ1LjY0OTIyMDIgMTIuOTQ4LDQ4Ljk4MDE4MzkgMTQuMzg2NSw1MC40NDcwMTY1IEMxNi4yMTM1LDUyLjM3MzA4MzkgMTguNjEyLDUyLjMxMjY1ODMgMTkuNjgsNTIuNTEzNTczNiBDMjMuNTIsNTIuODg1MTkxMyAzNiw1MyAzNiw1MyBDMzYsNTMgNDYuMDg2LDUyLjk4NDg5MzYgNTIuODAzLDUyLjQ5NTQ0NTkgQzUzLjc0MDUsNTIuMzgyMTQ3OCA1NS43ODY1LDUyLjM3MzA4MzkgNTcuNjEyLDUwLjQ0NzAxNjUgQzU5LjA1MDUsNDguOTgwMTgzOSA1OS41Miw0NS42NDkyMjAyIDU5LjUyLDQ1LjY0OTIyMDIgQzU5LjUyLDQ1LjY0OTIyMDIgNjAsNDEuNzM4MTcwMyA2MCwzNy44MjU2MDk4IEw2MCwzNC4xNTc3NzMxIEM2MCwzMC4yNDY3MjMyIDU5LjUyLDI2LjMzNDE2MjcgNTkuNTIsMjYuMzM0MTYyNyBMNTkuNTIsMjYuMzM0MTYyNyBaIi8+CiAgICAgIDxwYXRoIGlkPSJwbGF5LXRyaWFuZ2xlIiBmaWxsPSIjZmZmIiB0cmFuc2Zvcm09InNjYWxlKDE0LjIyMjIyMjIyMjIpIiBkPSJNMzEuMDQ0LDQyLjI2OTkxNiBMMzEuMDQyNSwyOC42ODc3NDE2IEw0NC4wMTE1LDM1LjUwMjI0MzcgTDMxLjA0NCw0Mi4yNjk5MTYgWiIvPgogICAgPC9tYXNrPgogIDwvZGVmcz4KICA8cmVjdCB3aWR0aD0iMTAyNCIgaGVpZ2h0PSIxMDI0IiBmaWxsPSIjZmZmIiBtYXNrPSJ1cmwoI3N1aXRlLWxvZ28tbWFzaykiLz4KPC9zdmc+Cg==","recommendedExtensions":[{"id":"ryd","name":"Return YouTube Dislike","description":"Shows estimated dislike counts beside YouTube’s dislike button.","note":"Counts are estimates from community data, not an official live YouTube count.","url":"https://returnyoutubedislike.com/install","logo":"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAM5npUWHRSYXcgcHJvZmlsZSB0eXBlIGV4aWYAAHjatZlpdiM7roT/cxW9BE7gsByO5/QO3vL7AzNl+7pkW3WrnlU2VcoUCQKBQIBp1v/9d5v/8BOTJBMll1RTsvzEGqtvvCn2/Wfd4/WZs/H8ffy4+68zTy94xsAYrg9zvK+G+/PH/eltZKInF5x8+kJ4W8Z/XDi3+3Nv/T8s6tY5+/GnvP/uPcve69pdiwk3pGtT1xLmMQ03drwUztcSr8yv8D6fV+VVbLPDRTvtYM3O++q8C3a76KZxzW233GQcbmBj9MtnRu+HD+ezErKvfgQbXIj6ctvnUMMMJfgw/AohRBP8my3urFvPesMVVp6OW71jMsdXvn2Zn2545bX3sPgIB5fjJ3cF2HuNg1M3Bv3LbQTE7Ttuchz8eL39mA+BDURQjpsLG2y2X1N0ce/YCgcAgfuE8cKXy1Oj5g9KImsLxrhACGxyQVxyNnufnYvBFwLUsNyH6DsRcCJ+YqSPISRiU8ARa/Od7M69Xvz1OalCfCSkkIlNDY1gxSjgJ8cChpoEiSKSJEuRKs2kkDTnUspJc67lkGOWnHLOJdfcSiixSEkll1JqadXXQEpKTTXXUmttjTVbNE0a327c0Vr3PfTYpaeee+m1twF8Rhwy0sijjDra9DPMOGWmmWeZdbblFlAyKy5ZaeVVVl1tg7Uddtyy08677LrbW9TuqP7y+o2ouTtq/kRK78tvUePTnHWiM4VTnhGNGRHz0RHxrBEA0F5jZouL0WvkNGa2erJCPEaKxmY624xLhDAu52W7t9i9R+7luBl8/VPc/CuRMxq6vxA5b1b4FLcnUZvKhONE7MpC9akNZB/XV2m+NJztrzdnxIgYp/OzC4bl2lKuwg4iJcHz3UQ27ezWljpjw5u8T9XNTIoM0makiQUh5hxsKm0R90U6dRK/rp4Z4OcJWxQ5721pyrtjSy/6/75qNnv4jn19xshcezLtyN3vPlb0vzGp+TgrkxZ8Aoj0E5Ec3Bp97QA8fcdZfFqi4PS9cpsMc8fOQjFvM7zvWMItYaYV9tpNzkotHDOfG0ndvM209jLU7GMnKx1LLzsJ0WXoZzOfGIn3j5HmiZUPI/9h4rcGYp75vdh87UXzsxtf86L52Y2vedF84cZMth2Ix9lDrM0BcZIzWkig2gjEgZ1bU0qQ6eJqJqYWyQWfyy7zwJxfoCk923bSRr/5MzTNl07lPxfeW3gFnubfOPaZX82/cewzv5rLDx1mGZdPig1tTQRM7HWGtJUo6vJwaBmtsBnYcZTATrokZkSEjiXUNZi5emWV3UNC0Eg8vzCfm+UiqxKgyQ+09Ww0X96gm3HCXor4s1349Hgv+tTW+HzdfL5hHPA7SHYsf5Kyuhw21QMiFEJynF+tDLwslw9X8d0IM353g8xZFiK0bl8xY2/0oKwy5ry8OwSKX9S1y79vfh7jIvNNldqIdQ3v+b6W2k7UVr+iPK0kFCkUH5aHwI0qUSoT8EjBEzgofqFF86H4mRdlJA/K1VAx68cabcxeKrewd+4dYbY+oNosUihBPaxGjYJ3loCa2f0QlPWUXOfoOZ4wV0/Nsu78x34ajf3iwpNRSILSyAFVAeQD0uBEE3mXk/n+MtJkFwrsylekKTitBbsukrXn7yieXZhNyPPeCJDGVL/e8PE67/KGP2o8Qa6OoMSUyAO2Riy9OtTK2YJ9jGTG7ZkZ3C7Z9foGkRYVIiNeEEEozCKGCZnHIxqqqodpO3EZo/dYiEwZKborMpHguCESi1brQTZSuNmsEoyVYlTxdARDunxKj7HGL9bRTIxdQhfkWxmhjwkdugD8pR6MlWraSBpsmpaUkNQNoEMyCz+gJ1fGCxmBAzYn0md6V7yiAIHlMLBMMFwXCHGU7IbgSX25tgrCh8QLMiZzjG5DqQ4ldHgTbp5huN5xah4t4Th0UCN1hBBkQ58kSCx8szpRQApJjin7CFOu5AO7ShlMBJC/GioTxZfj5QftxB5kYZ6xh4LvjR8ucvjAHc+vmps53nnjV9a4KQHfn25UKeEDZdxXzcfLnxkDA59zxq+U0U3scVMJVxbkdEsFV6rmnVoIPUSA2khH67EO6cKmVnRZ286s5abZNjO83A5nZ1BPiVxxVpdsq0hrl1pBtILNN2sOAj9b82aVWTUqSKlh7Hf1igxMVOxF7CmO6FrswKUpbwT2pBKhp4FVJZeTVtkmblIkKdmEHUpC7Uc64hHyGHGFdhgAaOEA6qbdlB64SVwBo7ThA7GbyKAYeqctGDWYCYTZZkszxFYSvQJA8SzX/M5l0vNX9kjn3qcHWGnGPgKCv4mS3w6j2oCUJtdojovWPCAMDjRHkuA2C9iLnymQeU0WXSYoj1Rjsqb5aDEgi6VNAUedYmtkEQdPNxYoqC3JHtmOECbrwexu1Ew8SWVMgpBFBXymOyqpKfQPRPi+dkelAChKc+3TYmnzNRbakxUCAHq9bJrndfP3y6b5oiz+dtk0L+VA+cjk4g+Te2VyL4/tmG9v6MHNPXAq0TnJgWXIxkOctEJ5uvIgU/OZVQEAgT4e2Ze8Q6Eh3hFkW8hG1hlZZdrMIewx0Eh0f26aQAegi1LShlx7aQin864RRdVcRYRerwC/GFxD53YflIoTveqCluk4y1FsNLuBUq7pMdB/WUv2XB1dhs9okAcVhsIBwMZ2euoEdbvoI/hfhE21WzZkuLb3dKjLdwQ0srg7SHnC6mQZ8nOpACCfuQGvTSgE1mGGUJwD+SSGc76eU79KdlSqAHXDYQKNfAckeLZki5BosdKi9uxXS/F2tM8Pp6t/tc266JXiKZdjsYLiObV4cvnLq7VwkRJMksq5ZjzkuBpV73tJVX+QXN10RYoLS26kwGrTVSr2qbulIbXGK8LHPLuAaq/vgGHNd8gk+wXKDDDbEdJe8C1QOfvFgWw9kWxJmRHtR/FEOUBgjiyr+FfVRdFjBli447pl/J6RPgpJSRGfy3U9I6kgxRFsQquEV0tuqgGBwKZ3kNyrfjmDFG9jPAdFZqMd92xIe9IMMTZDq0sJrsIqSKA+EwnGTazqaYQrCJ2oS68oYOKSHCy3USMhkiBWJ9uZnIC/VZ8GuogV67KRCSn7yvPlCF4aPkCU2CUMDivZiBKsbI3ysiGvCYlGVNDUQ0b4lJKCuyaEfNMk1sVvGNO81mn8zJjmtU7jZ8Y0r3Uaz+v0x9E8LeQoOoq16k+3Jz0iGrMItNW3b6RU0E5TuUMrEfCrqU5DeWrQwRAKaKbWdocbiK0WP8QiwdmqwNPiS9IrFSo0PeAiQ7kFSmzECZVgICoQmyMcNkKC6sCe36kmKIn6+iZ152ep+2k0F5v8OZmYi03+nEzMxSZ/Tia/02b9ONG3jdarbZj5qQ97tQ0zP/VhX7VhjHAEirHnDPOIWQFZ5WNsoLim87AC2NiAjbmBJCpjXMK/oeUVZqA8nV+6nLLuCOgjn/R3fK0H40+9+Z2nn7a75p9+1vJ9+VAZSL2oj0ze/fzl9WX+6WeVdC94+nPDa09d+zoRNQ9f7ZDML5fzzXQx/06HdJ9ovX/g6VxdK/GchnQqTLtOQ86jCz0NqWtleu5KY7nFFj1BH3q8aEQbXeiq6nPU01VgHBlLO3FBLepju1GdB2lp3UBD7x+gDYpYyrbT9zOuHVUPhTB2DpMGJNEmE2xUVWjp7TyyazP2JW2bF3j9Gh9E9JGGPhwimXOK9BcOkcw5RfoLh0jmfkO5jkGjEGdx1PQKIdPHpqLPJ+8mTJsj7zSTHZ0qxFnRt21puuNs74a9Kw/CGC1MXNfVKie2669Wme3a0yrrI4+rVV5joSD6Qi6smpbJoF2xgZ/aJOoU+pwRMUx316JUEeo/coB5kSwSvewpC76eVt1pq+78fDCEmC8u6tPArjShRzF3qpD163HW+ktfaM6bVgGyurB268ek29WHWmnqUyevOEbsqVwkHn1S0Q9ifKJHOYjRY3fzJsPwYdQ8m3OsJsx3M3ADMRAB7e2yRRNtsUSfiBecPSvp5KeeQ9LyMMpiLVQgtMB8q7b52AIqNZWfjo7ftvbCjWdkya/aRPM4E/qmj0SnQKPovBn6l42kublTFInqxkBJ0v4/62PJqTC0UYEIMdBvDSWXQ1eVwMZpKVdIa0qRgXAtfkQJD/xYNFF61+d5VLCEukfg6pMNCEDPQFSSqfROCDb0xtD8JB9QYGbXuggu/SJrxVT6nkB+Mt1tunYQP6ksRvPTDc9H14RqfSEvF1Jo6BlbQwrJjb1qb+z1HfeNPZvg5EPJ56DrIE8PujR7wZUwKU3NIeabsarTExx0pwyngEYBOJ0UWkqAr2W4HB81fN6Vk/059jqcnI2ScsD1V6lJQfuEf1NJTHyY/YeVxGgp+RuVxLxUQV4Y/18ngt9mNf8DR5y9ArsaIYgAAAGEaUNDUElDQyBwcm9maWxlAAB4nH2RPUjDQBzFX1OlRaoOdhBxyFCdLIiKOEorFsFCaSu06mBy6Rc0aUhSXBwF14KDH4tVBxdnXR1cBUHwA8TNzUnRRUr8X1JoEePBcT/e3XvcvQOEZpWpZs8koGqWkU7ExFx+VQy8IoQgBAwgKjFTT2YWs/AcX/fw8fUuyrO8z/05+pWCyQCfSDzPdMMi3iCe3bR0zvvEYVaWFOJz4gmDLkj8yHXZ5TfOJYcFnhk2suk4cZhYLHWx3MWsbKjEM8QRRdUoX8i5rHDe4qxW66x9T/7CUEFbyXCd5igSWEISKYiQUUcFVViI0qqRYiJN+zEP/4jjT5FLJlcFjBwLqEGF5PjB/+B3t2ZxespNCsWA3hfb/hgDArtAq2Hb38e23ToB/M/Aldbx15rA3CfpjY4WOQIGt4GL644m7wGXO8Dwky4ZkiP5aQrFIvB+Rt+UB4Zugb41t7f2Pk4fgCx1tXwDHBwC4yXKXvd4d7C7t3/PtPv7AVb4cpy/J7ghAAAACXBIWXMAAB/mAAAf5gGksLI7AAAAB3RJTUUH5QwJDzkC2XMpsQAAAoNJREFUaN7tmT9oE1Ecxz+Xi0oDVdRqpApZLKJoh1YhSmhBDS5dFEsHh6JgEaQIcWiH0qlgly5ShyJU0MlsLk4VB0sLBZtqoB44aUGtoi5FgkZ/DjmhHrnmcv/yDvKFGw7u93vfz++9d++9O2iqsdJqPSBwCcgBJ4CdPrb9EzCAe8B9DaRK21eBIzbxv4F8LfNjAhLC9UAsxRTIOoh7v5X5ToFySAAiMGBp/5qTuNgWHXAb0EMcztfdBMVsqp/EUpEQdMw3AOAGsCNkgJgvQQLbTYBIqBr1AHAgygDDjqOnp6G/Xx0AgTPAKcfRHR2Qz8PiIqTTSvTALVdZ0mlYWKjApFKNARA4CFx0vynRKsNpdRUmJ6G1NfQeuAls85wxkYCRETAMGBoCXQ8eQKDF7Upoq/Z2mJmBpSXo7Q28B64AbYG00NUFExOQTAYKMBxI9rU1GByEnh5YXw+kibjAWaDT16wbGzA1VZnMpVKgcyBuTl5/VC7D7CyMjwdW8WoA53zJNDcHuRwUi6GvA7s8ZTAM6OuDbDZ08/8WMPenqExGRNf9OpF9cnMii3uin59XcjcaKcWAP1EHeBd1gEeKeBG3AHeA5woAfLDcf3YQ8zauQUnggnmQvwwccmkg5fE70mPL/VNgFOi2ef4HcNevvm8R+OVhDXgh4X/G+Q/gtAfzLwV2N3odOOkybhnIavC90QDdLmIKpvlvKrz/inUOm2WBPaq8vBN1TuCCMuZNgEyd5veqtplzOv5XgPMafFVqLyLw0EHlV/yufJgTuKCseRPgY43Kt6GyBJ7YmH+lvHkT4LDAF4v51wL7InOoEDi6aSi9kQj94dkMcVzgmcB+mmoqOvoL3Z82CBlycfMAAAAASUVORK5CYII="},{"id":"sponsorblock","name":"SponsorBlock","description":"Skips community-marked sponsor segments, intros and other optional categories.","note":"Complements the Suite without replacing its player or queue controls.","url":"https://sponsor.ajay.app/","logo":"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAXoHpUWHRSYXcgcHJvZmlsZSB0eXBlIGV4aWYAAHjapZpplty6coT/YxVeAjEDy8F4jnfg5fsLgNWa732y1WpVqQYSyIyMiEzSrP/5723+iz/JPc6EmEuqKT38CTVU13hSnvunnX/tE86/50943+L/P7xuvt5wvOR59Pe/Jb2f/7xuvw5wHxrP4ncHKuN9o//4Rn3P4MpPB3pP5LUix5P5Hqi+B/LuvmHfA7S7rSfVkr/fQl/3cX52Uu6v0T/7PYt9H3/+f8hEb0bO451bnpf513t3F+D1641vPLH86z3h8PppPvKWXsnvSgjI7+L09aeyor3eVPz6oR+y8vXM/v5183O2gns/4n8Kcvp6/O3rxsbfZ+WE/nv8lPeZ+/H1NWy6K/op+if4e5Z99swuWkiEOr2b+mzlPONznVPo1MWwtPRkfiOHyOen8lNA9QAK8xlP52fYah3p2jbYaZvddp3HYQdLDG4Zl3ni3HD+vFh8dtWNk8mgH7td9tVPX8jkOGkP3n2txZ7T1meYc7bCmaflo85yMMtX/vrH/O0X9lYpWPuUr1ixLucUbJahzOlfPkZG7H6DGk+APz8//1FePRmMirJKpBLYfg/Ro/3GBP4k2vPByOOtQZvnewBCxKkji7GeDJA166NN9snOZWsJZCFBjaU7H1wnAzZGN1mkC94nclOcTs1Xsj0fddHxsuF1yIxMRJ98JjfVN5IVQgQ/ORQw1KKPIcaYYo4l1tiSTyHFlFJOIsWWfQ4mx5xyziXX3IovocSSSi6l1NKqqx7SjDXVXEuttTXO2Thy49uND7TWXfc99Gh66rmXXnsbwGeEEUcaeZRRR5tu+gl/zDTzLLPOtuwCSiusuNLKq6y62gZq25sddtxp51123e0ra29af/n5i6zZN2vuZEofzF9Z49WcP4ewopOonJEwVMSS8awUAGinnD3FhuCUOeXsqdCfj45FRuVsWmWMDIZlXdz2kzvjbkaVuf9X3kwOP+TN/V8zZ5S6v8zcr3n7XdamZGicjN0qVFAfT/XxmeYKf9Gqr8c+ZieApRu7Z90rZpJW8xiTw/EldjmSt0XPk5+rl7ytTpY3MW67W70zQs9r9J3S3EYvuLnzWnP2zFH5du+7zexiGCly7mknJwu2kKg+2GJtK5ftRtyxNw4f1+5mFerZxxWr3yMF+DAJUgVa3LvloROtwRYyEZs2jhi93Z7V25aX37BumMUvY/0AJWmv/hAfwjWXT7u3kFtKzW/LW5O9361Un9I4Bx99Lk42MttcMy6TrRtzpeQXqSIaJNd1kBFjnWGT77UhGreHT88ETc6nvitB4HeOE/Q2xpqGyNdsowOrffsNJjlBeGoPpYCSzg/xOwngCLvwlOdxtRSn8yDwJHwjR/m+UTeo8jlSdhnERhtbmc0ThRU5wPInmxMI2h7QkJskvmwn7/Zp2FJ6Wp8+d+8q3yeuviueKXs2D2+0MNGmES56LGoVPWVQd1VGctshT5C9SD5hB0Gco1SXa+1QDGjNhaixopE7Ka+kjJpr3ZPxp/vSLUcDEJYvtW1s32O2PcAGX4DQt62e4HFcpJUjbXbtdZL+tM2BdoUiHsI6Y+CEvuzBokg/SFgPAlrCfmaMbTfwSFUD0hr32tXuqNVwtFyCH1nBKi3Pzjkc8UsAPSwDKCq48YlFgBdQt+fa0/VepmffvA8T1BNc6wAsBaEErA6IVpbdSG3NZghEiy6yDO9XyjYPn0mX9SDZrlTa6jl0gsIK57NDPSGHJyjK74vX1Eo15sJ2lgXFqsYmjPfFgkhsJHazdxVOx07s3HdoiNyEflgZx3Z9k18T14W8TQfwEFOkXLMoqfqe1uC4o1H9q4N+wGr7ioWMNzZOCOCjVXa0ppcNga2Q3vQ/ooGXSgaVRNTiChsazTtV3nEJmqBwYMZJ21B9TH0sYgQh7imF5wsWwchZ9QTVTXLWiMyJBHurBDnxwu5nr5byI9ypuwCrZDOgX0ccWoXsDx5zBQyV/LI9Igp3hdnL2HngHyD3WSpsFbaSfsrmUJkpBJkgxdYaIgDgKbOwkTH+m3OKo6eTegFkz/MlvqIqcYkMEUbAXEY2fcbE2sl8wivOOngDog9xTJfIPgKXbODgUe3F+1ib3uY/5MiBBTJnPNEje4AfoYDITkB7UxSgzAifV/QNJJNcKi8H1aaPSPLSPnMjy5HqM7P2lNdmF+vA4BF9zgi91VQ4OufrOC68VAwYTSrEdwAAqOeqBLqKFKluAymWp/PeQFUpNX1PFaNKUdnUNQsSiH9KDzhBKuGU2Sd5sHwrEOcOJVkA2SOoVcnvOW9F2ZteUdeul9Cq6B/GnKmCnYmSxTp8mQOUU5UoLfamS2vRxkAaPqXu+MZuhZpUcOZMe+6TLai4SlAbCgYLUFxHZ6yhUgjSqS9oahxy4LhbSwbMnegQQODB35JQ6xhnxzwQo8pq9kwD4071O3Bmke8Q02zoEdsnLnRoJcred4SU9YzJFlkPCgRtAPCGO7FxQf9UAGsH2U42C/j3h7RQVQJf3JAqa2OpG4MBoUbkoegspc4k5WMxRPcRsJxtoZo0Xpj551eL8BeP5vsXgDrFtfAVqVkJhgcmK7BoIGYz0KRjiX5dIRcfI1PhgSDTkvVLbazt4QsSkCGuzD5pgQ984lNncVIp/BkHmbwEBNfC8Y2ccGagt1JYx40MRz1ThpQYHIL70GZL/w/2hEgHTQggNn3nOTH7PzxSspgFCUI2Rwt6jFQflCgGPOg+tUoxzVFago4g2xiqZdFj44MnawpUYrZELbRUCbYt/3bahXF5EiUGlaHiB8koDGyvsxavtSyDmSDYUF4eD+5IEiejNeDWdWsPf2pRW3xARg6fa72SOzWYwCv7As/47IgyYiegHCon0lVDwUIwrgcjiivIqvQF+XJoFKOz/Qql7Bqh4SRCwTJTtM1lQP7cMxRJNLHBotUsscNgX53aMBhs2dEkQA1gnN9IHyUN3UFso7tv/rXLv6aeEDk80LNbHSjwGh5ajHVVhzYD2WpHVYwDG8TeIVaBYAsUGhP926OKSs9YYZ5oy/E8QN3hs6NGY0T6q9wQhzFwuKhllUlQmUMfQGPi++FtVnPtBrwNQGqlA+irsAGDp3z0vxcEZf5xUUjlLuID+PtwRIJouscNWnyYoQJxZZv2BYvSNWKopPDhFyXFmhF7UkY0UTVPAlYoRxiwWNm+3lXNs4noOI0O9V5Y7cx90ARC/d1fZ01lQmsACjgJeaSqyVthAaIGHid/kJ8YUgn0F3rbKoaYytUBjsRX50bx0br5at01WLYt3/CeME9kMduEimGz7JKNoAIeyzIqO3HYXUxVn8kf109XUz+oPxG6qD/qT8iSaUCKtY4sL4qPquIjPLj4hvVEco7B6HQBfNBiwAMyYmWn3z7KrUE5HByhFPMfSAeuWu7AV4rqO4cSIjyqy44JUaUBWAY+39Q3kt5kAPDRjsX4RKmdQ9H3Pivj31ztUT46PG85DXdyPFVRbI2Nh2NaHQYmnYBOgokbAHD0VHEGtbnoDCEdswT1WfyiKw0bQM9GO4rmmuwDzhPU0kPSZIxjIWyjgwk+qZ+Qk7/I19zrj2A1/4TWvwGr+aD1HBoedeXrbDQbyMaTT+OHqgcxC0ceVkiyS1xH6KOTazSqPBy7epXoMOgIrB9uYx8f9c1+lOt267UDHLKIddQ5xjhcOK1NWSJ/AR7fBQoTHhTRxjAIfx+Sm99Irny6z6juM0cMxI4F6Hske1twsSDhfFDaZUBWbmoTkHlWF1lYlykgIVUG7e0no1ClDbL8bg2CSg1H+iaqE86ZFKqaKfqQhqC+EQNz3xCaHy+N4gQB00m7C8l7U0/lSJpSzc6RcKQzw59OJhTB6oDieeiw1K04qcnxcgGW9EBbvof+KhqV1pJ//hiqxhmJRHaDmoAygXxdNhWcLuhkxxs/vkqOtIiNwBJMeGmbDWkc4q8AB/BMtu3s1iREbQSYh5VJncsHsh4bBilRZ1AMBEQfWei4lzfR165x1uMHzpmiwEWkBwMTu0CHeR4KYFhZjYSyRm9AdFcf8oyVFGLzO+mHxg/xDUejpAEFHnWlmGLj2yfSIf5ZzTFTV3vNr+JLyrDKfyyczlsKO/miiaZsgAWpM6Pewx/u/s2Zee10SfZ0SQSILgnCW4sk+jdzd0U0yuo012mSaQ1ZF7rcakzwAj0fb1n/cCKbHTIBCo7x8b6jvuRj1NOMmnyovMD1cT1Is+/qvi+Yj9XGpuBxcbwaxm1NV/i3nG5bU5ETYNgRzvZK70DHwfUqmH3rkRY4odE0hSopgqU48Lq0lEFH+Gq5fKVJInsGJ0BGIUBLGGk2oYljSNc1pCcjRd0SzTpmplc2nApeHQnCmfMNadSahjJf1AwpgANCHm4CY3wYjQlySfHDDqLjNN5SfWcN+Nq3dwdRz6DLlh71pmkXvhZLjKHBDKjzJuEKlE/qv7ZbC0FJByoEKqKYkpb1Spf56Cod8uYve4GpKl2RggiP7vNV6jsK2BgSFI5ayKoFWuxCNgv07wxfiRQ8WoCRGQV1jo2T3ykAItIeC24K1TadGvPjgUAMCgZzKYX+TAoMDeLIodGtf9cjvoDUz49tce7lD4JgqD1cIeDEYSn6VcOHHcUTkJ+lIAJuALycBg+xgwK2e8+QVq56SlBp/OiqwsZg7hvDBThxySQJnbv2Ug0j5gyxiHR707UjyFA4rIeFJ6/QSBkTw9RoNDkTLuKqBrqsjLzsPA87a6WakQ0gpNkdbSbisC0OlfCaQ1f5toZbpE0UqoNIy2mQNufGODSOjP3FgpI8OM8KtqRbZsFJIqKRA8tHI6ykMn7NHK8ITnRnzFMZ9NbVq+vH2Dm8ZtM0hu1jnN/uKLqvNvKkhxgOgAywl2YLHm+BARyHHS2+2uOu6XK6pS/ibz+O3pzWCLRoohv8U864HCBVFV4ap/YIgQZrGgSLKuBSaBr81l0cnsYrXEZv3QBPOGiBR+wlUkDnD3LZZ4PWADlnAMI9uYvgQlXn+Jm/5FQNNQRnvN3AdGdGUCWugprdfSl9u8p/KHdJTYkm2mgI4UM/2IpmMQY8PN5mO2hZl5eK0WewQM2/c4IEG1aAXLKjLSL1JyRqd3FyfJhswDA1mwQBimozq24edsfcBr2/O1F/VaT8WT0+4mH+I/XAFpHFQCl/5rzYLHbrAsip4IJgs4TQT/kAiOB2jk7DSBEzcO/C+ms7AFQ42jFU9lc7vkmHOdrxVgBh8VCOJnsaq6ruNEzVoNKurzElDr5jtUtC4QcbEaeOZmAwltqW/CBkv9SNnYtaFtbXNkvVFF02a3m1tjpdE9eqnJLqEeod20B54BEhwVeRoWhZ0lzpIZvNQiGgq+17ueAzk5TD7z8bXPPN6YJFXRohld9lkrBjnFLXEG+rfRLhwiVYxAVqAzVCDKqfpmfcU3g0DaQtIBGUymmE+VWd42frKeqHCpQVRhxD6w3FnKG20siinaWbsmgJRPtu0n5vq4tWO6Mfd6X04H7b+vF9Hr9bZNk4C1p9mL2qd126ceBH7wTr6PsDmdKlmKDpDFri1NJwDugIYpv5SV7XxIIYTpJi/BJbdXonWVCauIRSRHFOgt3oLPlesyuoA7FWSgRTUQTnSlbxpJ8vYFkNBpHdUID9ml1dJn4Q/NR+nnR5TMHAROM91qh3xIcGwvAahZrDhkS8gAwasNRlwQmVptfgE0zGb4a9re+m55rvSa81Lc3NANkgP+KHXJEEQ9frNKF7CMsVnZCb+2Xw+9OjOdyqewGyzloG7YilI6SEZW51kWzMrxETe7QFZXBTe6bZlTPBbLJ8Q/kBn4kjgsJ0iQAm0rACt8E+8Rf4NTa5L4mTcM0kD660Tfom9UhrdM1q05N0vYkjtVMKaI2unTS0dyxYjTKly0Tkeyu0o56E3EqZ+Aj/1or5rguEa+jPIFZxR9N1Fl1G8i/J3valbvYTZFqGPUTyVF1k0Tzbn2RCYbreRMKqTMu9JpHUmvUzqK2zqH2nveWcqwbqX3PajJLNZGuJugg1wXsjANBBm5VSQflScRoi4ERBoC9r4z5QStX0ljH4YudOxVkMiYGPNZTAk3bKivY8cGb3T43w7x/fGJ36xzugdNSE2IomZB2BJdcEHRbzut4gWs2AueJ1jlrkvEqAOSA26pQdF3Y04fgzomcP5zLHOhdZn9bKg4uXd34i6npH4TghTbxHGJrymDPC2TfMWedbN8wco8uzTkgG2kU0Vbs0shaixTtA52SnVCBEd9S6AUZJFAfDxnz1tw+YrP2xJqLKlqZm+NPt7jMzr0aOQy3vvYjrBZh+je5kR40K1PQCB9RQDNrKMVIuuNzWBv4t86trBbkb1cLA18WM+ngFQXYDWkyPFKRIU1QESYZMt1HIrnd1tiLeM0ApwpfxhV04zS1JFoYjDWqSkzkgUbqGKBpfREc3C+A8hUQmtkIYzwVzXcLvtExGPQIo1zuEvEGOtemy4dLcEpk40xWN0f9ltm2+XujV0R+VzpIvqas+TqJRPNQk3NqipQAi452l0hwnDVBoIchXptsb416j5N2Qizs9/hKtX5zcavzApL6d4vfVaPJDkNQbloXmuWzxFA89xdSVAF2zUYVToRMk6rqGminAiiXbYUB8Q9fEOL6p3+se9XHELDfEKwaqQr5lCx7nfoEIJnTHBoDTVYSJJ+pvS2y6Lsb+64gfhyCq2480zIHEFM6K1LSSGwKA9ZunEnEI0jqa75ins7HSyKUqFy5iJSDag4YeV7rxbH5ilTuhALAFV9v8xDYCC7pDGJBTgnDsp9MEhEaRVv1cD5u6/aUoCBCsFohUy6Xe6fkyshcoFRTahta+or0TIPQW7AfXg6JFMdfazgyUvE/v36sV8t2y1tFEgS7qfhjQka2uNUM3BSWp8GiBBPvXMF0zyd+FUXcTmKbhEUAX5asXbmpELxZBYttWEEKLrGYAfYlbhT86+zyt3OnJVNJ9I7U5yZau4+tyRzhXF3bRjRNysBaqZz2AbJwLRYWORqNN2N2NXNC+MxU29VxK3/L8csDpXP8/V6LUnp02lUTi9nTnwymZfsSUKjr+YcoXdXXZGSfZwDGEVumN7RqNJmRo6IRTFIGABU76QOBbrQN7+Jq9rUqrdgrX/MUVOUe7LraHRnRBcX3mm6dnMnfACZXreqDSO9zZQLJ3kPkfMBuWVDN/VA1+t7Qpceo5mr+Smgc2lsHFMc9L3o1UdU21VxhNbTHeMhdVsaW2qbWjKJmTaghydTt97l4gtOFrBnJsVB0uPpoJarYSkVFNBVE4U50uEGqGrolfoy+GU6AuW9VTB2pHJltxuROHc0V6h0UO+70xgExP342opoGPoBlNUkl5jceX3FVqjZ6jxfRE3NUsR6FJJJ14j3Q2wuPFSdKQBWAW8EuRWjpvGlDdngFu5Syh+4gFxUjY62wCPReHPK08n31gQOr6pL+DtYcO6UTtXJDeN2jn5quXXr9dkg6fCer31Jo89ljSMxzej4LBmeEUtzr6tnX/i93XTMVzB4xubbn3dlVdI8j3xi4ghbM0751dfS5o5zA0y0CIT1c8dMPHc0dkaorFpXGt+AwfUtU1Dnpr+i5CbmYtYevmpmlxDjipSC319l7divPJZf2bNdaj+ccPCM+tZFj6nRtuIq+RCmLqYDpxru4Fw78b3d6h+7oatQeh+gA7AvSNZYTlnGYYXh3wVnsmVE/dH6G6IEFIuvM3ioYw3jnEVyCPggq5n3vk2tc9cmXqjoNPCtCtz3c3nB1vc3i+nN9rNdKYj6SUGVFMr/tRsKw4DSyBhvrUUaZSNA7jLF3jw6X7EWrS6J6+jnbCiyQ/93Togj1MBVU2TXg00IQ105kBsFRieMYMptNbVAjwaae7gATp3oZ7zbg7LbcWr/slVHMHQe+2u5qNpcuEIRvB7jLQ58YrRetu+MLubrd/v90wHzrNRZNFwa2s+y01PyK/TyOPVA8BX60LTJ6/cDwt9rmqjM5KZFzOZxy/cH2aSsyZsVQynvCR5qmuikzUaS6f/TOCbgptkZ4Pe3/MGi7nHXslTvqrvJmfxjBbYyPzv3eqewaezG+OAAABhWlDQ1BJQ0MgcHJvZmlsZQAAeJx9kT1Iw1AUhU9TS0UqDnYQEcxQxcEuVcSxVqEIFUqt0KqDyUv/oElDkuLiKLgWHPxZrDq4OOvq4CoIgj8gri5Oii5S4n1JoUWMFx7v47x7Du/dBwjNKlPNnjigapaRSSbEXH5VDL7Ch1EEEMOExEx9Lp1OwbO+7qmb6i7Ks7z7/qx+pWAywCcSx5luWMQbxDObls55nzjMypJCfE48adAFiR+5Lrv8xrnksMAzw0Y2M08cJhZLXSx3MSsbKvE0cURRNcoXci4rnLc4q9U6a9+TvzBU0FaWuU5rBEksYglpiJBRRwVVWIjSrpFiIkPnCQ//sONPk0smVwWMHAuoQYXk+MH/4PdszeJUzE0KJYDAi21/jAHBXaDVsO3vY9tunQD+Z+BK6/hrTWD2k/RGR4scAQPbwMV1R5P3gMsdYOhJlwzJkfy0hGIReD+jb8oDg7dA35o7t/Y5Th+ALM0qdQMcHALjJcpe93h3b/fc/u1pz+8H2GFyz+LdPtoAAA14aVRYdFhNTDpjb20uYWRvYmUueG1wAAAAAAA8P3hwYWNrZXQgYmVnaW49Iu+7vyIgaWQ9Ilc1TTBNcENlaGlIenJlU3pOVGN6a2M5ZCI/Pgo8eDp4bXBtZXRhIHhtbG5zOng9ImFkb2JlOm5zOm1ldGEvIiB4OnhtcHRrPSJYTVAgQ29yZSA0LjQuMC1FeGl2MiI+CiA8cmRmOlJERiB4bWxuczpyZGY9Imh0dHA6Ly93d3cudzMub3JnLzE5OTkvMDIvMjItcmRmLXN5bnRheC1ucyMiPgogIDxyZGY6RGVzY3JpcHRpb24gcmRmOmFib3V0PSIiCiAgICB4bWxuczp4bXBNTT0iaHR0cDovL25zLmFkb2JlLmNvbS94YXAvMS4wL21tLyIKICAgIHhtbG5zOnN0RXZ0PSJodHRwOi8vbnMuYWRvYmUuY29tL3hhcC8xLjAvc1R5cGUvUmVzb3VyY2VFdmVudCMiCiAgICB4bWxuczpkYz0iaHR0cDovL3B1cmwub3JnL2RjL2VsZW1lbnRzLzEuMS8iCiAgICB4bWxuczpHSU1QPSJodHRwOi8vd3d3LmdpbXAub3JnL3htcC8iCiAgICB4bWxuczp0aWZmPSJodHRwOi8vbnMuYWRvYmUuY29tL3RpZmYvMS4wLyIKICAgIHhtbG5zOnhtcD0iaHR0cDovL25zLmFkb2JlLmNvbS94YXAvMS4wLyIKICAgeG1wTU06RG9jdW1lbnRJRD0iZ2ltcDpkb2NpZDpnaW1wOjIyOGI2NTU1LTQ4MjctNGQ4OS04YTkwLWFhMDAwZjFiNzQ2MSIKICAgeG1wTU06SW5zdGFuY2VJRD0ieG1wLmlpZDo0YTM0NGNlNS1kODIyLTQyNDItYTc5Zi02NjRjNTRiZjRlNmEiCiAgIHhtcE1NOk9yaWdpbmFsRG9jdW1lbnRJRD0ieG1wLmRpZDplMTMwMTAwYi1jYzMxLTQ0ZTUtYTdhOC02Y2E4ZjViMDY2YWQiCiAgIGRjOkZvcm1hdD0iaW1hZ2UvcG5nIgogICBHSU1QOkFQST0iMi4wIgogICBHSU1QOlBsYXRmb3JtPSJMaW51eCIKICAgR0lNUDpUaW1lU3RhbXA9IjE2NzUxNDQzNTk0MDk3MjAiCiAgIEdJTVA6VmVyc2lvbj0iMi4xMC4zMiIKICAgdGlmZjpPcmllbnRhdGlvbj0iMSIKICAgeG1wOkNyZWF0b3JUb29sPSJHSU1QIDIuMTAiCiAgIHhtcDpNZXRhZGF0YURhdGU9IjIwMjM6MDE6MzFUMDA6NTI6MzctMDU6MDAiCiAgIHhtcDpNb2RpZnlEYXRlPSIyMDIzOjAxOjMxVDAwOjUyOjM3LTA1OjAwIj4KICAgPHhtcE1NOkhpc3Rvcnk+CiAgICA8cmRmOlNlcT4KICAgICA8cmRmOmxpCiAgICAgIHN0RXZ0OmFjdGlvbj0ic2F2ZWQiCiAgICAgIHN0RXZ0OmNoYW5nZWQ9Ii8iCiAgICAgIHN0RXZ0Omluc3RhbmNlSUQ9InhtcC5paWQ6MDhkMjkzMzYtZjMyNC00ZDBlLWI4YTQtMDM5ZGEyMGJmODQ5IgogICAgICBzdEV2dDpzb2Z0d2FyZUFnZW50PSJHaW1wIDIuMTAgKExpbnV4KSIKICAgICAgc3RFdnQ6d2hlbj0iMjAyMy0wMS0zMVQwMDo1MjozOS0wNTowMCIvPgogICAgPC9yZGY6U2VxPgogICA8L3htcE1NOkhpc3Rvcnk+CiAgPC9yZGY6RGVzY3JpcHRpb24+CiA8L3JkZjpSREY+CjwveDp4bXBtZXRhPgogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgCjw/eHBhY2tldCBlbmQ9InciPz41UlPLAAAABmJLR0QA/wD/AP+gvaeTAAAACXBIWXMAAAT/AAAE/wFuw8zVAAAAB3RJTUUH5wEfBTQn6mRrlAAAC6pJREFUeNrdm3mMXXUVxz/n9+5bZjp7F6GUFgpWKVARrRZQKJBiCCSAFUFBwAWlEAElKgg2igqoiBptUJYgNAgiCiYGWQQERECLtbjQKgxIF1pabTv7vOV+/eOeVy6Tls7yZqbwS24yc99dfuf7O+f7O9s1ajiUyWSI4xxSE7APsC8wA5gOTAUmA21AE5AdcHsJ6AA2A5uAtcBq4AXgeaAdsy2EULRKpVKrOduIBA4hg1SP9FZgHjAXmAPsDdS5kCH1Hg04Bs4lfVSvj4Ey0OdgPAP8GfgTZisx67Y4rowZAAohIo4nAUcAxwDvB6YBeRdWPuGir+hLwBrgZWCjr3AX0OOrDhABE4AGoMU1ZXdgD9egZiDn15mDUvTn/gF4AHiEEDZYHJdrDoCy2UCp1AIcCSwEjgIm+oQE9AOvAMv9WAGsxGwdZkWgTBTFNDfLNm7U675r8mRj61ajUglIGaQ80lRglmvXwcC7gCkOSnDANwMPA78Cfkc2u9lKpXhEACiELHE8CzgNONlXIwtUgE7gL8CDwO8x+wch9FBfX7bOTgGovt7o6wtIkd8XIU0AGn3y6VEEOjGrakYJswqFQsV6epLnNTcbXV0RcVyPtJ9r4dFueo1AxsFYDdwJLCWElRbHpSEBILM80lxgEXCckxZAN/AnR/lezNbQ0FC0zk65sImA0l7A/sDbgJlOglNcawoDeIEB9t4P/A/Y4IK0AyuBZ4F2Qugmny9Zb6/U1GR0dWWJ42nAB4ATgUPclPBFug9YgtmTJvXvzL6zgvcJ7hJ0C2JBWfCC4CrBO2WWV1ubVUlQ0Cw4XHCp4DeC1YIeQcnv1wiP6hx6BWsFvxUsFswXtCqETNV0ZJYXzBFcIXje5yCX5S7BfIWQ277wsJvgOkGX31QS/FVwrmCKstngW10QtAlOENzgL+qrkbBDAaXPF+YmwULBRGUymSpnCSYJPi1YJiimgLhJCbm+Rvg9BI8KKo72XwWflFmzmprMzaIgmCv4vqA99dBd4Sg6GD8UzJNZAUAtLSazRsHpgqddtljwlBI+A5nlBEv9hy7BZTJrVUuLqbnZZNbgCN/rv8e7kODb04wewQOCU2TWpKYm08SJJrNmwcUpGe6UWQHBUSmb/aIymciBaRB8zNHq34WFfj2tWCY4Q07iymQiwYX+W6/gWAQ/dkSWy6zJTeJgwWO7mJoP9ygJnlTiqVYX9gn/7WYEyx2AK1RXZzKrT13wZjr+IrMGNTaa4Csu8z+Du54C/mO9vUJqBWbz5huzkKa6k7bOfY7dQuqC/ICg5M025B4sqUCsP7h3Z9sAMOt2dGoUbxok2/OuAECf/z3BZe4N7i4a0KiWFnNfurdmrz3gAPjWt2DOnASM8RtlzLr870aXuSN4FAXQRk+PuZpsrtlrd9sNFi2C22+Hiy+GadPGC4AtQEV1dQa0OgCbg4exAJOoVKqh5caavjqTgf32g8WL4bbb4LTToKlprAHYBJQplYIHZgCvBGdEAVOJ4wwhxH6u9qNQgMMOgx/9CG64AY48ErLZsQJgHWYV4jjjyRaAtcEzNvLsS5Z8vuLnRmeYQUsLLFwIS5fC1VfD7NljwQ8vks1WPDcxzYl+dQBedLufjNTqyYfnUlvG6IwQYI894Nxz4ec/h4sugqlTR+ttMdBu/f0xUoNrQAy8EDzjWvQMzUy/YZVzweiPKEp2issvh1tvhQ9/GBoaar8DJEkVXMaCy9weMFvvBJFNeYD/8qTl2I26OjjiCLj2Wrj+ejj88Fr6D30pAPZzWTsweylg1u/ppgAcpCjKEMIWB2Fshxm0tSVasHRp4j/MmlULfmjHbKNyuQC8w3OHKxNHKJ8veXJTwMFUKjmiqOi59/EZIcD06XD++XDHHXDBBfCWt4zkicsIoUiplPWMsoDl5HKlqo94koe+W5UUNRCcmsqpDf9YsEDq69OIRne3dP/90kknSfX1Q51DWXCWy7S7YJPLdWraSd5TsDn9g2CGnxt/ACQpjqVNm6SlS6VDD5VCGOwcOgRvdZlO8IXuUFK6I7jtveIlpwiYryjKODk+vcvEcmYwcSJ89KMJP5xzzmC54RnMVntS90iX8VlCWPcqAHV1ReAht42jqFTqaWwsAvfWNDIccTwn6OyEFSvgb39L/t95BHgf9fX9lMt1XtECeIhcrn/glYd4nqxPScUFwWxXl/E3gb4+6fHHpTPOkFpaBvv+LsE7XZZ5nvvs06tAvKYaNEGwwlNF1yiKghca7h1XAMpladUqafFiafr0ob7/EZkVlMsFL5bEglXV3OdrAUgu+qZf9G+ZtThynxjRbjBcAOJYevll6brrpIMOksyGw/7nqbW1Whv4x7bF9SLP9gzm3a42RcGH/NwUwYtjBkAcSx0d0q9/LR17rJTPD1f71lYrQILjPLXfIzh0x4yRVH8e9AfcrRByXma6atgFkaEA0N8vPfWUdPbZUmvrSAsk31cUZbzeebuff1xmdTujzbNc5TtSBPJ2wX9HDYByWXruOenyy6W9965FCnyLkl6CKpFvdpNYpNZW2xkAEwX/dhSXKIoyXlH5ybC04PUAiGNpwwbpxhuluXOH4tzsbPVvVghZRVEQXO3nXhTs3J92MrzUC6UbldT4ERw4LC3YEQBdXdI990jHHy8VCrUsgGxR4u8jmClY77J8Y4fktx0t2NNJJBb8QFGUURRlBN8bshYMBKBYlJYtk847T5o0aTSKoz9WCJGv/rf93Pqq6zs4ABLi+7ojt0lwgAOzl+ClYQFQqUjt7dKVV0r77DOcbW0wx7qU3z/LBY8F31EUDS254D0DL7zGpvJ5E5w/JL/g6KOlNWukm2+W5s2TMpnRqv2VBV9SNhsUQpQq+q6pRrhDAyAR9nP+4G7BAgemyZspBjexyZOlY44ZThg71OMJJXVOvGWnw+f+5UHb/na0oMVr7BL8UUm/HoJDBf/bhSq/W5VEerjX97CfXyGYNNKC2nHuQZUFlyiKgrLZjOCymiRMaqP631Amk3HuutDn1StYWG3xGUk7bM6boWInxPc4MI0eKI13y8xDKc08KEV8t8osX6uy6nTBKn/hY0oanhG8zbvExkv4/wgO9Lk0C37nwrfr1RR/DQBoaDDPG3b71vhdhZDVhAnmJrJ1HITvEHxQhYK5p3pFqp/wI14ErWEyJgkqrnEAegSnq1Co8sH5nmgYK+H7BV9QFEWqrzfByR7FVgRLdtgMWQNTaHObq3pXh6Ra7b49RqRYEvxgWy9gEsKv2RbtJZ3mo9pmMTtl939X8lFENaN0g6vhaAlf8Z7GxpRnujzFB3NGPy+Z2P0CD4xid4p2T+0Mt/lER0P421LOzpQU6W0RHF9zu98hCEmg8fFUQ/U9SjrBq87TLTXWhPIA4dsEv0rx0WeG7OuPGISEeS9y8qsI7kxtjw2CJTVqtCy5aTWnhL/T39kvuFQhZBmP4eT3NZ9IRXB3Nekgszpva+8ZgfC9gitkVp9K1vzS31UUXFkzZ2cEIOQFX02B8EC1E9u3zjMFrwxD+P8KzpZZLhWd3pNa+at3mt8bYxAu8dWOPYB6hyZMMPfPD/MW/HiQSY2/C+Yrmw1qajLB/h7txa4VX61ug7tO1SpZ7UXOyPJcwnFVcvIV/OlOHKZ+wa2CPdXWZk62x/i2Gws6BReMmqNTA2LMuMu8NpWf+9I2G0405Uzfs+MBq75a8KltDk7CIRemKtTrBaeMOdsPGYRCwfzLkqddsKIT10w1NJj7Efu4Nmz2OOJnglnK5827uWf4tlf0ZzwjOMQ7PN4YQzDV1bkqxHOCU6rq6yazp2BG6lxOcKJHnlXwfqHkq7M33nA1/qxgQ2pbu0Wwb/UDJ3esMoK9BTemts1Ngs9XzecNO3wXONiDqOqndOvcuTnXifNaP1f9RO5RwXsVRYE3y/Bc3eecICsp/z7993rBF2XWPGaNJ2MKQi4XKBZnkHyKuwDP4ZM0a94P3E42+/xgvvmt1fg/EAxHJAoOvB4AAAAASUVORK5CYII="},{"id":"dearrow","name":"DeArrow","description":"Replaces sensational titles and thumbnails with community alternatives.","note":"Optional: changes titles and thumbnails. Check the project website for activation and pricing.","url":"https://dearrow.ajay.app/","logo":"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAACXBIWXMAAAEuAAABLgF7cRpNAAAAGXRFWHRTb2Z0d2FyZQB3d3cuaW5rc2NhcGUub3Jnm+48GgAACoxJREFUeJzVm3lsHNUZwH9vdr2+kz28tuM4zuUkFOcgTUgJCcRHcxQIhdL0QiFq1BZRClWltohKrZoCpVVppJZKDbSiqIA4pBYUQkICsZ0LEBDiHI4PEnBifLDeXe/Gjo/dnXn9gxg5ie15b71O259kyTvzfd/75puZ9773zXtCSslE4/PVFoO5QghxjZQsRDADmHzhLwuIAlEkUQzRiEW9EPJELCb3nztXFZpI38REBcDvr5lnYd0ppLhFwuIkzZjAYYR43cB6rqurqjmVPkKKAyAEwpNXfYuQ/AhYDYiUGQeJ5IA05JPdQceLUpYnUmE0ZQHIy6upksjfA0tSYnBsWhDi0XBQPDXeQIw7AF7vmyVCGH9FcNO4DCXHcaS8OxSqejtZA0kHQAiE17t3M0JsBSYl60AKsARym9Np/ryzc815XeWkApCfX5tjSuspJBu0lSeOeoHx9WCwvFFHSTsA7oLq2Q6Tl4EFWopXhh4Bm4LBypdVFbQC4PPVlCGsN0BMScq9K4OJ4J5QV+XfVISVA+Dz1V6HsHYCnvF4l5bhwDMlg0x3GulZDuIDJgO9JpGOAfrPxcdjejgSKX8aClVttRNUCoDfX7PEkrKaJDo7Z7qDWUvdzFrqoWShm8kF6Qhj5PQg+ukgrcciNB0M0lIXxYxbus0NRwrYHAxWPj2WkG0A/P69cy0pDgD5Oq17ijJZelsRV1f4Sc926qgCcL47zuHt7dS91sFAb9JDfRwpbw2Fql4fTWDMAEyaVJuX5rLeA2aotpib52LlxumUVeZjOMafCPafi3PwmbMc3dWJZSU1ZEfNRGJxJLLm45FOjhoAIbYYXt/KnSDWqrQiDMHimwu5cdN0XFn6d9yO9sYedvyhiUjHQDLq74VDoZVSbohdemLUAOTlVf9OwgMq1jNz07j5Z3OZtXRc/aMt8QGTXX86ReO+rmTUHw4FK3956cERA+D11qwQhtwPGHZWPVMz2fBQGe7CjGSc0kZKeOeFVg4+ewbNFCYmMBZdmihddoFTp+7IwpBPj3TuUvJnZnPnYwuv2MUDCAHLvz2NNfeVYowymoyCSyIfv/TgZRc5EMt+SECpnTV3YQYbHp5P1uQ0HSdSxqJ1haz7cSlCKwbyyz5fzUV92kUBcLv3zBRS3mtnxukyuOPXV5Pt+e9c/BDzVxewavNMLR0h5IPDf18UAIfD+YiEdDsjq747A19JllbDE8WyO6ZSVqWeokhY5fXWrBj6/XkA8vLe/AKCb9kZ8M/I5ovr/7emAmvunY17ino/ZBjyh5//P+zwfSiUsG7YNH3UVFaV/oFBmlraebf+NG/VNXG0uYXWziBWkrWJtAwH6+6fo9wfSLjN7z+UC+AE8Hhq3YaDjXaKnqJMZi/zJuUkQGtniH3v19PS3jXixWZlpLNwTgkrF19FVqbtm3gRJYsmM+9Gv2qOkCVl7HbgnwaA4bQ2ADl2WgvXFmj2up9hmhav7j/M09tr+KgtMOqd7hsY5J3jH/Ln51/nePNZ7XZWfqdEeWiUWLfC0CtgcZuK0rwb8rSdSpgWz+06wJGGj5UTl1g8zss171L7fr1WW95pmZQuV31CRbkQWwwjP782B0GlrfHizKQSnl2HjtDSllTqyv7DDRxu+EhLZ8GaQlVRn9u/aqFhmtb1gO2VFc+frOUIwOnWTznSMOIkTJndh44S6e1Tlp+5xE1mrlp+IqT5JUMKta82BbOzlZ0YQvcRHomEaVL7rrodwxCUXKN2swTGXENIrlERztNMfMLR87QFwlo6o3Hyo1ZiMfVy2bQFik+rJa8yhGCeimxOnt6wdKq1U0t+LBKmxem2gLK8f7rizRLMNCQodZs5mnl/d7RHS96OcKRXWdYzNVNVdJIBuFUknS7b2fFF9A1eVnwZF719/cqyGTnKFalcA7Dt3Rxphnb660pL7UwxI92lLOt0GTicSv5mGcCgnZSVsJCaBcncrNQWSXKz1e1JCZap5G+vAdi+rFJCIqZXoy+Zop81jsXMqQXKsolBUzXrjCgFAKA3rPdOTyv0kZmhN3KMxpQ8D55J6nlIX1TxO4KUEUMi2lRku9v1ytEOw2D5wjlaOqNRfm2Zlvy5gKKvhmg2hLSU1t0ETqsPQ0Msm1+Kd7J+BjmcudOnMKdEOb8HINymNmIIyTEDQ3yoInz2eFTLCQBXmpMNq5eT5kzuQ4nPk8vtlcu09Tqa1G6WJThmYHFMRfiT+h5i/aa2MwU+NxvX30C2ZoGjuMDHplvKSXfpD6dtJ8+piMWtuOug4XAYbwG2iXZi0KT5YFDbGYDifB+bb6/kqhlFtrIup5PypWXctX4VOVn6nWh3xwChVqXZ4/5IZGW3MxAo7/XlVR8BbJ+1ul2dzF+tPhwNx5ObzTfWXk97IEz96U/4uD3AufP9DMbi5GZm4PPkMnd6EWWzirXLYcM59bbiukopX4ULNUGJ3CsQtgFob+zh7NEoJYv0awNDFOV7KcpPvq44FlLC0d32kzABg84083m4UBKThuMl1UZq/9GinRVeKVo+iBButR8BLOSLnZ1rAnAhAN2B8jqgSaWRzuYejuxM3VQ3VUgJB545oyRrwF+G/T9kQTyn2ti+p1oInVUvU10JGvZ10dlsn9RK2B4MVr039PvzAMRczm2AUgYRHzB55ZFGBs+nZLnuuDkfjlP9hFLx1BRylG+DPR03dCF5VrXRUGsf/97SoD1JSjVmQrLjsUb6ovYlM4nYFgpVnRx+7KIqh2GIPwLKt7X1RJR/bTmZVIKUCqSE3Y+f4kydUpba4hCuBy89eFEAuroqmiRs03HizJEIzz9wnJ4u27JCSjHjFju3NnPijU9VxCWSu7u6VlzWSVy2RMbtPuhxOGMfAj4dhzJz01h7fylzV2ipJUWkY4DXtjbTVq+U8iKRj4aDVb8Y6dyIa4R8/urvI3kyGedmX+uh4nuz8E5TLkwqM9Cb4IPt7bzz0ic6fc+ecCh0k5QbRnxPR10l5s3b+4pAfDUZR4UhKL3Oy5L1RRQvmKS7lucyOpp6aNjXxbE9AWJ9WiNPczwmrx9r39GoAcidcsDvisfrAPsZzBhkudOYda2XaWWTKCjNwVOUQVqGY0TZRNyiP5qgu62f4Nk+Ohp7OHsimmT/IjvMhLlitAWSQ4y5UvTCGuFaFD6d65CR4yQjx4kz3SAxaBHrN4n1mSTGtzZ4OGFpyYpwuMp2qm+7Vtjrrf6KMNjOhYnT/wGdlinWdXdXHFURtv3aEQ5X7hKIbwJJrVG9kkg4ZTrlCtWLB839AkJY2yX4k/ZwAhGwI5Fw3RWJrOzW0tPZMeLx1M4wHNbfgSpdByeQASnEr7qDFY9JifY8XXvP0GebI/f+QEjxWxQ/rE4gex2GeU8gsFqpsDsSSW+b8/sP5Uo5cJ8U4idIUvsZyA4p64QQvwmFKl9J5q4PZ9wbJwsL92QnEs6vSdgIVAIjD/Ljx0Sy2zDEE8FgxavjvfAhUrp3OD+/ttCyrNUSKhCiHCn1FvJeznmEOIAldzscxguBQHnKS1ETtnscwOt9c7IQRhmGmA9WMZKpSAoQwsNna5JdQBrIXjAiYEUF4pSUohmshnDY/b6US1K2lWwk/gMWwhOg3Ldn7wAAAABJRU5ErkJggg=="},{"id":"ublock","name":"uBlock Origin","description":"Blocks adverts, trackers and unwanted requests using filter lists.","note":"Works best on Firefox and Firefox-based browsers. Full uBlock Origin is no longer available in Chrome; uBlock Origin Lite is a separate project.","url":"https://github.com/gorhill/uBlock","logo":"data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiIHN0YW5kYWxvbmU9Im5vIj8+CjxzdmcKICAgeG1sbnM6ZGM9Imh0dHA6Ly9wdXJsLm9yZy9kYy9lbGVtZW50cy8xLjEvIgogICB4bWxuczpjYz0iaHR0cDovL2NyZWF0aXZlY29tbW9ucy5vcmcvbnMjIgogICB4bWxuczpyZGY9Imh0dHA6Ly93d3cudzMub3JnLzE5OTkvMDIvMjItcmRmLXN5bnRheC1ucyMiCiAgIHhtbG5zOnN2Zz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciCiAgIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyIKICAgeG1sbnM6eGxpbms9Imh0dHA6Ly93d3cudzMub3JnLzE5OTkveGxpbmsiCiAgIHZlcnNpb249IjEuMSIKICAgdmlld0JveD0iMCAwIDEyOCAxMjgiCiAgIGhlaWdodD0iMTI4IgogICB3aWR0aD0iMTI4Ij4KICA8ZwogICAgIHN0eWxlPSJkaXNwbGF5OmlubGluZTtvcGFjaXR5OjEiPgogICAgPGcKICAgICAgIHN0eWxlPSJmaWxsOiM4MDAwMDA7ZmlsbC1vcGFjaXR5OjE7c3Ryb2tlOiNmZmZmZmY7c3Ryb2tlLXdpZHRoOjEuNjIxMDA3NDQ7c3Ryb2tlLWxpbmVjYXA6cm91bmQ7c3Ryb2tlLW1pdGVybGltaXQ6NDtzdHJva2Utb3BhY2l0eToxO3N0cm9rZS1kYXNoYXJyYXk6bm9uZTtkaXNwbGF5OmlubGluZSIKICAgICAgIHRyYW5zZm9ybT0ibWF0cml4KDAuNjc3ODY1NCwwLDAsMC41NjE0MTgyOCwtMjQxLjA3NTM3LC0yNDcuMjc3MTIpIiAvPgogICAgPGcKICAgICAgIHRyYW5zZm9ybT0ibWF0cml4KC0wLjY5NDUyMDMsMCwwLDAuNTYxMDk2ODcsMzc1LjAyOTY0LC0yNDcuNDI5NDcpIgogICAgICAgc3R5bGU9ImZpbGw6IzgwMDAwMDtmaWxsLW9wYWNpdHk6MTtzdHJva2U6I2ZmZmZmZjtzdHJva2Utd2lkdGg6MS42MDE5MTE3ODAwMDAwMDAwMTtzdHJva2UtbGluZWNhcDpyb3VuZDtzdHJva2UtbWl0ZXJsaW1pdDo0O3N0cm9rZS1vcGFjaXR5OjE7c3Ryb2tlLWRhc2hhcnJheTpub25lO2Rpc3BsYXk6aW5saW5lO3N0cm9rZS1saW5lam9pbjpyb3VuZCI+CiAgICAgIDxwYXRoCiAgICAgICAgIGQ9Im0gNDQ3LjgzMzc2LDY2OS4wOTkyMSBjIC04MC42MzExOSwtNTcuMDMxMTUgLTgwLjYzMTE5LC01Ny4wMzExNSAtODAuNjMxMTksLTE5OS42MDkwMyAzNC41NTYyMywwIDQ2LjA3NDk3LDAgODAuNjMxMTksLTI4LjUxNTU4IG0gMCwyMjguMTI0NjEgYyA4MC42MzEyLC01Ny4wMzExNSA4MC42MzEyLC01Ny4wMzExNSA4MC42MzEyLC0xOTkuNjA5MDMgLTM0LjU1NjIzLDAgLTQ2LjA3NDk3LDAgLTgwLjYzMTIsLTI4LjUxNTU4IgogICAgICAgICBzdHlsZT0iZmlsbDojODAwMDAwO2ZpbGwtb3BhY2l0eToxO2ZpbGwtcnVsZTpub256ZXJvO3N0cm9rZTojZmZmZmZmO3N0cm9rZS13aWR0aDoxLjYwMTkxMTc4O3N0cm9rZS1saW5lY2FwOnJvdW5kO3N0cm9rZS1saW5lam9pbjpyb3VuZDtzdHJva2UtbWl0ZXJsaW1pdDo0O3N0cm9rZS1vcGFjaXR5OjE7c3Ryb2tlLWRhc2hhcnJheTpub25lIiAvPgogICAgPC9nPgogIDwvZz4KICA8ZwogICAgIHRyYW5zZm9ybT0idHJhbnNsYXRlKC0xNy44NzI1NDgsLTE3LjMyNTM1KSIKICAgICBzdHlsZT0iZGlzcGxheTppbmxpbmUiPgogICAgPGVsbGlwc2UKICAgICAgIHRyYW5zZm9ybT0ibWF0cml4KDEuMzMzMzMzNSwwLDAsMS4zMzMzMzM0LC00Mi4yOTA4NjIsLTMxLjEwODQ2MSkiCiAgICAgICByeT0iMTIiCiAgICAgICByeD0iMTEuOTk5OTk5IgogICAgICAgY3k9IjgxLjMyNTM1NiIKICAgICAgIGN4PSIxMDIuMTIyNTQiCiAgICAgICBzdHlsZT0iZmlsbDpub25lO3N0cm9rZTojZmZmZmZmO3N0cm9rZS13aWR0aDo1Ljk5OTk5OTUyO3N0cm9rZS1taXRlcmxpbWl0OjQ7c3Ryb2tlLW9wYWNpdHk6MTtzdHJva2UtZGFzaGFycmF5Om5vbmU7ZGlzcGxheTppbmxpbmU7IiAvPgogICAgPGcKICAgICAgIHN0eWxlPSJmaWxsOiNmZmZmZmY7ZmlsbC1vcGFjaXR5OjE7c3Ryb2tlOiNmZmZmZmY7c3Ryb2tlLXdpZHRoOjEuOTk5OTk5OTY5OTk5OTk5OTY7c3Ryb2tlLW1pdGVybGltaXQ6NDtzdHJva2Utb3BhY2l0eToxO3N0cm9rZS1kYXNoYXJyYXk6bm9uZSIKICAgICAgIHRyYW5zZm9ybT0ic2NhbGUoMS4wMDE4MDI2LDAuOTk4MjAwNjcpIj4KICAgICAgPHBhdGgKICAgICAgICAgZD0ibSA4MS43MjUyMyw4MS40NzE5NDUgYyAwLDExLjAxOTgyOCAtNC45OTEwMDMsMTYuMDI4ODQxIC0xNS45NzEyMSwxNi4wMjg4NDEgLTEwLjk4MDIwNywwIC0xNS45NzEyMSwtNS4wMDkwMTMgLTE1Ljk3MTIxLC0xNi4wMjg4NDEgbCAwLC0yNC4wNDMyNjIgNy45ODU2MDUsMCAwLDI0LjA0MzI2MiBjIDAsNy4wMTI2MTggMC45OTgyLDguMDE0NDIxIDcuOTg1NjA1LDguMDE0NDIxIDYuOTg3NDA0LDAgNy45ODU2MDUsLTEuMDAxODAzIDcuOTg1NjA1LC04LjAxNDQyMSBsIDAsLTI0LjA0MzI2MiA3Ljk4NTYwNSwwIHoiCiAgICAgICAgIHN0eWxlPSJmaWxsOiNmZmZmZmY7c3Ryb2tlOiNmZmZmZmY7c3Ryb2tlLXdpZHRoOjA7c3Ryb2tlLWxpbmVjYXA6c3F1YXJlO3N0cm9rZS1saW5lam9pbjptaXRlcjtzdHJva2UtbWl0ZXJsaW1pdDo0O3N0cm9rZS1kYXNoYXJyYXk6bm9uZTsiIC8+CiAgICA8L2c+CiAgPC9nPgo8L3N2Zz4K"}]},
    createSettingsDialog: function createSettingsDialog(document) {
  function element(tag, attributes = {}, ...children) {
    const node = document.createElement(tag);
    for (const [name, value] of Object.entries(attributes)) {
      if (value === true) node.setAttribute(name, "");
      else if (value !== false && value != null) node.setAttribute(name, String(value));
    }
    node.append(...children);
    return node;
  }
  const id = name => `ytms-${name}`;
  const button = (name, label, className = "text-button", attributes = {}) =>
    element("button", { id: id(name), type: "button", class: className, ...attributes }, label);
  const note = text => element("p", { class: "section-note" }, text);
  const row = (name, label, control, description = "", attributes = {}) =>
    element("div", { class: "row", ...attributes },
      element("label", { for: id(name) }, label,
        ...(description ? [element("span", { class: "description" }, description)] : [])), control);
  const select = (name, options) => element("select", { id: id(name) },
    ...options.map(([value, label]) => element("option", { value }, label)));
  const toggle = (name, label, description) => row(name, label,
    element("input", { id: id(name), class: "switch", type: "checkbox", role: "switch" }), description);
  const colourRow = (name, label, example) => element("div", { class: "colour-row" },
    element("label", { for: id(`${name}-hex`) }, label),
    button(`${name}-swatch`, "", "swatch", {
      "aria-label": `Choose ${name === "viewer" ? "viewer" : "uploader"} colour`,
      "aria-expanded": "false", "aria-controls": id("colour-picker"),
    }),
    element("input", {
      id: id(`${name}-hex`), class: "hex", type: "text", maxlength: "7",
      spellcheck: "false", autocomplete: "off", "aria-describedby": id(`${name}-error`),
      "aria-label": `${name === "viewer" ? "Viewer" : "Uploader"} colour hex code`,
    }),
    element("p", { class: "field-error", id: id(`${name}-error`), hidden: true },
      `Enter a six-digit hex colour, for example ${example}.`));
  const channel = name => element("div", { class: "channel" },
    element("label", { for: id(name) }, name[0].toUpperCase() + name.slice(1)),
    element("input", { id: id(name), type: "range", min: "0", max: "255", step: "1" }),
    element("output", { for: id(name), id: id(`${name}-value`) }));
  const comments = element("section", {
    id: id("section-comments"), role: "tabpanel", "aria-labelledby": id("tab-comments"),
  },
    row("colour-mode", "Name colours", select("colour-mode", [
      ["default", "Default"], ["preset", "Preset palette"], ["custom", "Custom"], ["off", "Off · YouTube styling"],
    ]), "Viewer names, uploader names and creator/pinned badges."),
    row("palette", "Palette", select("palette", [
      ["teal-coral", "Teal / coral"], ["lavender-gold", "Lavender / gold"], ["cyan-rose", "Cyan / rose"],
    ]), "Theme-adaptive colours for viewer and uploader names.", { id: id("palette-row"), hidden: true }),
    element("div", { class: "colour-rows", id: id("custom-colours"), hidden: true },
      colourRow("viewer", "Viewer name", "#82A3E6"), colourRow("owner", "Uploader and pinned badges", "#FF9F1C")),
    element("div", { class: "picker", id: id("colour-picker"), role: "group", "aria-labelledby": id("picker-title"), hidden: true },
      element("div", { class: "picker-heading" },
        element("h3", { id: id("picker-title") }, "Choose colour"), button("close-picker", "Done")),
      ...["red", "green", "blue"].map(channel),
      note("This picker is part of the panel, so it follows the same dark or light theme. No system colour dialogue opens.")),
    element("div", { class: "preview", id: id("comment-preview"), "aria-label": "Comment colour preview" },
      element("div", { class: "pin" }, "⌖ Pinned by @ChannelOwner"),
      element("span", { class: "name owner" }, "@ChannelOwner"), element("time", {}, "1 hour ago"),
      element("p", {}, "A preview of the uploader's comment."),
      element("span", { class: "name viewer" }, "@Viewer"), element("time", {}, "20 minutes ago"),
      element("p", {}, "A preview of an ordinary viewer's comment.")),
    element("p", { id: id("contrast-warning"), class: "warning", hidden: true },
      "One or both colours have low contrast against this background. Consider a different colour."),
    toggle("compactComments", "Compact spacing", "Keep the suite's current tighter comment layout."),
    toggle("hideCommentControls", "Hide comment controls", "Likes, dislikes, reply, action menu and composer. Existing replies remain readable."),
    note("Off changes name styling only. Comment-loading and navigation safeguards remain enabled."));
  return element("dialog", {
    id: id("settings-dialog"), lang: "en-GB", "aria-labelledby": id("panel-title"),
  }, element("div", { class: "panel" },
    element("div", { class: "panel-header" }, element("h2", { id: id("panel-title") }, "Suite settings"),
      button("close-panel", "×", "icon-button close", { "aria-label": "Close settings" })),
    element("nav", { role: "tablist", "aria-label": "Settings sections" }),
    element("div", { class: "content" }, comments,
      ...["feed", "channels", "player", "layout", "miniplayer", "interface", "extensions", "support", "credits"].map(name => element("section", {
        id: id(`section-${name}`), role: "tabpanel", "aria-labelledby": id(`tab-${name}`), hidden: true,
      })),
      element("p", { id: id("button-access-error"), class: "field-error", role: "alert", hidden: true }, "Keep at least one settings button enabled.")),
    element("footer", {}, button("restore-section-defaults", "Restore this section"),
      button("restore-defaults", "Restore all settings"), element("span", { class: "spacer" }),
      element("div", { class: "footer-actions" }, button("cancel-panel", "Cancel"),
        element("p", { id: id("settings-status"), role: "status", hidden: true }),
        button("save-preview", "Save", "text-button primary")))));
},
    createSettingsSupportPanel: function createSettingsSupportPanel(document, suite, hooks) {
  const node = (tag, text = '', attributes = {}) => {
    const element = document.createElement(tag);
    element.textContent = text;
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
    return element;
  };
  const button = (id, text, primary = false) => node('button', text, {
    id: `ytms-${id}`, type: 'button', class: `text-button ${primary ? 'primary' : 'outlined-button'}`,
  });
  const root = node('div', '', { class: 'support-tools' });
  const backup = node('section', '', { 'aria-labelledby': 'ytms-backup-heading' });
  const heading = node('h3', 'Backup and restore', { id: 'ytms-backup-heading' });
  const description = node('p', 'Download saved settings and channel upload filters for this browser profile. Unsaved edits are not included. The file includes channel names and IDs, so keep it private.', { class: 'section-note' });
  const exportButton = button('export-backup', 'Download backup');
  const fileLabel = node('label', 'Choose a backup to preview', { for: 'ytms-import-backup' });
  const fileInput = node('input', '', { id: 'ytms-import-backup', type: 'file', accept: '.json,application/json' });
  const fileField = node('div', '', { class: 'support-file-field' }); fileField.append(fileLabel, fileInput);
  const preview = node('div', '', { id: 'ytms-backup-preview', class: 'support-preview', hidden: '' });
  const backupStatus = node('p', '', { id: 'ytms-backup-status', class: 'section-note', role: 'status' });
  const actions = node('div', '', { class: 'support-actions' }); actions.append(exportButton);
  backup.append(heading, description, actions, fileField, preview, backupStatus);

  const troubleshooting = node('section', '', { 'aria-labelledby': 'ytms-support-heading' });
  const supportHeading = node('h3', 'Troubleshooting', { id: 'ytms-support-heading' });
  const supportNote = node('p', 'A local snapshot of module health and the last video-menu check. Reports exclude account data, video titles, URLs, channel IDs and raw error messages. Nothing is sent automatically. Timing diagnostics remain off.', { class: 'section-note' });
  const refreshButton = button('refresh-support', 'Refresh report');
  const copyButton = button('copy-support', 'Copy report');
  const supportActions = node('div', '', { class: 'support-actions' }); supportActions.append(refreshButton, copyButton);
  const summary = node('p', '', { id: 'ytms-support-summary', class: 'section-note' });
  const report = node('textarea', '', {
    id: 'ytms-support-report', readonly: '', rows: '9', spellcheck: 'false', 'aria-label': 'Privacy-safe troubleshooting report',
  });
  const supportStatus = node('p', '', { id: 'ytms-support-status', class: 'section-note', role: 'status' });
  troubleshooting.append(supportHeading, supportNote, summary, supportActions, report, supportStatus);
  root.append(backup, troubleshooting);

  let token = null;
  let updatePreview = null;
  let generation = 0;
  let downloadUrl = null;
  let downloadTimer = null;
  let disposed = false;
  function clearDownload() {
    if (downloadTimer !== null) document.defaultView.clearTimeout(downloadTimer);
    if (downloadUrl) document.defaultView.URL.revokeObjectURL(downloadUrl);
    downloadUrl = null; downloadTimer = null;
  }
  function clearPreview() {
    generation++; token = null; updatePreview = null; fileInput.value = ''; preview.replaceChildren(); preview.hidden = true;
  }
  function setBackupStatus(text, error = false) {
    backupStatus.textContent = text; backupStatus.classList.toggle('support-error', error);
  }
  function refresh() {
    const snapshot = suite.support.snapshot();
    report.value = JSON.stringify(snapshot, null, 2);
    // Descriptions are provided by the sanitising service, not page content.
    summary.textContent = snapshot.summary || 'Report refreshed. Module health describes initialisation, not every YouTube feature.';
    supportStatus.textContent = '';
    updatePreview?.();
  }
  exportButton.addEventListener('click', () => {
    const result = suite.backup.exportData();
    if (!result.ok) { setBackupStatus(result.error, true); return; }
    try {
      clearDownload();
      const view = document.defaultView;
      downloadUrl = view.URL.createObjectURL(new view.Blob([result.text], { type: 'application/json;charset=utf-8' }));
      const link = node('a', '', { href: downloadUrl, download: 'youtube-master-suite-backup.json', hidden: '' });
      root.append(link);
      try { link.click(); } finally { link.remove(); }
      downloadTimer = view.setTimeout(clearDownload, 30000);
      setBackupStatus('Backup download requested. It contains saved settings and channel filters only.');
    } catch { clearDownload(); setBackupStatus('The backup could not be downloaded. Browser file access may be restricted.', true); }
  });
  const describeValue = value => Array.isArray(value) ? value.join(', ') : typeof value === 'boolean' ? (value ? 'On' : 'Off') : String(value);
  const settingName = value => value.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, letter => letter.toUpperCase());
  function showPreview(result) {
    token = result.preview; preview.replaceChildren(); preview.hidden = false;
    const { settingChanges, filters, warning } = result.summary;
    preview.append(node('h4', 'Restore preview'), node('p', warning),
      node('p', `${settingChanges.length} ${settingChanges.length === 1 ? 'setting' : 'settings'} changed. Channel filters: ${filters.added} added, ${filters.changed} updated, ${filters.removed} removed; ${filters.total} after restore.`));
    if (settingChanges.length) {
      const details = node('details'); details.append(node('summary', 'Review setting changes'));
      const list = node('ul');
      for (const change of settingChanges) list.append(node('li', `${settingName(change.name)}: ${describeValue(change.before)} → ${describeValue(change.after)}`));
      details.append(list); preview.append(details);
    }
    const acknowledgement = node('label', '', { class: 'support-confirm' });
    const check = node('input', '', { type: 'checkbox', id: 'ytms-confirm-restore' });
    acknowledgement.append(check, document.createTextNode('Replace my saved settings and channel filters with this backup.'));
    const restore = button('restore-backup', 'Restore this backup', true); restore.disabled = true;
    const cancel = button('cancel-restore', 'Cancel restore');
    const buttons = node('div', '', { class: 'support-actions' }); buttons.append(restore, cancel);
    preview.append(acknowledgement, buttons);
    const changed = settingChanges.length || filters.added || filters.changed || filters.removed;
    const update = () => {
      const dirty = hooks.hasDraft();
      restore.disabled = !check.checked || !changed || dirty;
      if (dirty) setBackupStatus('Save or discard your settings edits before restoring a backup.', true);
      else if (!changed) setBackupStatus('This backup already matches your saved settings and channel filters.');
      else setBackupStatus('Preview only. Nothing has been changed. Restoring will not reload or interrupt playback.');
    };
    updatePreview = update;
    check.addEventListener('change', update);
    cancel.addEventListener('click', () => { clearPreview(); setBackupStatus('Restore cancelled. Nothing has been changed.'); });
    restore.addEventListener('click', () => {
      if (hooks.hasDraft()) { update(); return; }
      if (!check.checked || restore.disabled || !token) return;
      const restored = suite.backup.restore(token);
      clearPreview();
      if (!restored.ok) { setBackupStatus(restored.error, true); return; }
      hooks.onRestored(restored);
      setBackupStatus('Backup restored. Channel filters are active. Reload when ready to apply any changed settings.');
      refresh();
    });
    update();
  }
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    token = null; updatePreview = null; preview.replaceChildren(); preview.hidden = true;
    const request = ++generation;
    if (!file) return;
    if (file.size > 131072) { setBackupStatus('Choose a JSON backup no larger than 128 KiB.', true); return; }
    setBackupStatus('Reading backup for preview…');
    try {
      const text = await file.text();
      if (request !== generation || disposed) return;
      const result = suite.backup.preview(text);
      if (result.ok) showPreview(result); else setBackupStatus(result.error, true);
    } catch { if (request === generation && !disposed) setBackupStatus('The selected file could not be read.', true); }
  });
  refreshButton.addEventListener('click', refresh);
  copyButton.addEventListener('click', async () => {
    refresh();
    const request = generation;
    try {
      const clipboard = document.defaultView.navigator.clipboard;
      if (!clipboard?.writeText) throw new Error('Clipboard unavailable');
      await clipboard.writeText(report.value);
      if (!disposed && request === generation) supportStatus.textContent = 'Report copied. Review it before sharing.';
    } catch {
      if (disposed || request !== generation) return;
      report.focus(); report.select();
      supportStatus.textContent = 'Clipboard access is unavailable. The report is selected; copy it manually.';
    }
  });
  // File selection and restore acknowledgement are not unsaved preferences.
  for (const type of ['input', 'change']) root.addEventListener(type, event => event.stopPropagation());
  return Object.freeze({
    element: root,
    refresh,
    updateDraftState() { updatePreview?.(); },
    reset() {
      disposed = false; clearPreview(); setBackupStatus('');
      report.value = ''; summary.textContent = ''; supportStatus.textContent = '';
    },
    close() { disposed = true; clearPreview(); clearDownload(); },
  });
},
  };
  suite.backup = (function createSuiteBackup(getStorage, settings, channelAge) {
  const format = "youtube-master-suite-backup";
  const limit = 128 * 1024;
  const keys = [settings.key, settings.cornerKey, channelAge.key];
  const settingNames = Object.keys(settings.defaults);
  // Version 1 backups from before this opt-in setting remain importable.
  // Keep every pre-existing field required, and still validate the new field if present.
  const requiredSettingNames = settingNames.filter(name => name !== "hideFullscreenQuickActions");
  const ruleNames = ["channelId", "name", "maxAge", "unit", "enabled", "blocked"];
  const previews = new WeakMap();
  const warning = "Restoring replaces all saved Suite settings and channel upload filters. Channel names and IDs are included; history and account data are not.";
  const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
  const clone = value => JSON.parse(JSON.stringify(value));

  function fail(message) { throw new Error(message); }

  function checkObject(value, allowed, required = allowed) {
    if (!value || typeof value !== "object" || Array.isArray(value) ||
        Object.getPrototypeOf(value) !== Object.prototype ||
        Object.keys(value).some(name => !allowed.includes(name)) ||
        required.some(name => !Object.hasOwn(value, name))) {
      fail("The backup contains missing, unknown or incompatible fields.");
    }
  }

  function checkedSettings(input, complete = true) {
    checkObject(input, settingNames, complete ? requiredSettingNames : []);
    const values = settings.validate(input);
    for (const name of Object.keys(input)) {
      if (!same(input[name], values[name])) fail(`The backup contains an invalid setting: ${name}.`);
    }
    return values;
  }

  function checkedRules(input, complete = true) {
    if (!Array.isArray(input) || input.length > 100) fail("Use a backup containing no more than 100 channel filters.");
    for (const rule of input) checkObject(rule, ruleNames, complete ? ruleNames : ["channelId", "maxAge", "unit"]);
    const rules = channelAge.validateRules(input);
    if (rules.length !== input.length) fail("The backup contains invalid or duplicate channel filters.");
    for (let index = 0; index < input.length; index += 1) {
      for (const name of Object.keys(input[index])) {
        if (!same(input[index][name], rules[index][name])) fail("The backup contains an invalid channel filter.");
      }
    }
    return rules;
  }

  function readRaw(storage) {
    return keys.map(key => storage.getItem(key));
  }

  function currentData(raw) {
    let values = settings.validate({});
    let rules = [];
    if (raw[0] !== null) {
      if (raw[0].length > 8192) fail("Saved settings are too large to back up safely.");
      const record = JSON.parse(raw[0]);
      checkObject(record, ["version", "values"]);
      if (record.version !== 1) fail("Saved settings use an unsupported version.");
      values = checkedSettings(record.values, false);
    }
    if (raw[1] !== null) values = checkedSettings({ ...values, corner: raw[1] });
    if (raw[2] !== null) {
      if (raw[2].length > 65536) fail("Saved channel filters are too large to back up safely.");
      const record = JSON.parse(raw[2]);
      checkObject(record, ["version", "rules"]);
      if (record.version !== 1) fail("Saved channel filters use an unsupported version.");
      rules = checkedRules(record.rules, false);
    }
    return { values, rules };
  }

  function frozen(value) {
    if (value && typeof value === "object") {
      Object.values(value).forEach(frozen);
      Object.freeze(value);
    }
    return value;
  }

  function summarise(previous, next) {
    const before = new Map(previous.rules.map(rule => [rule.channelId, rule]));
    const after = new Map(next.rules.map(rule => [rule.channelId, rule]));
    return frozen({
      settingChanges: settingNames.filter(name => !same(previous.values[name], next.values[name]))
        .map(name => ({ name, before: clone(previous.values[name]), after: clone(next.values[name]) })),
      filters: {
        added: next.rules.filter(rule => !before.has(rule.channelId)).length,
        changed: next.rules.filter(rule => before.has(rule.channelId) && !same(before.get(rule.channelId), rule)).length,
        removed: previous.rules.filter(rule => !after.has(rule.channelId)).length,
        total: next.rules.length,
      },
      warning,
    });
  }

  function exportData() {
    try {
      const storage = getStorage();
      const raw = readRaw(storage);
      const data = currentData(raw);
      if (!same(readRaw(storage), raw)) fail("Saved data changed while preparing the backup. Please try again.");
      const text = JSON.stringify({ format, version: 1, language: "en-GB", settings: data.values, channelFilters: data.rules }, null, 2);
      return { ok: true, text, summary: summarise(data, data) };
    } catch (error) {
      return { ok: false, error: error?.message || "The backup could not be created. Browser storage is unavailable." };
    }
  }

  function preview(text) {
    try {
      if (typeof text !== "string" || text.length > limit || !text.trim() || new TextEncoder().encode(text).length > limit) {
        fail("Choose a Suite backup no larger than 128 KiB.");
      }
      const record = JSON.parse(text);
      checkObject(record, ["format", "version", "language", "settings", "channelFilters"]);
      if (record.format !== format || record.version !== 1 || record.language !== "en-GB") {
        fail("This is not a supported YouTube Master Suite backup.");
      }
      const next = { values: checkedSettings(record.settings), rules: checkedRules(record.channelFilters) };
      const storage = getStorage();
      const raw = readRaw(storage);
      const previous = currentData(raw);
      if (!same(readRaw(storage), raw)) fail("Saved data changed while preparing the preview. Please try again.");
      const summary = summarise(previous, next);
      const token = Object.freeze({});
      previews.set(token, { next: frozen(clone(next)), raw: Object.freeze([...raw]), summary });
      return { ok: true, preview: token, summary };
    } catch (error) {
      return { ok: false, error: error?.message || "The backup could not be read. No settings were changed." };
    }
  }

  function restore(token) {
    const staged = token && typeof token === "object" ? previews.get(token) : null;
    if (!staged) return { ok: false, error: "The restore preview has expired. Select the backup again." };
    previews.delete(token);
    let storage;
    try {
      storage = getStorage();
      if (!same(readRaw(storage), staged.raw)) {
        return { ok: false, conflict: true, error: "Saved settings or channel filters changed after this preview. Preview the backup again; no changes were made." };
      }
    } catch {
      return { ok: false, error: "Browser storage is unavailable. No settings were changed." };
    }
    const desired = [JSON.stringify({ version: 1, values: staged.next.values }), staged.next.values.corner,
      JSON.stringify({ version: 1, rules: staged.next.rules })];
    const attempted = [];
    const expected = [...staged.raw];
    try {
      for (let index = 0; index < keys.length; index += 1) {
        if (!same(readRaw(storage), expected)) fail("Saved data changed during the restore.");
        if (desired[index] === staged.raw[index]) continue;
        attempted.push(index);
        storage.setItem(keys[index], desired[index]);
        expected[index] = desired[index];
      }
      if (!same(readRaw(storage), desired)) fail("Browser storage did not retain the complete backup.");
    } catch {
      for (const index of attempted.reverse()) {
        try {
          const current = storage.getItem(keys[index]);
          // Do not overwrite a concurrent third-party value while rolling back.
          if (current === staged.raw[index] || current !== desired[index]) continue;
          if (staged.raw[index] === null) storage.removeItem(keys[index]);
          else storage.setItem(keys[index], staged.raw[index]);
        } catch { /* The complete raw readback below determines rollback success. */ }
      }
      let rollbackComplete = false;
      try { rollbackComplete = same(readRaw(storage), staged.raw); } catch { /* Storage remains unavailable. */ }
      channelAge.read();
      return { ok: false, rollbackComplete, reloadRequired: !rollbackComplete,
        error: rollbackComplete
          ? "The backup could not be restored. Previous saved settings and channel filters have been restored."
          : "The restore failed and previous saved data could not be fully restored. Reload this page and review your settings and channel filters." };
    }
    channelAge.read();
    return { ok: true, values: clone(staged.next.values), rules: clone(staged.next.rules), summary: staged.summary };
  }

  return Object.freeze({ exportData, preview, restore });
})(() => window.localStorage, suite.settings, suite.channelAge);
  suite.support = (function createSuiteSupport(document, version, moduleIds) {
  const knownModules = ['commentCleaner', 'feedUiCleaner', 'miniplayerButtonRestorer', 'pageCoherence',
    'playerPreferencesLite', 'scrollMiniplayer', 'suiteSettings', 'watchLayoutCleaner'];
  const requested = new Set(Array.isArray(moduleIds) ? moduleIds.slice(0, knownModules.length) : []);
  const ids = knownModules.filter(id => requested.has(id));
  const safeVersion = typeof version === 'string' && /^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(version) ? version : 'unknown';
  const menuStates = ['not-checked', 'awaiting-menu', 'loading-menu', 'no-menu', 'not-applicable', 'recognised', 'unsupported'];

  function attribute(name) {
    try { return document.documentElement?.getAttribute(name) ?? null; }
    catch { return null; }
  }
  function marker(name, maximumLength, array = false) {
    const raw = attribute(name);
    if (raw === null) return { status: 'missing', value: null };
    if (typeof raw !== 'string' || !raw.length || raw.length > maximumLength) return { status: 'invalid', value: null };
    try {
      const value = JSON.parse(raw);
      if (!value || typeof value !== 'object' || Array.isArray(value) !== array) return { status: 'invalid', value: null };
      return { status: 'available', value };
    } catch { return { status: 'invalid', value: null }; }
  }
  const boolean = value => typeof value === 'boolean' ? value : undefined;
  const counter = (value, maximum) => Number.isSafeInteger(value) && value >= 0 && value <= maximum ? value : undefined;
  const enumeration = (value, allowed) => allowed.includes(value) ? value : 'unknown';

  function snapshot() {
    const rawHealth = marker('data-yt-master-suite', 8192);
    const healthValue = rawHealth.value || {};
    const modules = ids.map(id => {
      const states = [];
      for (const [property, status] of [['initialisedModules', 'initialised'], ['pendingModules', 'pending'], ['disabledModules', 'disabled']]) {
        if (Array.isArray(healthValue[property]) && healthValue[property].includes(id)) states.push(status);
      }
      if (Array.isArray(healthValue.failedModules) && healthValue.failedModules.some(entry => entry?.id === id)) states.push('failed');
      return { id, status: states.length === 1 ? states[0] : 'unknown' };
    });
    const health = {
      status: rawHealth.status,
      ready: boolean(healthValue.ready), healthy: boolean(healthValue.healthy),
      registeredModules: counter(healthValue.registeredModules, knownModules.length),
      expectedModules: ids.length, modules,
    };
    const rawErrors = marker('data-yt-master-runtime-errors', 32768, true);
    // The runtime retains at most 20 errors. Reject oversized/tampered lists.
    if (rawErrors.value?.length > 20) { rawErrors.status = 'invalid'; rawErrors.value = null; }
    const byModule = [...ids, 'suite'].map(id => ({ id,
      count: (rawErrors.value || []).filter(entry => entry?.module === id).length,
    }));
    const runtimeErrors = { status: rawErrors.status, total: byModule.reduce((sum, entry) => sum + entry.count, 0), byModule };
    const rawMenu = attribute('data-ytms-video-menu-compatibility');
    const videoMenu = { status: rawMenu === null ? 'not-checked' : enumeration(rawMenu, menuStates) };
    const rawCoherence = marker('data-yt-master-state', 65536);
    const state = rawCoherence.value || {};
    const coherence = {
      status: rawCoherence.status,
      identityStatus: enumeration(state.identityStatus, ['not-watch-page', 'pending', 'disagreement', 'coherent']),
      nativeLoading: boolean(state.nativeLoading), confirmedMismatch: boolean(state.confirmedMismatch),
      confirmedCoherent: boolean(state.confirmedCoherent), commentsHiddenAsStale: boolean(state.commentsHiddenAsStale),
      confirmedStaleComments: boolean(state.confirmedStaleComments), mismatchChecks: counter(state.mismatchChecks, 1000),
      loadingRecoveryStatus: enumeration(state.loadingRecoveryStatus, ['not-attempted', 'attempted', 'pending', 'completed', 'failed']),
    };
    const healthSummary = health.status === 'missing' ? 'Module health has not been reported.' :
      health.status === 'invalid' ? 'Module health information is unavailable.' :
        `${modules.filter(entry => entry.status === 'initialised').length} of ${ids.length} modules report initialised.`;
    const menuSummary = {
      'not-checked': 'Video-menu compatibility has not been checked.',
      'awaiting-menu': 'Waiting for the selected video menu.',
      'loading-menu': 'The selected video menu is still loading.',
      'no-menu': 'No video menu appeared before the compatibility check ended.',
      'not-applicable': 'The last opened menu was not an applicable video menu.',
      recognised: 'The last video menu layout was recognised.',
      unsupported: 'The last video menu could not be safely recognised; its native actions were left unchanged.',
      unknown: 'Video-menu compatibility information is unavailable.',
    }[videoMenu.status];
    return { schemaVersion: 1, language: 'en-GB', version: safeVersion, summary: `${healthSummary} ${menuSummary}`,
      health, runtimeErrors, videoMenu, coherence };
  }
  return Object.freeze({ snapshot, report: () => JSON.stringify(snapshot(), null, 2) });
})(document, MASTER_VERSION, STYLE_ORDER);

  installDiagnostics();

  suite.registerModule(
    "commentCleaner",
    "Comment Cleaner v1.26",
    "document-idle",
    () => {
      const MutationObserver = suite.SharedMutationObserver;
      const GM_addStyle = (css) => suite.setStyle("commentCleaner", css);

      "use strict";

        const CONFIG = {
          hideCommentControls: true,
          colourCommenters: true,
          compactComments: true,
          commenterColour: "#82a3e6",
          uploaderColour: "#ff9f1c",
        };
        Object.assign(CONFIG, suite.settings.overrides("commentCleaner", CONFIG));
        const COMMENTER_BLUE = CONFIG.commenterColour;
        const UPLOADER_ORANGE = CONFIG.uploaderColour;

        const COMMENT_CONTROL_SELECTORS = [
          "ytd-comment-renderer ytd-comment-engagement-bar#action-buttons",
          "ytd-comment-renderer #like-button",
          "ytd-comment-renderer #dislike-button",
          "ytd-comment-renderer #vote-count-left",
          "ytd-comment-renderer #vote-count-middle",
          "ytd-comment-renderer like-button-view-model",
          "ytd-comment-renderer dislike-button-view-model",
          "ytd-comment-renderer #reply-button-end",
          "ytd-comment-renderer #action-menu",
          "ytd-comment-renderer ytd-menu-renderer",
          "ytd-comment-view-model ytd-comment-engagement-bar#action-buttons",
          "ytd-comment-view-model #like-button",
          "ytd-comment-view-model #dislike-button",
          "ytd-comment-view-model #vote-count-left",
          "ytd-comment-view-model #vote-count-middle",
          "ytd-comment-view-model like-button-view-model",
          "ytd-comment-view-model dislike-button-view-model",
          "ytd-comment-view-model #reply-button-end",
          "ytd-comment-view-model #action-menu",
          "ytd-comment-view-model ytd-menu-renderer",
          "yt-comment-view-model ytd-comment-engagement-bar#action-buttons",
          "yt-comment-view-model #like-button",
          "yt-comment-view-model #dislike-button",
          "yt-comment-view-model #vote-count-left",
          "yt-comment-view-model #vote-count-middle",
          "yt-comment-view-model like-button-view-model",
          "yt-comment-view-model dislike-button-view-model",
          "yt-comment-view-model #reply-button-end",
          "yt-comment-view-model #action-menu",
          "yt-comment-view-model ytd-menu-renderer",
          "ytd-comments #reply-dialog",
          "ytd-comments #simple-box",
          "ytd-comments #teaser-carousel",
          "ytd-comment-renderer #reply-dialog",
          "ytd-comment-renderer #simple-box",
          "ytd-comment-renderer #teaser-carousel",
          "ytd-comment-view-model #reply-dialog",
          "ytd-comment-view-model #simple-box",
          "ytd-comment-view-model #teaser-carousel",
          "yt-comment-view-model #reply-dialog",
          "yt-comment-view-model #simple-box",
          "yt-comment-view-model #teaser-carousel",
        ];

        const COMMENT_CONTROL_SELECTOR = COMMENT_CONTROL_SELECTORS.join(",");

        const COMMENT_OVERFLOW_BUTTON_SELECTORS = [
          'ytd-comment-renderer yt-icon-button > button#button[aria-label*="Action menu" i]',
          'ytd-comment-renderer yt-icon-button > button#button[aria-label*="More actions" i]',
          'ytd-comment-renderer yt-icon-button > button#button[aria-label*="More options" i]',
          'ytd-comment-view-model yt-icon-button > button#button[aria-label*="Action menu" i]',
          'ytd-comment-view-model yt-icon-button > button#button[aria-label*="More actions" i]',
          'ytd-comment-view-model yt-icon-button > button#button[aria-label*="More options" i]',
          'yt-comment-view-model yt-icon-button > button#button[aria-label*="Action menu" i]',
          'yt-comment-view-model yt-icon-button > button#button[aria-label*="More actions" i]',
          'yt-comment-view-model yt-icon-button > button#button[aria-label*="More options" i]',
        ];

        const COMMENT_OVERFLOW_BUTTON_SELECTOR =
          COMMENT_OVERFLOW_BUTTON_SELECTORS.join(",");

        const COMMENT_AUTHOR_SELECTOR = `
          ytd-comments a[href^="/@"],
          ytd-comments a[href^="https://www.youtube.com/@"]
        `;
        const COMMENT_PERMALINK_LINK_SELECTOR =
          'a[href*="/watch?"][href*="lc="], a[href*="youtube.com/watch?"][href*="lc="]';
        const STALE_COMMENTS_ATTRIBUTE = "data-iow-stale-video";
        const SCROLL_PLAYER_PLACEHOLDER_ID = "ytsmp-player-placeholder";
        const COMMENT_RENDERER_SELECTOR = [
          "ytd-comment-thread-renderer",
          "ytd-comment-renderer",
          "ytd-comment-view-model",
          "yt-comment-view-model",
        ].join(",");
        const COMMENTS_VIDEO_GUARD_CHECK_DELAYS_MS = [600, 1600, 3200, 6400];
        const COMMENTS_VIDEO_GUARD_FAIL_OPEN_DELAY_MS = 8000;

        const COMMENT_MUTATION_SURFACE_SELECTOR = [
          "ytd-comments",
          "ytd-comments-header-renderer",
          "ytd-comment-thread-renderer",
          "ytd-comment-renderer",
          "ytd-comment-view-model",
          "yt-comment-view-model",
          "ytd-comment-replies-renderer",
        ].join(",");
        const UPLOADER_SOURCE_SELECTOR = [
          "ytd-watch-metadata #owner",
          "ytd-watch-flexy ytd-video-owner-renderer",
          "ytd-watch-flexy #upload-info",
        ].join(",");
        const UPLOADER_PATHS_FALLBACK_DELAY_MS = 3000;

        let scheduled = false;
        let delayedScheduled = false;
        const pendingApplyRoots = new Set();
        let lastVideoKey = "";
        let cachedUploaderPaths = new Set();
        let uploaderPathsReadyVideoKey = "";
        let uploaderPathsFallbackTimer = 0;
        let observing = false;
        let commentsVideoGuardPending = false;
        let commentsVideoGuardSawFreshContainer = false;
        let commentsVideoGuardGeneration = 0;
        let commentsVideoGuardSourceVideoId = "";
        let commentsVideoGuardDestinationVideoId = "";
        let commentsVideoGuardTrackedVideoId = "";
        let commentsVideoGuardFailOpenVideoId = "";
        let preNavigationCommentNodes = new Set();
        const pendingStaleCommentContainers = new Set();
        const commentsVideoGuardRecoveryTimers = new Map();
        const commentsVideoGuardScheduledDelays = new Set();

        const isWatchPath = () =>
          location.pathname === "/watch" || location.pathname.startsWith("/live/");

        const collectDeepQueryScopes = (root = document) => {
          const scopes = [];
          const crawl = (node) => {
            if (!node || !node.querySelectorAll) return;
            scopes.push(node);
            node.querySelectorAll("*").forEach((el) => {
              if (el.shadowRoot) crawl(el.shadowRoot);
            });
          };

          crawl(root);
          return scopes;
        };

        const queryAllDeep = (
          sel,
          root = document,
          scopes = collectDeepQueryScopes(root),
        ) => {
          const out = [];
          scopes.forEach((node) => {
            if (node.matches && node.matches(sel)) out.push(node);
            node.querySelectorAll(sel).forEach((n) => out.push(n));
          });
          return out;
        };

        const normalisePath = (href) => {
          if (!href) return "";

          try {
            return new URL(href, location.origin).pathname.toLowerCase();
          } catch {
            return href.toLowerCase();
          }
        };

        const getText = (el) => {
          return el ? el.textContent.replace(/\s+/g, " ").trim() : "";
        };

        const getVideoKey = () => {
          const url = new URL(location.href);
          return `${url.pathname}?v=${url.searchParams.get("v") || ""}`;
        };

        const getCurrentVideoId = () => {
          const url = new URL(location.href);
          if (url.pathname === "/watch") {
            return url.searchParams.get("v") || "";
          }
          if (url.pathname.startsWith("/live/")) {
            return url.pathname.split("/")[2] || "";
          }
          return "";
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

        const readPlayerVideoId = (player) => {
          try {
            return player?.getVideoData?.()?.video_id || "";
          } catch {
            return "";
          }
        };

        const getActivePlayer = () => {
          const players = Array.from(
            document.querySelectorAll('[id="movie_player"]'),
          );
          const renderedPlayers = players.filter(isRenderedElement);
          const currentVideoId = getCurrentVideoId();

          return (
            renderedPlayers.find(
              (player) => readPlayerVideoId(player) === currentVideoId,
            ) ||
            renderedPlayers[0] ||
            players.find(
              (player) =>
                player.isConnected && readPlayerVideoId(player) === currentVideoId,
            ) ||
            players.find((player) => player.isConnected) ||
            null
          );
        };

        const getPlayerVideoId = () => readPlayerVideoId(getActivePlayer());

        const getFlexyVideoId = (flexy, urlVideoId = "", playerVideoId = "") => {
          try {
            const dataVideoId =
              flexy?.data?.playerResponse?.videoDetails?.videoId || "";
            const attributeVideoId = flexy?.getAttribute("video-id") || "";
            const watchResponseVideoId =
              flexy?.data?.currentVideoEndpoint?.watchEndpoint?.videoId || "";
            if (
              flexy?.loading === false &&
              watchResponseVideoId &&
              flexy.videoId === watchResponseVideoId &&
              urlVideoId === watchResponseVideoId &&
              playerVideoId === watchResponseVideoId
            ) return watchResponseVideoId;

            if (
              dataVideoId &&
              attributeVideoId &&
              dataVideoId !== attributeVideoId &&
              urlVideoId &&
              urlVideoId === playerVideoId
            ) {
              if (attributeVideoId === urlVideoId) return attributeVideoId;
              if (dataVideoId === urlVideoId) return dataVideoId;
            }

            return dataVideoId || attributeVideoId;
          } catch {
            return "";
          }
        };

        const isRenderedWatchFlexy = (flexy) => isRenderedElement(flexy);

        const getActiveWatchFlexy = () => {
          const playerFlexy = getActivePlayer()?.closest("ytd-watch-flexy");
          if (isRenderedWatchFlexy(playerFlexy)) return playerFlexy;

          const placeholderFlexy = document
            .getElementById(SCROLL_PLAYER_PLACEHOLDER_ID)
            ?.closest("ytd-watch-flexy");
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

        const destinationVideoIdentityIsCoherent = (destinationVideoId) => {
          const currentVideoId = getCurrentVideoId();
          const playerVideoId = getPlayerVideoId();
          const flexyVideoId = getFlexyVideoId(
            getActiveWatchFlexy(),
            currentVideoId,
            playerVideoId,
          );
          return Boolean(
            destinationVideoId &&
              currentVideoId === destinationVideoId &&
              playerVideoId &&
              flexyVideoId &&
              currentVideoId === playerVideoId &&
              playerVideoId === flexyVideoId,
          );
        };

        const getCommentsVideoIds = (comments) => {
          const videoIds = new Set();
          if (!comments) return videoIds;

          for (const link of comments.querySelectorAll(COMMENT_PERMALINK_LINK_SELECTOR)) {
            const publishedTime = link.matches?.("#published-time-text")
              ? link
              : link.closest?.("#published-time-text");
            if (!publishedTime || !link.closest?.(COMMENT_RENDERER_SELECTOR)) {
              continue;
            }

            try {
              const videoId = new URL(
                link.href || link.getAttribute("href"),
                location.origin,
              ).searchParams.get("v");
              if (videoId) videoIds.add(videoId);
            } catch {}
          }
          return videoIds;
        };

        const getCommentContainers = (root = document) => {
          const containers = new Set();
          if (!root || !root.querySelectorAll) return containers;

          if (root.matches?.("ytd-comments")) containers.add(root);
          root.querySelectorAll("ytd-comments").forEach((comments) =>
            containers.add(comments),
          );
          const closestComments = root.closest?.("ytd-comments");
          if (closestComments) containers.add(closestComments);
          return containers;
        };

        const getRenderedCommentNodes = (comments) =>
          new Set(comments.querySelectorAll(COMMENT_RENDERER_SELECTOR));

        const cancelCommentsVideoGuardRecovery = () => {
          commentsVideoGuardRecoveryTimers.forEach((timerId) =>
            clearTimeout(timerId),
          );
          commentsVideoGuardRecoveryTimers.clear();
          commentsVideoGuardScheduledDelays.clear();
        };

        const clearDisconnectedPendingCommentContainers = () => {
          pendingStaleCommentContainers.forEach((comments) => {
            if (!comments.isConnected) pendingStaleCommentContainers.delete(comments);
          });
        };

        const finishCommentsVideoGuardIfComplete = () => {
          clearDisconnectedPendingCommentContainers();
          if (
            !commentsVideoGuardSawFreshContainer ||
            pendingStaleCommentContainers.size
          ) {
            return false;
          }

          commentsVideoGuardPending = false;
          commentsVideoGuardSawFreshContainer = false;
          commentsVideoGuardSourceVideoId = "";
          commentsVideoGuardDestinationVideoId = "";
          commentsVideoGuardTrackedVideoId = getCurrentVideoId();
          commentsVideoGuardFailOpenVideoId = "";
          preNavigationCommentNodes = new Set();
          cancelCommentsVideoGuardRecovery();
          return true;
        };

        const preNavigationCommentNodesAreDetached = (comments) => {
          return Array.from(preNavigationCommentNodes).every(
            (node) => !node.isConnected || !comments.contains(node),
          );
        };

        const preNavigationCommentNodesMatchDestination = (
          comments,
          destinationVideoId,
        ) => {
          return Array.from(preNavigationCommentNodes).every((node) => {
            if (!node.isConnected || !comments.contains(node)) return true;

            const nodeVideoIds = getCommentsVideoIds(node);
            return Boolean(
              destinationVideoId &&
                nodeVideoIds.size &&
                Array.from(nodeVideoIds).every(
                  (videoId) => videoId === destinationVideoId,
                ),
            );
          });
        };

        const guardCommentsAsStale = (comments) => {
          comments.setAttribute(STALE_COMMENTS_ATTRIBUTE, "1");
          pendingStaleCommentContainers.add(comments);
          commentsVideoGuardPending = true;
        };

        const releaseCommentsVideoGuardAfterTimeout = (destinationVideoId) => {
          if (!destinationVideoId || getCurrentVideoId() !== destinationVideoId) {
            return false;
          }

          commentsVideoGuardPending = false;
          commentsVideoGuardSawFreshContainer = false;
          commentsVideoGuardSourceVideoId = "";
          commentsVideoGuardDestinationVideoId = "";
          commentsVideoGuardTrackedVideoId = destinationVideoId;
          commentsVideoGuardFailOpenVideoId = destinationVideoId;
          preNavigationCommentNodes = new Set();
          pendingStaleCommentContainers.clear();
          getCommentContainers(document).forEach((comments) =>
            comments.removeAttribute(STALE_COMMENTS_ATTRIBUTE),
          );
          cancelCommentsVideoGuardRecovery();
          return true;
        };

        const resetCommentsVideoGuard = (
          trackedVideoId = getCurrentVideoId(),
        ) => {
          commentsVideoGuardGeneration += 1;
          cancelCommentsVideoGuardRecovery();
          commentsVideoGuardPending = false;
          commentsVideoGuardSawFreshContainer = false;
          commentsVideoGuardSourceVideoId = "";
          commentsVideoGuardDestinationVideoId = "";
          commentsVideoGuardTrackedVideoId = trackedVideoId;
          commentsVideoGuardFailOpenVideoId = "";
          preNavigationCommentNodes = new Set();
          pendingStaleCommentContainers.clear();
          getCommentContainers(document).forEach((comments) =>
            comments.removeAttribute(STALE_COMMENTS_ATTRIBUTE),
          );
        };

        const bindCommentsVideoGuardDestination = () => {
          if (!commentsVideoGuardPending || !isWatchPath()) return "";

          const currentVideoId = getCurrentVideoId();
          if (!currentVideoId) return "";

          if (
            commentsVideoGuardSourceVideoId === currentVideoId &&
            destinationVideoIdentityIsCoherent(currentVideoId)
          ) {
            resetCommentsVideoGuard();
            return currentVideoId;
          }

          if (!commentsVideoGuardDestinationVideoId) {
            commentsVideoGuardDestinationVideoId = currentVideoId;
          }
          return commentsVideoGuardDestinationVideoId === currentVideoId
            ? currentVideoId
            : "";
        };

        const scheduleCommentsVideoGuardRecovery = () => {
          if (!commentsVideoGuardPending || !isWatchPath()) return;

          const generation = commentsVideoGuardGeneration;
          const failOpenDelay = COMMENTS_VIDEO_GUARD_FAIL_OPEN_DELAY_MS;
          if (!commentsVideoGuardScheduledDelays.has(failOpenDelay)) {
            commentsVideoGuardScheduledDelays.add(failOpenDelay);
            const timerId = setTimeout(() => {
              commentsVideoGuardRecoveryTimers.delete(failOpenDelay);
              if (
                generation !== commentsVideoGuardGeneration ||
                !commentsVideoGuardPending
              ) return;

              if (!isWatchPath() || !getCurrentVideoId()) {
                resetCommentsVideoGuard();
                return;
              }

              // A missing finish event must not leave an unbound guard permanent.
              // A newly discovered later destination receives its own deadline.
              alignCommentsVideoGuardToCurrentUrl();
              if (generation !== commentsVideoGuardGeneration) return;
              releaseCommentsVideoGuardAfterTimeout(getCurrentVideoId());
            }, failOpenDelay);
            commentsVideoGuardRecoveryTimers.set(failOpenDelay, timerId);
          }

          const destinationVideoId = commentsVideoGuardDestinationVideoId;
          if (
            !destinationVideoId ||
            getCurrentVideoId() !== destinationVideoId
          ) {
            return;
          }

          COMMENTS_VIDEO_GUARD_CHECK_DELAYS_MS.forEach((delay) => {
            if (commentsVideoGuardScheduledDelays.has(delay)) return;

            commentsVideoGuardScheduledDelays.add(delay);
            const timerId = setTimeout(() => {
              commentsVideoGuardRecoveryTimers.delete(delay);
              if (
                generation !== commentsVideoGuardGeneration ||
                !commentsVideoGuardPending ||
                !isWatchPath() ||
                getCurrentVideoId() !== destinationVideoId
              ) {
                return;
              }

              syncCommentsVideoGuard();
            }, delay);
            commentsVideoGuardRecoveryTimers.set(delay, timerId);
          });
        };

        const beginCommentsVideoGuard = ({
          sourceVideoId = commentsVideoGuardTrackedVideoId || getCurrentVideoId(),
          destinationVideoId = "",
        } = {}) => {
          commentsVideoGuardGeneration += 1;
          cancelCommentsVideoGuardRecovery();
          commentsVideoGuardPending = true;
          commentsVideoGuardSawFreshContainer = false;
          commentsVideoGuardSourceVideoId = sourceVideoId;
          commentsVideoGuardDestinationVideoId = destinationVideoId;
          commentsVideoGuardFailOpenVideoId = "";
          preNavigationCommentNodes = new Set();
          pendingStaleCommentContainers.clear();
          getCommentContainers(document).forEach((comments) => {
            getRenderedCommentNodes(comments).forEach((node) =>
              preNavigationCommentNodes.add(node),
            );
            comments.setAttribute(STALE_COMMENTS_ATTRIBUTE, "1");
            pendingStaleCommentContainers.add(comments);
          });
          scheduleCommentsVideoGuardRecovery();
        };

        const markCurrentCommentsStale = () => beginCommentsVideoGuard();

        const alignCommentsVideoGuardToCurrentUrl = () => {
          const currentVideoId = getCurrentVideoId();
          if (!currentVideoId) return false;
          if (!commentsVideoGuardTrackedVideoId) {
            commentsVideoGuardTrackedVideoId = currentVideoId;
            return false;
          }
          if (currentVideoId === commentsVideoGuardTrackedVideoId) return false;

          if (
            commentsVideoGuardPending &&
            !commentsVideoGuardDestinationVideoId
          ) {
            commentsVideoGuardDestinationVideoId = currentVideoId;
            return true;
          }

          if (
            commentsVideoGuardPending &&
            commentsVideoGuardDestinationVideoId === currentVideoId
          ) {
            return false;
          }

          beginCommentsVideoGuard({
            sourceVideoId: commentsVideoGuardTrackedVideoId,
            destinationVideoId: currentVideoId,
          });
          return true;
        };

        const syncCommentsVideoGuard = (root = document) => {
          const currentVideoId = getCurrentVideoId();
          if (!currentVideoId) {
            resetCommentsVideoGuard();
            return;
          }

          alignCommentsVideoGuardToCurrentUrl();

          if (commentsVideoGuardFailOpenVideoId === currentVideoId) {
            getCommentContainers(document).forEach((comments) =>
              comments.removeAttribute(STALE_COMMENTS_ATTRIBUTE),
            );
            return;
          }

          getCommentContainers(root).forEach((comments) => {
            const commentsVideoIds = getCommentsVideoIds(comments);
            if (!commentsVideoIds.size) {
              const guarded =
                commentsVideoGuardPending ||
                pendingStaleCommentContainers.has(comments) ||
                comments.getAttribute(STALE_COMMENTS_ATTRIBUTE) === "1";
              if (!guarded) return;

              if (
                destinationVideoIdentityIsCoherent(
                  commentsVideoGuardDestinationVideoId,
                ) &&
                preNavigationCommentNodesAreDetached(comments)
              ) {
                comments.removeAttribute(STALE_COMMENTS_ATTRIBUTE);
                pendingStaleCommentContainers.delete(comments);
                commentsVideoGuardSawFreshContainer = true;
              } else {
                guardCommentsAsStale(comments);
              }
              return;
            }

            const expectedVideoId = commentsVideoGuardPending
              ? commentsVideoGuardDestinationVideoId
              : currentVideoId;
            const stale =
              !expectedVideoId ||
              currentVideoId !== expectedVideoId ||
              !preNavigationCommentNodesMatchDestination(
                comments,
                expectedVideoId,
              ) ||
              Array.from(commentsVideoIds).some(
                (commentsVideoId) => commentsVideoId !== expectedVideoId,
              );
            comments.toggleAttribute(STALE_COMMENTS_ATTRIBUTE, stale);
            if (stale) {
              if (!commentsVideoGuardPending) {
                beginCommentsVideoGuard({
                  sourceVideoId: "",
                  destinationVideoId: currentVideoId,
                });
              }
              guardCommentsAsStale(comments);
            } else {
              pendingStaleCommentContainers.delete(comments);
              commentsVideoGuardSawFreshContainer = true;
            }
          });

          finishCommentsVideoGuardIfComplete();
          if (commentsVideoGuardPending) scheduleCommentsVideoGuardRecovery();
        };

        const clearUploaderPathsFallback = () => {
          if (!uploaderPathsFallbackTimer) return;

          clearTimeout(uploaderPathsFallbackTimer);
          uploaderPathsFallbackTimer = 0;
        };

        const invalidateCachedUploaderPaths = () => {
          lastVideoKey = "";
          cachedUploaderPaths = new Set();
        };

        const invalidateUploaderPaths = () => {
          clearUploaderPathsFallback();
          invalidateCachedUploaderPaths();
          uploaderPathsReadyVideoKey = "";
        };

        const markUploaderPathsReady = () => {
          clearUploaderPathsFallback();
          lastVideoKey = "";
          cachedUploaderPaths = new Set();
          uploaderPathsReadyVideoKey = getVideoKey();
        };

        const readUploaderPaths = () => {
          const paths = new Set();

          document
            .querySelectorAll(
              `
            ytd-watch-metadata #owner a[href^="/@"],
            ytd-watch-flexy ytd-video-owner-renderer a[href^="/@"],
            ytd-watch-flexy #upload-info a[href^="/@"]
          `,
            )
            .forEach((a) => {
              const path = normalisePath(a.getAttribute("href"));
              if (path.startsWith("/@")) paths.add(path);
            });

          document
            .querySelectorAll(
              `
            ytd-pinned-comment-badge-renderer,
            #pinned-comment-badge
          `,
            )
            .forEach((el) => {
              const matches = getText(el).match(/@[A-Za-z0-9._-]+/g) || [];

              matches.forEach((handle) => {
                paths.add("/" + handle.toLowerCase());
              });
            });

          return paths;
        };

        const getUploaderPaths = () => {
          const videoKey = getVideoKey();

          if (videoKey !== lastVideoKey || !cachedUploaderPaths.size) {
            lastVideoKey = videoKey;
            cachedUploaderPaths = readUploaderPaths();
          }

          return cachedUploaderPaths;
        };

        const setLinkColour = (link, colour) => {
          if (link.dataset.iowColour !== colour) {
            link.style.setProperty("color", colour, "important");
            link.style.setProperty("-webkit-text-fill-color", colour, "important");
            link.style.setProperty("font-weight", "700", "important");
            link.style.setProperty("opacity", "1", "important");
            link.dataset.iowColour = colour;
          }

          link
            .querySelectorAll(
              "span, yt-formatted-string, yt-attributed-string, .yt-core-attributed-string",
            )
            .forEach((child) => {
              child.style.setProperty("color", colour, "important");
              child.style.setProperty("-webkit-text-fill-color", colour, "important");
              child.style.setProperty("font-weight", "700", "important");
              child.style.setProperty("opacity", "1", "important");
            });
        };

        const colourCommentAuthorLinks = (root = document, queryScopes) => {
          if (uploaderPathsReadyVideoKey !== getVideoKey()) return;

          const uploaderPaths = getUploaderPaths();

          queryAllDeep(COMMENT_AUTHOR_SELECTOR, root, queryScopes).forEach((link) => {
            const path = normalisePath(link.getAttribute("href"));
            const colour = uploaderPaths.has(path) ? UPLOADER_ORANGE : COMMENTER_BLUE;

            setLinkColour(link, colour);
          });
        };

        const hideNode = (el) => {
          if (el.dataset.iowHidden === "1") return;

          el.setAttribute("hidden", "");
          el.style.setProperty("display", "none", "important");
          el.style.setProperty("margin", "0", "important");
          el.style.setProperty("padding", "0", "important");
          el.style.setProperty("height", "0", "important");
          el.style.setProperty("min-height", "0", "important");
          el.dataset.iowHidden = "1";
        };

        const hideCommentControls = (root = document, queryScopes) => {
          queryAllDeep(COMMENT_CONTROL_SELECTOR, root, queryScopes).forEach(hideNode);

          queryAllDeep(COMMENT_OVERFLOW_BUTTON_SELECTOR, root, queryScopes).forEach((button) => {
            const rootNode = button.getRootNode && button.getRootNode();
            const shadowHost =
              rootNode && rootNode.host && rootNode.host.matches("yt-icon-button")
                ? rootNode.host
                : null;
            const host = button.closest("yt-icon-button") || shadowHost;

            hideNode(host || button);
          });
        };

        const applyAll = (root = document) => {
          if (!isWatchPath()) return;

          const applyRoot =
            root === document ? document.querySelector("ytd-comments") || root : root;
          // Share discovery only for this synchronous pass; later passes must find
          // newly stamped comments and open shadow roots. Preserve the uploader wait.
          const queryScopes = (
            CONFIG.hideCommentControls ||
            (CONFIG.colourCommenters && uploaderPathsReadyVideoKey === getVideoKey())
          )
            ? collectDeepQueryScopes(applyRoot)
            : [];

          if (CONFIG.hideCommentControls) hideCommentControls(applyRoot, queryScopes);
          if (CONFIG.colourCommenters) colourCommentAuthorLinks(applyRoot, queryScopes);
        };

        const buildHideRule = (selectors) => `
      ${selectors.join(",\n")} {
        display:none !important;
        margin:0 !important;
        padding:0 !important;
        height:0 !important;
        min-height:0 !important;
      }
      `;

        const buildBaseCss = () => `
      /* Shared colours */
      :root {
        --commenter-blue: ${COMMENTER_BLUE};
        --uploader-orange: ${UPLOADER_ORANGE};
      }

      ${CONFIG.compactComments ? `/* Compact comments header */
      ytd-comments-header-renderer {
        margin-top:2px !important;
        margin-bottom:2px !important;
      }
      ` : ""}

      /* Keep stale SPA comments out of view without collapsing YouTube's lazy-load area. */
      ytd-comments[${STALE_COMMENTS_ATTRIBUTE}="1"] {
        visibility:hidden !important;
        opacity:0 !important;
        pointer-events:none !important;
      }
      `;

        const buildCommentControlsCss = () => {
          return CONFIG.hideCommentControls
            ? `/* Collapse engagement/action areas */${buildHideRule(COMMENT_CONTROL_SELECTORS)}
      /* Hide per-comment overflow buttons */${buildHideRule(COMMENT_OVERFLOW_BUTTON_SELECTORS)}`
            : "";
        };

        const buildCompactCommentsCss = () => {
          if (!CONFIG.compactComments) return "";

          return `
      /* Tighten comment spacing */
      ytd-comment-renderer #main,
      ytd-comment-view-model #main,
      yt-comment-view-model #main {
        margin:0 !important;
      }

      ytd-comment-renderer #body,
      ytd-comment-view-model #body,
      yt-comment-view-model #body {
        margin:0 !important;
        padding:0 !important;
      }

      ytd-comment-renderer #footer,
      ytd-comment-view-model #footer,
      yt-comment-view-model #footer {
        margin:0 !important;
        padding:0 !important;
      }
      `;
        };

        const buildColourCommentsCss = () => {
          if (!CONFIG.colourCommenters) return "";

          return `
      /* All normal commenter/channel links inside comments: blue */
      ytd-comments a[href^="/@"],
      ytd-comments a[href^="https://www.youtube.com/@"] {
        color:var(--commenter-blue) !important;
        -webkit-text-fill-color:var(--commenter-blue) !important;
        font-weight:700 !important;
        opacity:1 !important;
      }

      /* Pinned-by line: orange */
      ytd-pinned-comment-badge-renderer,
      ytd-pinned-comment-badge-renderer a,
      ytd-pinned-comment-badge-renderer yt-formatted-string,
      ytd-comment-renderer #pinned-comment-badge,
      ytd-comment-renderer #pinned-comment-badge a,
      ytd-comment-renderer #pinned-comment-badge yt-formatted-string,
      ytd-comment-view-model #pinned-comment-badge,
      ytd-comment-view-model #pinned-comment-badge a,
      ytd-comment-view-model #pinned-comment-badge yt-formatted-string,
      yt-comment-view-model #pinned-comment-badge,
      yt-comment-view-model #pinned-comment-badge a,
      yt-comment-view-model #pinned-comment-badge yt-formatted-string {
        color:var(--uploader-orange) !important;
        -webkit-text-fill-color:var(--uploader-orange) !important;
        background:transparent !important;
        font-weight:700 !important;
      }

      /* Creator/owner badge only: orange */
      ytd-author-comment-badge-renderer,
      ytd-author-comment-badge-renderer a,
      ytd-author-comment-badge-renderer yt-formatted-string,
      #author-comment-badge,
      #author-comment-badge a,
      #author-comment-badge yt-formatted-string {
        color:var(--uploader-orange) !important;
        -webkit-text-fill-color:var(--uploader-orange) !important;
        background:transparent !important;
        font-weight:700 !important;
        --yt-basic-background-color:transparent !important;
        --yt-basic-foreground-title-color:var(--uploader-orange) !important;
      }

      /* Neutralise badge chip backgrounds */
      ytd-comment-renderer #header-badge,
      ytd-comment-renderer #header-author-badges,
      ytd-comment-view-model #header-badge,
      ytd-comment-view-model #header-author-badges,
      yt-comment-view-model #header-badge,
      yt-comment-view-model #header-author-badges {
        background:transparent !important;
      }
      `;
        };

        const buildCss = () =>
          [
            buildBaseCss(),
            buildCommentControlsCss(),
            buildCompactCommentsCss(),
            buildColourCommentsCss(),
          ]
            .filter((css) => css.trim())
            .join("\n");

        const addPendingApplyRoot = (root) => {
          if (!root || !root.querySelectorAll) return;
          pendingApplyRoots.add(root);
        };

        const scheduleApply = (root = document) => {
          if (!isWatchPath()) return;
          addPendingApplyRoot(root);
          if (!pendingApplyRoots.size) return;
          if (scheduled) return;

          scheduled = true;

          requestAnimationFrame(() => {
            scheduled = false;
            const roots = new Set(pendingApplyRoots);
            pendingApplyRoots.clear();
            roots.forEach((pendingRoot) => {
              if (pendingRoot.isConnected === false) return;
              // Use the current DOM tree so reparented comments are not discarded.
              // parentNode deliberately stops at shadow roots, just like contains.
              for (let parent = pendingRoot.parentNode; parent; parent = parent.parentNode) {
                if (roots.has(parent)) return;
              }
              applyAll(pendingRoot);
            });
          });
        };

        const scheduleDelayedApply = () => {
          if (!isWatchPath()) return;
          if (delayedScheduled) return;

          delayedScheduled = true;

          setTimeout(() => {
            delayedScheduled = false;
            applyAll();
          }, 300);
        };

        const scheduleUploaderPathsFallback = () => {
          clearUploaderPathsFallback();
          if (!isWatchPath()) return;

          const videoKey = getVideoKey();
          if (uploaderPathsReadyVideoKey === videoKey) return;

          uploaderPathsFallbackTimer = setTimeout(() => {
            uploaderPathsFallbackTimer = 0;

            if (
              !isWatchPath() ||
              getVideoKey() !== videoKey ||
              uploaderPathsReadyVideoKey === videoKey
            ) {
              return;
            }

            markUploaderPathsReady();
            scheduleApply(document.querySelector("ytd-comments") || document);
            scheduleDelayedApply();
          }, UPLOADER_PATHS_FALLBACK_DELAY_MS);
        };

        const getMutationElement = (node) => {
          if (!node) return null;
          return node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
        };

        const getCommentMutationApplyRoot = (node) => {
          const element = getMutationElement(node);
          if (!element) return null;

          if (element.closest(COMMENT_MUTATION_SURFACE_SELECTOR)) return element;
          if (element.querySelector(COMMENT_MUTATION_SURFACE_SELECTOR)) return element;
          return null;
        };

        const containsUploaderSource = (node) => {
          const element = getMutationElement(node);
          if (!element) return false;

          return Boolean(
            element.closest(UPLOADER_SOURCE_SELECTOR) ||
              element.querySelector(UPLOADER_SOURCE_SELECTOR),
          );
        };

        const collectCommentsVideoGuardRoots = (roots, node) => {
          const applyRoot = getCommentMutationApplyRoot(node);
          if (!applyRoot) return null;

          getCommentContainers(applyRoot).forEach((comments) => roots.add(comments));
          return applyRoot;
        };

        const observer = new MutationObserver((mutations) => {
          if (!isWatchPath()) return;

          const commentsVideoGuardRoots = new Set();

          for (const mutation of mutations) {
            if (mutation.type === "attributes") {
              if (
                mutation.attributeName === "video-id" &&
                mutation.target === getActiveWatchFlexy()
              ) {
                bindCommentsVideoGuardDestination();
                syncCommentsVideoGuard();
                scheduleCommentsVideoGuardRecovery();
                continue;
              }

              collectCommentsVideoGuardRoots(
                commentsVideoGuardRoots,
                mutation.target,
              );

              if (containsUploaderSource(mutation.target)) {
                invalidateCachedUploaderPaths();
                scheduleApply(document.querySelector("ytd-comments") || document);
              }
              continue;
            }

            collectCommentsVideoGuardRoots(commentsVideoGuardRoots, mutation.target);
            if (!mutation.addedNodes.length) continue;

            mutation.addedNodes.forEach((node) => {
              const applyRoot = collectCommentsVideoGuardRoots(
                commentsVideoGuardRoots,
                node,
              );
              if (applyRoot) {
                scheduleApply(applyRoot);
              }

              if (containsUploaderSource(node)) {
                invalidateCachedUploaderPaths();
                scheduleApply(document.querySelector("ytd-comments") || document);
              }
            });
          }

          commentsVideoGuardRoots.forEach((comments) =>
            syncCommentsVideoGuard(comments),
          );
        });

        const startObserving = () => {
          if (observing || !isWatchPath()) return;

          observer.observe(document.documentElement, {
            attributeFilter: ["href", "video-id"],
            attributes: true,
            childList: true,
            subtree: true,
          });
          observing = true;
        };

        const stopObserving = () => {
          if (!observing) return;

          observer.disconnect();
          observing = false;
        };

        const syncRouteState = () => {
          if (isWatchPath()) {
            startObserving();
            applyAll();
            scheduleDelayedApply();
            return;
          }

          stopObserving();
          pendingApplyRoots.clear();
          invalidateUploaderPaths();
          resetCommentsVideoGuard();
        };

        if (isWatchPath()) markUploaderPathsReady();
        syncRouteState();

        suite.addWindowListener(
          "yt-navigate-start",
          () => {
            if (isWatchPath()) {
              markCurrentCommentsStale();
            } else {
              resetCommentsVideoGuard();
            }
            invalidateUploaderPaths();
          },
          true,
        );

        suite.addWindowListener(
          "yt-navigate-finish",
          () => {
            syncRouteState();
            bindCommentsVideoGuardDestination();
            syncCommentsVideoGuard();
            scheduleCommentsVideoGuardRecovery();
            scheduleUploaderPathsFallback();
          },
          true,
        );

        suite.addWindowListener(
          "yt-page-data-updated",
          () => {
            if (!isWatchPath()) return;

            markUploaderPathsReady();
            bindCommentsVideoGuardDestination();
            syncCommentsVideoGuard();
            scheduleCommentsVideoGuardRecovery();
            scheduleApply(document.querySelector("ytd-comments") || document);
            scheduleDelayedApply();
          },
          true,
        );

        suite.addWindowListener(
          "pageshow",
          () => {
            if (isWatchPath()) {
              markUploaderPathsReady();
            } else {
              invalidateUploaderPaths();
            }
            syncRouteState();
            bindCommentsVideoGuardDestination();
            syncCommentsVideoGuard();
            scheduleCommentsVideoGuardRecovery();
          },
          true,
        );

        suite.addWindowListener("pagehide", () => resetCommentsVideoGuard(""), true);

        GM_addStyle(buildCss());
        syncCommentsVideoGuard();
    },
  );

  suite.registerModule(
    "feedUiCleaner",
    "Feed UI Cleaner v2.13",
    "document-idle",
    () => {
      const MutationObserver = suite.SharedMutationObserver;
      const GM_addStyle = (css) => suite.setStyle("feedUiCleaner", css);

      'use strict';

        const CONFIG = {
          hideStaticUi: true,
          tightenFeedGrid: true,
          filterProfiles: {
            default: { mixes: true, membersOnly: true, podcasts: true },
            home: { mixes: true, membersOnly: true, podcasts: true },
            subscriptions: { mixes: true, membersOnly: true, podcasts: true },
            search: { mixes: true, membersOnly: true, podcasts: true },
            history: { mixes: true, membersOnly: true, podcasts: true },
          },
          showTemporaryRevealControl: true,
        };
        Object.assign(CONFIG, suite.settings.overrides("feedUiCleaner", CONFIG));

        // Standalone module installs have no shared age service and fail open.
        const channelAge = typeof suite !== 'undefined' ? suite.channelAge : null;

        const STATIC_HIDE_SELECTORS = [
          'ytd-guide-section-renderer.ytd-guide-renderer.style-scope:nth-of-type(2)',
          'ytd-guide-section-renderer.ytd-guide-renderer.style-scope:nth-of-type(4)',
          'ytd-guide-section-renderer.ytd-guide-renderer.style-scope:nth-of-type(5)',
          'ytd-guide-section-renderer.ytd-guide-renderer.style-scope:nth-of-type(6)',
          'ytd-guide-collapsible-entry-renderer.ytd-guide-collapsible-section-entry-renderer.style-scope',
          'ytd-guide-entry-renderer.ytd-guide-collapsible-section-entry-renderer.style-scope:nth-of-type(1)',
          '#guide-links-primary',
          '#guide-links-secondary',
          '#copyright',
          'ytd-guide-renderer #footer',
          'ytd-guide-renderer #guide-links-primary',
          'ytd-guide-renderer #guide-links-secondary',
          'ytd-guide-renderer #copyright',
          'ytd-mini-guide-renderer #copyright',
          'tp-yt-app-drawer #copyright',
          'ytd-browse ytd-feed-filter-chip-bar-renderer #chips-content.ytd-feed-filter-chip-bar-renderer',
          'ytd-browse ytd-feed-filter-chip-bar-renderer #chips-wrapper.ytd-feed-filter-chip-bar-renderer',
          'ytd-browse ytd-rich-grid-renderer ytd-rich-section-renderer',
          'ytd-browse ytd-rich-grid-renderer ytd-rich-item-renderer:has(ytd-feed-nudge-renderer)',
          'ytd-masthead #voice-search-button',
          'ytd-masthead ytd-notification-topbar-button-renderer',
          'ytd-masthead #notification-button',
          'ytd-masthead #create-button',
          'ytd-masthead ytd-button-renderer:has(button[aria-label="Create"])',
          'ytd-masthead button[aria-label="Create"]',
        ];

        const MIX_BADGE_SELECTOR = [
          '.ytThumbnailOverlayBadgeViewModelHost',
          'ytd-thumbnail-overlay-bottom-panel-renderer',
          'ytd-thumbnail-overlay-time-status-renderer',
          'badge-shape',
          '.badge-shape-wiz',
        ].join(',');

        const MEMBERS_ONLY_SELECTOR = [
          '#meta > ytd-badge-supported-renderer.video-badge.style-scope.ytd-rich-grid-media > div.badge.badge-style-type-members-only.style-scope.ytd-badge-supported-renderer.style-scope.ytd-badge-supported-renderer',
          'div.ytContentMetadataViewModelMetadataRow.ytContentMetadataViewModelMetadataRowMetadataRowWrap',
        ].join(',');

        const PODCAST_LINK_SELECTOR = [
          'a[href^="/playlist?list="]',
          'a[href*="youtube.com/playlist?list="]',
        ].join(',');

        const AD_SLOT_SELECTOR = [
          'ytd-ad-slot-renderer',
          'ytd-display-ad-renderer',
          'ytd-promoted-sparkles-web-renderer',
        ].join(',');

        const OUTER_CONTAINER_SELECTORS = [
          'ytd-rich-item-renderer',
          'ytd-video-renderer',
          'ytd-grid-video-renderer',
          'ytd-compact-video-renderer',
          'ytd-playlist-video-renderer',
          'ytm-rich-item-renderer',
          'ytm-video-with-context-renderer',
          'ytd-ad-slot-renderer',
          'ytd-display-ad-renderer',
          'ytd-promoted-sparkles-web-renderer',
        ].join(',');

        const INNER_CONTAINER_SELECTORS = [
          'ytd-rich-grid-media',
          'yt-lockup-view-model',
          'ytm-lockup-view-model',
        ].join(',');

        const EXCLUDED_ANCESTOR_SELECTORS = [
          'ytd-popup-container',
          'tp-yt-iron-dropdown',
          'ytd-menu-popup-renderer',
          'ytd-miniplayer',
          'ytd-miniplayer-ui',
          'ytd-miniplayer-bar-renderer',
          'ytd-playlist-panel-renderer',
          'ytd-playlist-panel-video-renderer',
          'ytd-playlist-panel-renderer #items',
          'ytd-watch-flexy[playlist]',
          'ytd-engagement-panel-section-list-renderer',
        ].join(',');

        const FEED_SURFACE_SELECTOR = [
          'ytd-browse ytd-rich-grid-renderer',
          'ytd-two-column-browse-results-renderer ytd-rich-grid-renderer',
          'ytd-two-column-search-results-renderer #contents',
        ].join(',');

        const FEED_CONTENTS_SELECTOR = 'ytd-browse ytd-rich-grid-renderer #contents.ytd-rich-grid-renderer';

        const HIDDEN_FLAG = 'data-clean-up-youtube-hidden';
        const HIDDEN_REASON_ATTRIBUTE = 'data-clean-up-youtube-reason';
        const PERMANENT_HIDDEN_FLAG = 'data-clean-up-youtube-permanent-hidden';
        const FILTER_REVEAL_ATTRIBUTE = 'data-yt-master-show-filtered';
        const FILTER_TOGGLE_ID = 'yt-master-filter-toggle';
        const FILTERED_CARD_SELECTOR = [
          `[${HIDDEN_FLAG}="1"]`,
          '[data-ytppl-upcoming-hidden="1"]',
          '[data-ytppl-pay-to-watch-hidden="1"]',
          '[data-ytppl-watched-hidden="1"]',
        ].join(',');

        function getText(el) {
          return el ? el.textContent.replace(/\s+/g, ' ').trim() : '';
        }

        function isInsideExcludedSurface(el) {
          return Boolean(el.closest(EXCLUDED_ANCESTOR_SELECTORS));
        }

        function isMixBadge(el) {
          return /^mix$/i.test(getText(el));
        }

        function isFullPodcastLink(el) {
          return /^view full podcast$/i.test(getText(el));
        }

        function isMembersOnlyMatch(el) {
          return /members only/i.test(getText(el));
        }

        function getFilterProfileName() {
          if (location.pathname === '/' || location.pathname === '/feed/recommended') {
            return 'home';
          }
          if (location.pathname === '/feed/subscriptions') {
            return 'subscriptions';
          }
          if (location.pathname === '/results') {
            return 'search';
          }
          if (location.pathname === '/feed/history') {
            return 'history';
          }
          return 'default';
        }

        function getFilterProfile() {
          const profiles = CONFIG.filterProfiles || {};
          return profiles[getFilterProfileName()] || profiles.default || {};
        }

        function isRuntimeFeedRoute() {
          return !(
            location.pathname === '/watch' ||
            location.pathname.startsWith('/live/') ||
            location.pathname.startsWith('/shorts/')
          );
        }

        function isChannelAgeFeedRoute() {
          return location.pathname === '/' || location.pathname === '/feed/recommended' ||
            location.pathname === '/feed/subscriptions' || location.pathname === '/results' ||
            /^\/(?:channel\/UC[A-Za-z0-9_-]{22}|@[^/]+|c\/[^/]+|user\/[^/]+)(?:\/(?:videos|streams|featured))?\/?$/.test(location.pathname);
        }

        const CARD_FILTERS = [
          {
            key: 'channelAge',
            reason: 'Channel age',
            selector: `${OUTER_CONTAINER_SELECTORS},${INNER_CONTAINER_SELECTORS}`,
            matches: (el) => channelAge && isChannelAgeFeedRoute() && channelAge.cardFilterReason(getCardContainer(el)),
          },
          {
            key: 'mixes',
            reason: 'Mix',
            selector: MIX_BADGE_SELECTOR,
            matches: isMixBadge,
          },
          {
            key: 'membersOnly',
            reason: 'Members only',
            selector: MEMBERS_ONLY_SELECTOR,
            matches: isMembersOnlyMatch,
          },
          {
            key: 'podcasts',
            reason: 'Podcast',
            selector: PODCAST_LINK_SELECTOR,
            matches: isFullPodcastLink,
          },
          {
            key: 'advertisement',
            reason: 'Advertisement',
            selector: AD_SLOT_SELECTOR,
            matches: () => true,
            permanent: true,
          },
        ];
        const FILTER_MUTATION_TRIGGER_SELECTOR = [
          MIX_BADGE_SELECTOR,
          MEMBERS_ONLY_SELECTOR,
          PODCAST_LINK_SELECTOR,
          `[${HIDDEN_FLAG}]`,
          `[${PERMANENT_HIDDEN_FLAG}]`,
        ].join(',');
        const AGE_MUTATION_TRIGGER_SELECTOR = [
          '#metadata-line',
          '#metadata',
          '.yt-content-metadata-view-model__metadata-text',
          '.ytContentMetadataViewModelMetadataText',
          'time[datetime]',
        ].join(',');

        function buildHideCss(selectors) {
          return `
          ${selectors.join(',\n    ')} {
            display: none !important;
          }
        `;
        }

        function buildStaticCss() {
          return CONFIG.hideStaticUi ? buildHideCss(STATIC_HIDE_SELECTORS) : '';
        }

        function buildFeedGridCss() {
          if (!CONFIG.tightenFeedGrid) return '';

          return `
          ${FEED_CONTENTS_SELECTOR} {
            padding-top: 16px !important;
            padding-left: 24px !important;
            padding-right: 24px !important;
          }
        `;
        }

        function buildFilteredCardCss() {
          return `
          [${PERMANENT_HIDDEN_FLAG}="1"] {
            display: none !important;
          }

          :root:not([${FILTER_REVEAL_ATTRIBUTE}="1"]) [${HIDDEN_FLAG}="1"] {
            display: none !important;
          }

          #${FILTER_TOGGLE_ID} {
            position: fixed !important;
            bottom: 16px !important;
            left: 16px !important;
            z-index: 2200 !important;
            border: 1px solid var(--yt-spec-10-percent-layer, rgba(255,255,255,.2)) !important;
            border-radius: 18px !important;
            padding: 7px 12px !important;
            background: var(--yt-spec-raised-background, #272727) !important;
            color: var(--yt-spec-text-primary, #fff) !important;
            cursor: pointer !important;
            font: 500 12px/16px Roboto, Arial, sans-serif !important;
            box-shadow: 0 2px 8px rgba(0,0,0,.3) !important;
          }

          #${FILTER_TOGGLE_ID}:focus-visible {
            outline: 2px solid var(--yt-spec-call-to-action, #3ea6ff) !important;
            outline-offset: 2px !important;
          }
        `;
        }

        function buildCss() {
          return [
            buildStaticCss(),
            buildFeedGridCss(),
            buildFilteredCardCss(),
          ].filter(css => css.trim()).join('\n');
        }

        function getCardContainer(el) {
          return (
            el?.closest?.(OUTER_CONTAINER_SELECTORS) ||
            el?.closest?.(INNER_CONTAINER_SELECTORS) ||
            null
          );
        }

        function collectMatchingElements(root, selector) {
          const elements = new Set();
          if (!root || !root.querySelectorAll) return elements;

          if (root.nodeType === Node.ELEMENT_NODE && root.matches(selector)) {
            elements.add(root);
          }
          root.querySelectorAll(selector).forEach((el) => elements.add(el));
          return elements;
        }

        function addContainerMatch(matchesByContainer, el, filter) {
          if (isInsideExcludedSurface(el)) return;
          const match = filter.matches(el);
          if (!match) return;

          const container = getCardContainer(el);
          if (!container || isInsideExcludedSurface(container)) return;

          const current = matchesByContainer.get(container) || {
            permanent: false,
            reasons: new Set(),
          };
          current.permanent ||= Boolean(filter.permanent);
          current.reasons.add(typeof match === 'string' ? match : filter.reason);
          matchesByContainer.set(container, current);
        }

        function addPreviouslyFilteredContainers(containers, root) {
          collectMatchingElements(
            root,
            `[${HIDDEN_FLAG}], [${PERMANENT_HIDDEN_FLAG}]`,
          ).forEach((container) => containers.add(container));

          const rootElement = root?.nodeType === Node.ELEMENT_NODE ? root : null;
          const closest = rootElement?.closest?.(
            `[${HIDDEN_FLAG}], [${PERMANENT_HIDDEN_FLAG}]`,
          );
          if (closest) containers.add(closest);
        }

        function reconcileFilteredCards(root = document) {
          const matchesByContainer = new Map();
          const containers = new Set();
          let changed = false;
          const profile = getFilterProfile();

          CARD_FILTERS.forEach((filter) => {
            if (!filter.permanent && profile[filter.key] === false) return;
            if (filter.key === 'channelAge' && !channelAge?.hasEnabledRules()) return;
            const ageCheckedContainers = filter.key === 'channelAge' ? new Set() : null;

            collectMatchingElements(root, filter.selector).forEach((el) => {
              if (ageCheckedContainers) {
                if (isInsideExcludedSurface(el)) return;
                const container = getCardContainer(el);
                if (!container || ageCheckedContainers.has(container)) return;
                ageCheckedContainers.add(container);
              }
              addContainerMatch(matchesByContainer, el, filter);
            });
          });

          matchesByContainer.forEach((_match, container) => containers.add(container));
          addPreviouslyFilteredContainers(containers, root);

          containers.forEach((container) => {
            const match = matchesByContainer.get(container);
            const values = [
              [HIDDEN_FLAG, match && !match.permanent ? '1' : null],
              [HIDDEN_REASON_ATTRIBUTE, match ? [...match.reasons].sort().join(', ') : null],
              [PERMANENT_HIDDEN_FLAG, match?.permanent ? '1' : null],
            ];
            for (const [attribute, value] of values) {
              if (container.getAttribute(attribute) === value) continue;
              if (value === null) container.removeAttribute(attribute);
              else container.setAttribute(attribute, value);
              changed = true;
            }
          });
          return changed;
        }

        function cleanUp(root = document) {
          const rootElement =
            root && root.nodeType === Node.ELEMENT_NODE ? root : null;
          if (rootElement && rootElement.closest(FEED_SURFACE_SELECTOR)) {
            if (reconcileFilteredCards(rootElement)) scheduleFilterToggleUpdate();
            return;
          }

          let changed = false;
          collectMatchingElements(root, FEED_SURFACE_SELECTOR).forEach((surface) => {
            changed = reconcileFilteredCards(surface) || changed;
          });
          if (changed || root === document) scheduleFilterToggleUpdate();
        }

        let filterToggleUpdateFrame = 0;

        function getFilteredContainers() {
          const containers = new Set();
          document.querySelectorAll(FEED_SURFACE_SELECTOR).forEach((surface) => {
            surface.querySelectorAll(FILTERED_CARD_SELECTOR).forEach((container) => {
              if (
                !container.closest(`[${PERMANENT_HIDDEN_FLAG}="1"]`) &&
                !isInsideExcludedSurface(container)
              ) {
                containers.add(container);
              }
            });
          });
          return containers;
        }

        function getFilteredReasonSummary(containers) {
          const counts = new Map();
          const markerReasons = [
            ['data-ytppl-upcoming-hidden', 'Upcoming'],
            ['data-ytppl-pay-to-watch-hidden', 'Pay to watch'],
            ['data-ytppl-watched-hidden', 'Watched'],
          ];

          containers.forEach((container) => {
            const reasons = new Set(
              String(container.getAttribute(HIDDEN_REASON_ATTRIBUTE) || '')
                .split(',')
                .map((reason) => reason.trim())
                .filter(Boolean),
            );
            markerReasons.forEach(([attribute, reason]) => {
              if (container.getAttribute(attribute) === '1') reasons.add(reason);
            });
            reasons.forEach((reason) => counts.set(reason, (counts.get(reason) || 0) + 1));
          });

          return [...counts.entries()]
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([reason, count]) => `${reason}: ${count}`)
            .join(', ');
        }

        function setFilteredItemsRevealed(revealed) {
          const root = document.documentElement;
          if (
            !root ||
            (root.getAttribute(FILTER_REVEAL_ATTRIBUTE) === '1') === revealed
          ) return;

          if (revealed) {
            root.setAttribute(FILTER_REVEAL_ATTRIBUTE, '1');
          } else {
            root.removeAttribute(FILTER_REVEAL_ATTRIBUTE);
          }
          scheduleFilterToggleUpdate();
        }

        function updateFilterToggle() {
          filterToggleUpdateFrame = 0;
          const existing = document.getElementById(FILTER_TOGGLE_ID);
          if (!CONFIG.showTemporaryRevealControl || !isRuntimeFeedRoute()) {
            existing?.remove();
            setFilteredItemsRevealed(false);
            return;
          }

          const containers = getFilteredContainers();
          if (!containers.size) {
            existing?.remove();
            setFilteredItemsRevealed(false);
            return;
          }

          const revealed =
            document.documentElement?.getAttribute(FILTER_REVEAL_ATTRIBUTE) === '1';
          const button = existing || document.createElement('button');
          button.id = FILTER_TOGGLE_ID;
          button.type = 'button';
          button.setAttribute('aria-pressed', String(Boolean(revealed)));
          button.textContent = `Filtered: ${containers.size} · ${revealed ? 'Hide' : 'Show'}`;
          const reasons = getFilteredReasonSummary(containers);
          button.title = reasons || `${containers.size} filtered items`;
          if (!existing) {
            button.addEventListener('click', () => {
              const root = document.documentElement;
              setFilteredItemsRevealed(
                root?.getAttribute(FILTER_REVEAL_ATTRIBUTE) !== '1',
              );
            });
            (document.body || document.documentElement).appendChild(button);
          }
        }

        function scheduleFilterToggleUpdate() {
          if (filterToggleUpdateFrame) return;
          filterToggleUpdateFrame = requestAnimationFrame(updateFilterToggle);
        }

        function resetTemporaryReveal() {
          document.documentElement?.removeAttribute(FILTER_REVEAL_ATTRIBUTE);
          document.getElementById(FILTER_TOGGLE_ID)?.remove();
        }

        let cleanUpFrame = 0;
        const pendingCleanUpRoots = new Set();

        function addPendingCleanUpRoot(root) {
          if (!root || !root.querySelectorAll) return;
          pendingCleanUpRoots.add(root);
        }

        function scheduleCleanUp(root) {
          addPendingCleanUpRoot(root);
          if (!pendingCleanUpRoots.size) return;
          if (cleanUpFrame) return;

          cleanUpFrame = requestAnimationFrame(() => {
            cleanUpFrame = 0;
            const roots = new Set(pendingCleanUpRoots);
            pendingCleanUpRoots.clear();
            roots.forEach((root) => {
              if (root.isConnected === false) return;
              // Classify against the current tree, not a potentially stale tree at
              // enqueue time. Sibling bursts are O(roots * depth), not pairwise.
              for (let parent = root.parentNode; parent; parent = parent.parentNode) {
                if (roots.has(parent)) return;
              }
              cleanUp(root);
            });
          });
        }

        function getAddedNodeCleanUpRoot(node) {
          const element =
            node && node.nodeType === Node.ELEMENT_NODE
              ? node
              : node && node.parentElement;
          if (!element) return null;
          if (isInsideExcludedSurface(element)) return null;

          if (element.closest(FEED_SURFACE_SELECTOR)) {
            return getCardContainer(element) || element;
          }
          if (element.querySelector(FEED_SURFACE_SELECTOR)) return element;
          return null;
        }

        function getMutationCleanUpRoot(mutation) {
          const element =
            mutation.target?.nodeType === Node.ELEMENT_NODE
              ? mutation.target
              : mutation.target?.parentElement;
          if (!element) return null;

          const card = getCardContainer(element);
          if (card?.closest(FEED_SURFACE_SELECTOR)) return card;
          if (element.closest(FEED_SURFACE_SELECTOR)) return element;
          return null;
        }

        function isPreviewPlaybackMutation(mutation) {
          const element = mutation.target?.nodeType === Node.ELEMENT_NODE
            ? mutation.target : mutation.target?.parentElement;
          const surface = element?.closest?.(
            '.ytp-progress-bar-container, .ytp-caption-window-container, .ytp-chrome-controls',
          );
          const player = surface?.closest('.html5-video-player');
          return Boolean(player?.closest('ytd-video-preview'));
        }

        function mutationCanAffectFiltering(mutation) {
          // Playback animation/caption changes are not feed metadata. Keep outer
          // renderer changes and genuine thumbnail resume-progress updates visible.
          if (isPreviewPlaybackMutation(mutation)) return false;
          if (mutation.type === 'childList') return true;

          const element =
            mutation.target?.nodeType === Node.ELEMENT_NODE
              ? mutation.target
              : mutation.target?.parentElement;
          if (!element) return false;

          if (
            mutation.type === 'attributes' &&
            (mutation.attributeName?.startsWith('data-ytppl-') ||
              (channelAge?.hasEnabledRules() && ['href', 'datetime', 'overlay-style'].includes(mutation.attributeName)))
          ) {
            return true;
          }

          return Boolean(element.closest(FILTER_MUTATION_TRIGGER_SELECTOR) ||
            (channelAge?.hasEnabledRules() && element.closest(AGE_MUTATION_TRIGGER_SELECTOR)));
        }

        GM_addStyle(buildCss());
        cleanUp(document);

        const observer = new MutationObserver((mutations) => {
          let toggleDirty = false;
          for (const mutation of mutations) {
            if (!mutationCanAffectFiltering(mutation)) continue;

            if (mutation.type !== 'childList') {
              const cleanUpRoot = getMutationCleanUpRoot(mutation);
              if (cleanUpRoot) scheduleCleanUp(cleanUpRoot);
              if (mutation.type === 'attributes' && mutation.attributeName?.startsWith('data-ytppl-')) toggleDirty = true;
              continue;
            }

            const mutationRoot = getMutationCleanUpRoot(mutation);
            if (mutationRoot) scheduleCleanUp(mutationRoot);
            if (mutationRoot && [...mutation.addedNodes, ...mutation.removedNodes].some(node => node.nodeType === Node.ELEMENT_NODE)) toggleDirty = true;
            for (const node of mutation.removedNodes) {
              if (node.nodeType === Node.ELEMENT_NODE &&
                  (node.matches(FEED_SURFACE_SELECTOR) || node.querySelector(FEED_SURFACE_SELECTOR))) toggleDirty = true;
            }
            if (!mutation.addedNodes || !mutation.addedNodes.length) continue;

            mutation.addedNodes.forEach((node) => {
              const cleanUpRoot = getAddedNodeCleanUpRoot(node);
              if (cleanUpRoot) {
                scheduleCleanUp(cleanUpRoot);
                if (node.nodeType === Node.ELEMENT_NODE) toggleDirty = true;
              }
            });
          }
          // Text-only churn cannot change card membership. Owned hide/reason changes
          // invalidate in cleanUp; structural and external-marker changes do so here.
          if (toggleDirty) scheduleFilterToggleUpdate();
        });

        const OBSERVER_OPTIONS = {
          attributeFilter: [
            'href',
            'datetime',
            'overlay-style',
            'data-ytppl-upcoming-hidden',
            'data-ytppl-pay-to-watch-hidden',
            'data-ytppl-watched-hidden',
          ],
          attributes: true,
          characterData: true,
          childList: true,
          subtree: true,
        };
        let observerActive = false;

        function stopMutationObservation() {
          if (!observerActive) return;
          observer.disconnect();
          observerActive = false;
        }

        function syncMutationObservation() {
          if (!isRuntimeFeedRoute()) {
            stopMutationObservation();
            return false;
          }
          if (!observerActive) {
            observer.observe(document.documentElement, OBSERVER_OPTIONS);
            observerActive = true;
          }
          return true;
        }

        function resetScheduledWork() {
          if (filterToggleUpdateFrame) cancelAnimationFrame(filterToggleUpdateFrame);
          if (cleanUpFrame) cancelAnimationFrame(cleanUpFrame);
          filterToggleUpdateFrame = 0;
          cleanUpFrame = 0;
          pendingCleanUpRoots.clear();
        }

        function reconcileRoute() {
          resetTemporaryReveal();
          if (syncMutationObservation()) cleanUp(document);
        }

        syncMutationObservation();

        suite.addWindowListener('yt-navigate-start', () => {
          resetTemporaryReveal();
          stopMutationObservation();
          resetScheduledWork();
        }, true);
        suite.addWindowListener('yt-navigate-finish', reconcileRoute, true);
        suite.addWindowListener('yt-page-data-updated', reconcileRoute, true);
        suite.addWindowListener('yt-master-channel-age-changed', () => {
          channelAge?.read();
          if (isRuntimeFeedRoute()) scheduleCleanUp(document);
        });
        suite.addWindowListener('pagehide', () => {
          stopMutationObservation();
          resetScheduledWork();
        }, true);
        suite.addWindowListener('pageshow', reconcileRoute, true);
    },
  );

  suite.registerModule(
    "miniplayerButtonRestorer",
    "Miniplayer Button Restorer v1.14",
    "document-idle",
    () => {
      const MutationObserver = suite.SharedMutationObserver;
      const GM_addStyle = (css) => suite.setStyle("miniplayerButtonRestorer", css);

      "use strict";

        const BTN_ID = "tmk-miniplayer-button";
        const TOOLTIP_ID = "tmk-miniplayer-tooltip";
        const STYLE_ID = "tmk-miniplayer-style";
        const CONFIG = {
          iconPx: 36,
          pollInterval: 250,
          pollMaxMs: 20000,
          navRetryDelays: [300, 900, 1800, 3500],
        };

        const PLAYER_SELECTORS = ["#movie_player", ".html5-video-player"];
        const RIGHT_CONTROLS_SELECTOR = ".ytp-right-controls";
        const NATIVE_MINIPLAYER_BUTTON_SELECTOR = ".ytp-miniplayer-button";
        const FULLSCREEN_BUTTON_SELECTOR = ".ytp-fullscreen-button";
        const CONTROL_STATE_ATTRIBUTES = [
          "aria-disabled", "aria-hidden", "class", "disabled", "hidden", "style",
        ];
        const WATCH_STATE_ATTRIBUTES = [...CONTROL_STATE_ATTRIBUTES, "video-id"];
        const PLAYER_CONTROL_SELECTOR = [...PLAYER_SELECTORS, RIGHT_CONTROLS_SELECTOR].join(",");
        const PLAYER_TOPOLOGY_SELECTOR = [
          PLAYER_CONTROL_SELECTOR,
          "ytd-watch-flexy", "#ytsmp-player-placeholder",
        ].join(",");

        let observing = false;
        let installedButton = null;
        let tooltip = null;
        let tooltipPlayer = null;
        let tooltipPlayerParent = null;
        let tooltipButtonParent = null;
        let observedControls = null;
        let observedControlTargets = [];

        function isEligiblePath() {
          const p = location.pathname;
          if (p.startsWith("/shorts")) return false;
          return p === "/watch" || p.startsWith("/live/");
        }

        function getRouteKey() {
          return `${location.pathname}${location.search}`;
        }

        function buildCss() {
          const iconPx = CONFIG.iconPx;

          return `
            #${BTN_ID}.ytp-button{
              display:inline-flex !important;
              align-items:center !important;
              justify-content:center !important;
              padding:0 !important;
              margin:0 !important;
              line-height:0 !important;
            }

            .html5-video-player #${BTN_ID}.ytp-button svg,
            #movie_player #${BTN_ID}.ytp-button svg,
            ytd-player #${BTN_ID}.ytp-button svg{
              width:${iconPx}px !important;
              height:${iconPx}px !important;
              min-width:${iconPx}px !important;
              min-height:${iconPx}px !important;
              max-width:${iconPx}px !important;
              max-height:${iconPx}px !important;
              display:block !important;
              overflow:visible !important;
              pointer-events:none !important;
              shape-rendering:geometricPrecision !important;
            }

            #${TOOLTIP_ID}{
              position:absolute !important;
              z-index:1000 !important;
              display:flex !important;
              align-items:center !important;
              gap:4px !important;
              box-sizing:border-box !important;
              max-width:calc(100% - 16px) !important;
              padding:5px 9px !important;
              border-radius:2px !important;
              background:rgba(0, 0, 0, 0.9) !important;
              color:#eee !important;
              font:500 12px/1.2 Roboto, Arial, sans-serif !important;
              text-shadow:none !important;
              pointer-events:none !important;
            }
            #${TOOLTIP_ID} kbd{
              flex:0 0 auto !important;
              box-sizing:border-box !important;
              min-width:14px !important;
              height:16px !important;
              padding:0 2px !important;
              border:1px solid #555 !important;
              border-radius:3px !important;
              background:transparent !important;
              color:inherit !important;
              font:400 12px/14px Roboto, Arial, sans-serif !important;
              text-align:center !important;
            }
          `;
        }

        function ensureStyles() {
          suite.setStyle("miniplayerButtonRestorer", buildCss());
        }

        function queryFirst(selectors, root = document) {
          for (const selector of selectors) {
            const el = root.querySelector(selector);
            if (el) return el;
          }
          return null;
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

        function getActiveWatchFlexy() {
          const playerFlexy = document
            .querySelector("#movie_player")
            ?.closest?.("ytd-watch-flexy");
          if (isRenderedWatchFlexy(playerFlexy)) return playerFlexy;

          const placeholderFlexy = document
            .querySelector("#ytsmp-player-placeholder")
            ?.closest?.("ytd-watch-flexy");
          if (isRenderedWatchFlexy(placeholderFlexy)) return placeholderFlexy;

          const flexies = Array.from(document.querySelectorAll("ytd-watch-flexy"));
          return (
            flexies.find(isRenderedWatchFlexy) ||
            flexies.find((flexy) => flexy.isConnected) ||
            null
          );
        }

        function getPlayerEl() {
          const floatedPlayer = document.body?.classList.contains(
            "ytsmp-scroll-miniplayer-active",
          )
            ? Array.from(document.body.children).find((child) =>
                PLAYER_SELECTORS.some((selector) => child.matches?.(selector)),
              )
            : null;
          if (floatedPlayer) return floatedPlayer;

          const activeFlexy = getActiveWatchFlexy();
          return (
            (activeFlexy && queryFirst(PLAYER_SELECTORS, activeFlexy)) ||
            queryFirst(PLAYER_SELECTORS)
          );
        }

        function getRightControls() {
          const roots = [getPlayerEl(), document.querySelector("ytd-player"), document].filter(Boolean);
          for (const r of roots) {
            const c = r.querySelector(RIGHT_CONTROLS_SELECTOR);
            if (c) return c;
          }
          return null;
        }

        function clickNativeMiniplayerIfPresent() {
          const player = getPlayerEl();
          if (!player) return false;

          const nativeBtn = Array.from(player.querySelectorAll(NATIVE_MINIPLAYER_BUTTON_SELECTOR))
            .find((btn) => (
              btn.id !== BTN_ID &&
              !btn.disabled &&
              btn.getAttribute("aria-disabled") !== "true"
            ));

          if (nativeBtn) {
            nativeBtn.click();
            return true;
          }
          return false;
        }

        function hasUsableNativeMiniplayer(controls) {
          // Autohide affects the whole toolbar. Only a separately suppressed native
          // control needs restoring; do not replace it merely while controls fade out.
          const toolbarVisibility = getComputedStyle(controls).visibility;
          return Array.from(controls.querySelectorAll(NATIVE_MINIPLAYER_BUTTON_SELECTOR))
            .some((button) => {
              if (
                button.id === BTN_ID || button.disabled ||
                button.getAttribute("aria-disabled") === "true"
              ) return false;

              for (let element = button; element && element !== controls; element = element.parentElement) {
                if (element.hidden || element.getAttribute("aria-hidden") === "true") return false;
                const style = getComputedStyle(element);
                if (
                  style.display === "none" ||
                  Number(style.opacity) === 0 ||
                  ((style.visibility === "hidden" || style.visibility === "collapse") &&
                    style.visibility !== toolbarVisibility)
                ) return false;
              }
              return true;
            });
        }

        function synthKeyToPlayer(key = "i", code = "KeyI") {
          const player = getPlayerEl();
          if (!player) return false;

          try { player.focus(); } catch {}

          const init = {
            key, code, keyCode: 73, which: 73,
            bubbles: true, cancelable: true, composed: true
          };

          const ok1 = player.dispatchEvent(new KeyboardEvent("keydown", init));
          const ok2 = player.dispatchEvent(new KeyboardEvent("keyup", init));

          return ok1 || ok2;
        }

        function triggerMiniplayer() {
          hideTooltip();
          if (clickNativeMiniplayerIfPresent()) return;
          synthKeyToPlayer("i", "KeyI");
        }

        function hideTooltip() {
          document.removeEventListener("pointermove", onTooltipPointerMove, true);
          document.removeEventListener("pointerdown", hideTooltip, true);
          document.removeEventListener("pointercancel", hideTooltip, true);
          document.removeEventListener("scroll", hideTooltip, true);
          document.removeEventListener("visibilitychange", hideTooltip);
          tooltip?.remove();
          tooltip = null;
          tooltipPlayer = null;
          tooltipPlayerParent = null;
          tooltipButtonParent = null;
          installedButton?.removeAttribute("aria-describedby");
        }

        function onTooltipPointerMove(event) {
          if (!installedButton?.contains(event.target)) hideTooltip();
        }

        function isTooltipAnchorVisible(player) {
          if (
            document.visibilityState === "hidden" || !isEligiblePath() ||
            installedButton?.disabled || installedButton?.getAttribute("aria-disabled") === "true" ||
            !isRenderedWatchFlexy(player) || !isRenderedWatchFlexy(installedButton) ||
            !player.contains(installedButton) ||
            player.classList.contains("ytp-autohide") ||
            player.closest("ytd-miniplayer, ytd-video-preview, ytd-reel-video-renderer")
          ) return false;

          // The toolbar can fade independently of the button. Reuse the existing
          // control observer to dismiss the tooltip when any control ancestor hides.
          for (let element = installedButton; element; element = element.parentElement) {
            if (element.hidden || element.getAttribute("aria-hidden") === "true") return false;
            const style = getComputedStyle(element);
            if (
              style.display === "none" || Number(style.opacity) === 0 ||
              style.visibility === "hidden" || style.visibility === "collapse"
            ) return false;
            if (element === player) break;
          }
          return true;
        }

        function positionTooltip() {
          if (!tooltip) return;
          const playerRect = tooltipPlayer.getBoundingClientRect();
          const buttonRect = installedButton.getBoundingClientRect();
          if (!playerRect.width || !playerRect.height || !buttonRect.width || !buttonRect.height) {
            hideTooltip();
            return;
          }
          const width = tooltipPlayer.offsetWidth || playerRect.width;
          const height = tooltipPlayer.offsetHeight || playerRect.height;
          const scaleX = playerRect.width / width;
          const scaleY = playerRect.height / height;
          const left = (buttonRect.left + buttonRect.width / 2 - playerRect.left) / scaleX -
            tooltip.offsetWidth / 2;
          const progress = tooltipPlayer.querySelector(".ytp-progress-bar-container");
          const progressRect = isRenderedWatchFlexy(progress) ? progress.getBoundingClientRect() : null;
          const progressAboveControls = progressRect?.width > 0 && progressRect.height > 0 &&
            progressRect.top >= playerRect.top && progressRect.bottom <= buttonRect.top + 1 &&
            progressRect.left >= playerRect.left - 1 && progressRect.right <= playerRect.right + 1;
          // Match the mirror tooltip's seek-bar clearance, including scaled players.
          const tooltipBottom = progressAboveControls
            ? (progressRect.top - playerRect.top) / scaleY - 8
            : (buttonRect.top - playerRect.top) / scaleY - 20;
          const nextLeft = `${Math.round(Math.max(8, Math.min(left, width - tooltip.offsetWidth - 8)))}px`;
          const nextTop = `${Math.round(Math.max(8, tooltipBottom - tooltip.offsetHeight))}px`;
          if (tooltip.style.left !== nextLeft) tooltip.style.left = nextLeft;
          if (tooltip.style.top !== nextTop) tooltip.style.top = nextTop;
        }

        function showTooltip(event) {
          hideTooltipForMutations([]);
          if (event.currentTarget !== installedButton || !isEligiblePath()) return;
          if (event.type === "focus" && !installedButton.matches(":focus-visible")) return;
          const player = getPlayerEl();
          if (!isTooltipAnchorVisible(player)) return;
          if (!tooltip) {
            tooltip = document.createElement("div");
            tooltip.id = TOOLTIP_ID;
            tooltip.setAttribute("role", "tooltip");
            const label = document.createElement("span");
            label.textContent = "Miniplayer";
            const key = document.createElement("kbd");
            key.textContent = "I";
            tooltip.appendChild(label);
            tooltip.appendChild(key);
            tooltipPlayer = player;
            tooltipPlayerParent = player.parentElement;
            tooltipButtonParent = installedButton.parentElement;
            player.appendChild(tooltip);
            installedButton.setAttribute("aria-describedby", TOOLTIP_ID);
            // Catch missed mouseleave events when the player or controls move. These
            // listeners exist only for a visible tooltip, with no background polling.
            document.addEventListener("pointermove", onTooltipPointerMove, true);
            document.addEventListener("pointerdown", hideTooltip, true);
            document.addEventListener("pointercancel", hideTooltip, true);
            document.addEventListener("scroll", hideTooltip, true);
            document.addEventListener("visibilitychange", hideTooltip);
          }
          positionTooltip();
        }

        function hideTooltipForMutations(mutations) {
          if (!tooltip) return;
          if (
            !isTooltipAnchorVisible(tooltipPlayer) || getPlayerEl() !== tooltipPlayer ||
            !tooltipPlayer.contains(installedButton) || tooltip.parentElement !== tooltipPlayer ||
            tooltipPlayer.parentElement !== tooltipPlayerParent ||
            installedButton.parentElement !== tooltipButtonParent ||
            mutations.some((mutation) => Array.from(mutation.removedNodes || []).some((node) =>
              node === tooltip || node.contains?.(installedButton) || node.contains?.(tooltipPlayer),
            ))
          ) hideTooltip();
        }

        function onTooltipResize() {
          hideTooltipForMutations([]);
          if (!tooltip) return;
          if (
            !installedButton.matches(":hover") &&
            !(document.activeElement === installedButton && installedButton.matches(":focus-visible"))
          ) {
            hideTooltip();
            return;
          }
          positionTooltip();
        }

        function buildIcon() {
          const SVG_NS = "http://www.w3.org/2000/svg";

          const svg = document.createElementNS(SVG_NS, "svg");
          svg.setAttribute("viewBox", "0 0 36 36");
          svg.setAttribute("focusable", "false");
          svg.setAttribute("aria-hidden", "true");

          function roundedRectPath(x, y, w, h, r) {
            const x2 = x + w;
            const y2 = y + h;
            const rr = Math.max(0, Math.min(r, w / 2, h / 2));
            return [
              `M ${x + rr} ${y}`,
              `H ${x2 - rr}`,
              `A ${rr} ${rr} 0 0 1 ${x2} ${y + rr}`,
              `V ${y2 - rr}`,
              `A ${rr} ${rr} 0 0 1 ${x2 - rr} ${y2}`,
              `H ${x + rr}`,
              `A ${rr} ${rr} 0 0 1 ${x} ${y2 - rr}`,
              `V ${y + rr}`,
              `A ${rr} ${rr} 0 0 1 ${x + rr} ${y}`,
              "Z"
            ].join(" ");
          }

          // Screen outline as a filled ring. Keeping this as fill paths lets YouTube's
          // existing .ytp-svg-fill/.ytp-svg-shadow styling handle hover and contrast.
          const outer = roundedRectPath(5.5, 9.5, 25, 17, 2.2);
          const inner = roundedRectPath(8, 12, 20, 12, 1.2);
          const borderD = `${outer} ${inner}`;

          const miniD = roundedRectPath(17, 17, 11, 7, 1.1);

          function makePath(cls, d, evenodd = false) {
            const p = document.createElementNS(SVG_NS, "path");
            p.setAttribute("class", cls);
            p.setAttribute("d", d);
            if (evenodd) {
              p.setAttribute("fill-rule", "evenodd");
              p.setAttribute("clip-rule", "evenodd");
            }
            return p;
          }

          // Shadow + fill (native icon pattern)
          svg.appendChild(makePath("ytp-svg-shadow", borderD, true));
          svg.appendChild(makePath("ytp-svg-fill", borderD, true));
          svg.appendChild(makePath("ytp-svg-shadow", miniD, false));
          svg.appendChild(makePath("ytp-svg-fill", miniD, false));

          return svg;
        }

        function makeButton() {
          const btn = document.createElement("button");
          btn.id = BTN_ID;
          btn.className = "ytp-button";
          btn.setAttribute("aria-label", "Miniplayer");
          btn.setAttribute("aria-keyshortcuts", "i");
          btn.appendChild(buildIcon());
          btn.addEventListener("click", triggerMiniplayer);
          btn.addEventListener("mouseenter", showTooltip);
          btn.addEventListener("focus", showTooltip);
          btn.addEventListener("mouseleave", hideTooltip);
          btn.addEventListener("blur", hideTooltip);
          return btn;
        }

        function removeButton() {
          hideTooltip();
          const btn = installedButton?.isConnected
            ? installedButton
            : document.getElementById(BTN_ID);
          if (btn) btn.remove();
          installedButton = null;
        }

        function stopControlObservation() {
          hideTooltip();
          controlObserver.disconnect();
          observedControls = null;
          observedControlTargets = [];
        }

        function syncControlObservation(controls) {
          const targets = [];
          const player = getPlayerEl();
          for (let element = controls; element; element = element.parentElement) {
            targets.push(element);
            if (element === player) break;
          }
          const watchRoot = player?.closest?.("ytd-watch-flexy") || document
            .querySelector("#ytsmp-player-placeholder")?.closest?.("ytd-watch-flexy");
          if (watchRoot && !targets.includes(watchRoot)) targets.push(watchRoot);
          if (
            observedControls === controls &&
            targets.length === observedControlTargets.length &&
            targets.every((target, index) => target === observedControlTargets[index])
          ) return;

          const registrations = targets.map((target) => [target, {
            attributes: true,
            attributeFilter: target === watchRoot ? WATCH_STATE_ATTRIBUTES : CONTROL_STATE_ATTRIBUTES,
            childList: target === controls,
            subtree: target === controls,
          }]);
          if (typeof controlObserver.replaceRegistrations === "function") {
            controlObserver.replaceRegistrations(registrations);
          } else {
            controlObserver.disconnect();
            registrations.forEach(([target, options]) => controlObserver.observe(target, options));
          }
          observedControls = controls;
          observedControlTargets = targets;
        }

        function installOnce() {
          if (!isEligiblePath()) {
            stopControlObservation();
            removeButton();
            return true;
          }

          const controls = getRightControls();
          if (!controls) {
            stopControlObservation();
            return false;
          }
          syncControlObservation(controls);
          if (hasUsableNativeMiniplayer(controls)) {
            removeButton();
            return true;
          }

          const existing = document.getElementById(BTN_ID);
          if (existing && existing.parentElement === controls) {
            installedButton = existing;
            return true;
          }

          const fullscreenBtn = controls.querySelector(FULLSCREEN_BUTTON_SELECTOR);
          const btn = existing || makeButton();
          hideTooltip();

          if (fullscreenBtn && fullscreenBtn.parentElement === controls) {
            controls.insertBefore(btn, fullscreenBtn);
          } else {
            controls.appendChild(btn);
          }
          installedButton = btn;
          return true;
        }

        let pollTimer = 0;
        let installAttemptRoute = "";
        const installAttemptTimers = new Set();

        function clearInstallAttempts() {
          installAttemptTimers.forEach((timer) => clearTimeout(timer));
          installAttemptTimers.clear();
          installAttemptRoute = "";
        }

        function clearPoll() {
          if (!pollTimer) return;
          clearInterval(pollTimer);
          pollTimer = 0;
        }

        function pollUntilInstalled(maxMs = CONFIG.pollMaxMs) {
          if (pollTimer) return;

          const start = Date.now();
          pollTimer = setInterval(() => {
            if (installOnce()) {
              clearPoll();
              return;
            }
            if (Date.now() - start > maxMs) clearPoll();
          }, CONFIG.pollInterval);
        }

        let debTimer = 0;
        function runInstall() {
          clearTimeout(debTimer);
          debTimer = 0;
          ensureStyles();
          if (installOnce()) {
            clearPoll();
            clearInstallAttempts();
            return;
          }
          pollUntilInstalled();
        }

        function debounceInstall(delay = 300) {
          clearTimeout(debTimer);
          debTimer = setTimeout(runInstall, delay);
        }

        function scheduleInstallAttempts(delays) {
          const routeKey = getRouteKey();
          if (routeKey === installAttemptRoute && installAttemptTimers.size) return;

          clearInstallAttempts();
          installAttemptRoute = routeKey;

          delays.forEach((delay) => {
            const timer = setTimeout(() => {
              installAttemptTimers.delete(timer);
              if (getRouteKey() !== routeKey) {
                clearInstallAttempts();
                return;
              }
              runInstall();
              if (!installAttemptTimers.size && installAttemptRoute === routeKey) {
                installAttemptRoute = "";
              }
            }, delay);
            installAttemptTimers.add(timer);
          });
        }

        const controlObserver = new MutationObserver((mutations) => {
          hideTooltipForMutations(mutations);
          if (isEligiblePath()) debounceInstall(150);
        });

        function isCommentContentMutation(mutation) {
          const target = mutation.target?.closest
            ? mutation.target
            : mutation.target?.parentElement;
          if (
            mutation.type !== "childList" || !target?.closest?.("ytd-comments") ||
            target.closest(PLAYER_CONTROL_SELECTOR)
          ) return false;

          return [...mutation.addedNodes, ...mutation.removedNodes].every((node) =>
            !node.matches?.(PLAYER_TOPOLOGY_SELECTOR) &&
            !node.querySelector?.(PLAYER_TOPOLOGY_SELECTOR),
          );
        }

        function isSuiteDialogContentMutation(mutation) {
          if (mutation.type !== "childList") return false;
          const target = mutation.target?.closest ? mutation.target : mutation.target?.parentElement;
          const dialog = target?.closest?.("dialog");
          if (
            typeof HTMLDialogElement !== "function" || !(dialog instanceof HTMLDialogElement) ||
            !dialog.isConnected || dialog.parentElement !== document.body ||
            !["ytms-settings-dialog", "ytms-age-dialog"].includes(dialog.id) ||
            target.closest(PLAYER_TOPOLOGY_SELECTOR)
          ) return false;

          return [...mutation.addedNodes, ...mutation.removedNodes].every((node) =>
            !node.matches?.(PLAYER_TOPOLOGY_SELECTOR) &&
            !node.querySelector?.(PLAYER_TOPOLOGY_SELECTOR),
          );
        }

        const mo = new MutationObserver((muts) => {
          hideTooltipForMutations(muts);
          // These native dialogues contain only Suite controls, not the watch player.
          // Their mounting/removal and any mixed/native topology batch still fall through.
          if (muts.length && muts.every(isSuiteDialogContentMutation)) return;
          // Ordinary comment updates cannot replace the installed toolbar. Keep the
          // existing discovery path for unknown/structural batches and detached owners.
          if (observedControls?.isConnected && muts.length && muts.every(isCommentContentMutation)) return;
          // The narrow observer owns changes inside the current toolbar. This broad
          // child-list observer only discovers its initial creation or replacement.
          if (observedControls?.isConnected && getPlayerEl()?.contains(observedControls)) return;

          for (const m of muts) {
            if (
              (m.addedNodes && m.addedNodes.length) ||
              (m.removedNodes && m.removedNodes.length)
            ) {
              debounceInstall(150);
              break;
            }
          }
        });

        function beginObserve() {
          if (observing || !isEligiblePath()) return;

          try {
            mo.observe(document.documentElement, { childList: true, subtree: true });
            observing = true;
          } catch {}
        }

        function stopObserve() {
          stopControlObservation();
          if (!observing) return;

          mo.disconnect();
          observing = false;
        }

        function onNavigate() {
          hideTooltip();
          if (!isEligiblePath()) {
            clearTimeout(debTimer);
            debTimer = 0;
            clearInstallAttempts();
            stopObserve();
            clearPoll();
            removeButton();
            return;
          }

          beginObserve();
          scheduleInstallAttempts(CONFIG.navRetryDelays);
        }

        document.addEventListener("keydown", (event) => {
          if (event.key === "Escape") hideTooltip();
        });
        document.addEventListener("fullscreenchange", hideTooltip, true);
        suite.addWindowListener("blur", hideTooltip, true);
        suite.addWindowListener("resize", onTooltipResize, true);
        suite.addWindowListener("yt-navigate-start", hideTooltip);
        suite.addWindowListener("yt-navigate-finish", onNavigate);
        suite.addWindowListener("yt-page-data-updated", onNavigate);
        suite.addWindowListener("pagehide", () => {
          clearTimeout(debTimer);
          debTimer = 0;
          clearInstallAttempts();
          clearPoll();
          stopObserve();
        });
        suite.addWindowListener("pageshow", onNavigate);

        ensureStyles();
        runInstall();
        beginObserve();
    },
  );

  suite.registerModule(
    "pageCoherence",
    "Page Coherence Guard v1.15",
    "document-idle",
    () => {
      const MutationObserver = suite.SharedMutationObserver;
      const GM_addStyle = (css) => suite.setStyle("pageCoherence", css);

      "use strict";

        const CONFIG = Object.freeze({
          checkDelaysMs: [600, 1600, 3200],
          staleRecoveryDelaysMs: [2000, 5000, 10000],
          mismatchesBeforeWarning: 2,
          eventHistoryLimit: 20,
          loadingRecoveryGraceMs: 3200,
        });
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
        let navigationStartedAt = Date.now();
        let navigationInProgress = false;
        let navigationSourceVideoId = "";
        let navigationRecoveryEvidenceVideoId = "";
        let pageSuspended = false;
        let loadingRecoveryStatus = "not-attempted";

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

        const getPlayerData = (player = getActivePlayer()) => readPlayerData(player);

        const isRenderedWatchFlexy = (flexy) => isRenderedElement(flexy);

        const getActiveWatchFlexy = (player = getActivePlayer()) => {
          const playerFlexy = player?.closest?.("ytd-watch-flexy");
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
          const watchResponseVideoId =
            flexy?.data?.currentVideoEndpoint?.watchEndpoint?.videoId || "";
          if (
            flexy?.loading === false &&
            watchResponseVideoId &&
            flexy.videoId === watchResponseVideoId &&
            urlVideoId === watchResponseVideoId &&
            playerVideoId === watchResponseVideoId
          ) {
            return {
              videoId: watchResponseVideoId,
              dataVideoId: watchResponseVideoId,
              attributeVideoId,
              source: "watch-response-confirmed-by-url-player",
            };
          }
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

        const getWatchControllerVideoId = (flexy) =>
          flexy?.watchController?.watchNextResponse?.currentVideoEndpoint
            ?.watchEndpoint?.videoId || "";

        const getIdentityState = ({
          watchPath,
          urlVideoId,
          playerVideoId,
          flexyVideoId,
          watchControllerVideoId,
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
            "urlController",
            urlVideoId,
            watchControllerVideoId,
            "url-watch-controller-disagreement",
          );
          compare(
            "playerController",
            playerVideoId,
            watchControllerVideoId,
            "player-watch-controller-disagreement",
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

        const commentIdsExcludeCurrentVideo = (videoIds, currentVideoId) =>
          Boolean(
            currentVideoId &&
              videoIds.length &&
              videoIds.every((videoId) => videoId !== currentVideoId),
          );

        const buildSnapshot = () => {
          const player = getActivePlayer();
          const playerData = getPlayerData(player);
          const queue = getQueueState();
          const urlVideoId = getVideoIdFromUrl(location.href);
          const playerVideoId = playerData.video_id || "";
          const activeFlexy = getActiveWatchFlexy(player);
          const comments = activeFlexy?.querySelector("ytd-comments");
          const commentVideoIds = getCommentVideoIds(comments);
          const flexyIdentity = getFlexyVideoIdentity(
            activeFlexy,
            urlVideoId,
            playerVideoId,
          );
          const flexyVideoId = flexyIdentity.videoId;
          const watchControllerVideoId = getWatchControllerVideoId(activeFlexy);
          const watchPath = isWatchPath();
          const identity = getIdentityState({
            watchPath,
            urlVideoId,
            playerVideoId,
            flexyVideoId,
            watchControllerVideoId,
            queueVideoId: queue.videoId,
          });
          const confirmedMismatch = Boolean(
            watchPath &&
              urlVideoId &&
              playerVideoId &&
              flexyVideoId &&
              (urlVideoId !== playerVideoId ||
                urlVideoId !== flexyVideoId ||
                playerVideoId !== flexyVideoId ||
                (watchControllerVideoId && watchControllerVideoId !== urlVideoId)),
          );
          const confirmedCoherent = Boolean(
            !watchPath ||
              (urlVideoId &&
                playerVideoId &&
                flexyVideoId &&
                urlVideoId === playerVideoId &&
                playerVideoId === flexyVideoId &&
                (!watchControllerVideoId || watchControllerVideoId === urlVideoId)),
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
            nativeLoading: activeFlexy?.loading === true,
            watchControllerVideoId,
            queueVideoId: queue.videoId,
            queueTitle: queue.title,
            identityStatus: identity.status,
            identityReasons: identity.reasons,
            identityComparisons: identity.comparisons,
            commentsPresent: Boolean(comments),
            commentsHiddenAsStale:
              comments?.getAttribute(COMMENTS_STALE_ATTRIBUTE) === "1",
            commentVideoIds,
            confirmedStaleComments: commentIdsExcludeCurrentVideo(
              commentVideoIds,
              urlVideoId,
            ),
            confirmedMismatch,
            confirmedCoherent,
            stalePageData,
            mismatchChecks: consecutiveMismatchChecks,
            loadingRecoveryStatus,
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

        const recoverCompletedWatchResponse = (snapshot) => {
          if (
            !isWatchPath() ||
            pageSuspended ||
            (navigationInProgress &&
              (snapshot.urlVideoId === navigationSourceVideoId ||
                navigationRecoveryEvidenceVideoId !== snapshot.urlVideoId)) ||
            document.visibilityState !== "visible" ||
            loadingRecoveryStatus !== "not-attempted" ||
            Date.now() - navigationStartedAt < CONFIG.loadingRecoveryGraceMs ||
            !snapshot.urlVideoId ||
            snapshot.urlVideoId !== snapshot.playerVideoId
          ) return false;

          const flexy = getActiveWatchFlexy();
          // loading can already be false while the controller still owns the
          // previous video's response, leaving metadata and comments unchanged.
          const controllerVideoId = getWatchControllerVideoId(flexy);
          const staleCompletedController = Boolean(
            flexy?.loading === false &&
              controllerVideoId &&
              controllerVideoId !== snapshot.urlVideoId,
          );
          // Comments can retain the previous video even after metadata and the
          // controller finish. Only timestamp permalinks wholly excluding the
          // current video certify this case; partial or unidentified data does not.
          const staleCompletedComments = Boolean(
            flexy?.loading === false &&
              snapshot.confirmedCoherent &&
              controllerVideoId === snapshot.urlVideoId &&
              snapshot.confirmedStaleComments,
          );
          if (
            !isRenderedWatchFlexy(flexy) ||
            (flexy.loading !== true &&
              !staleCompletedController &&
              !staleCompletedComments) ||
            typeof flexy.updatePageData_ !== "function"
          ) return false;

          const page = document.querySelector("ytd-app")?.data;
          const response = page?.response;
          if (
            page?.page !== "watch" ||
            getVideoIdFromUrl(page.url) !== snapshot.urlVideoId ||
            response?.currentVideoEndpoint?.watchEndpoint?.videoId !== snapshot.urlVideoId ||
            !response?.contents?.twoColumnWatchNextResults ||
            flexy.data !== response
          ) return false;

          // Finish only the response already accepted by this watch component.
          // Do not fetch, navigate, copy data, or force loading CSS off. Mark before
          // calling native code so synchronous events cannot trigger another attempt.
          loadingRecoveryStatus = "attempted";
          try {
            flexy.updatePageData_(response);
            const completedControllerVideoId = getWatchControllerVideoId(flexy);
            loadingRecoveryStatus =
              flexy.loading === false &&
              ((!staleCompletedController && !completedControllerVideoId) ||
                completedControllerVideoId === snapshot.urlVideoId) &&
              (!staleCompletedComments ||
                !commentIdsExcludeCurrentVideo(
                  getCommentVideoIds(flexy.querySelector("ytd-comments")),
                  snapshot.urlVideoId,
                ))
                ? "completed"
                : "pending";
          } catch {
            loadingRecoveryStatus = "failed";
          }
          return true;
        };

        const checkSnapshot = (snapshot) => {
          if (recoverCompletedWatchResponse(snapshot)) snapshot = buildSnapshot();
          const responseRecoveryPending = Boolean(
            (snapshot.nativeLoading ||
              (snapshot.confirmedCoherent &&
                snapshot.confirmedStaleComments &&
                snapshot.watchControllerVideoId === snapshot.urlVideoId)) &&
              loadingRecoveryStatus === "not-attempted" &&
              snapshot.urlVideoId &&
              snapshot.urlVideoId === snapshot.playerVideoId,
          );

          if (snapshot.confirmedMismatch) {
            consecutiveMismatchChecks += 1;
            if (consecutiveMismatchChecks >= CONFIG.mismatchesBeforeWarning) {
              setStalePageData(true);
            }
          } else if (snapshot.confirmedCoherent || !isWatchPath()) {
            consecutiveMismatchChecks = 0;
            setStalePageData(false);
            if (!responseRecoveryPending) clearStaleRecoveryChecks();
          }

          if (stalePageData || responseRecoveryPending) {
            scheduleStaleRecoveryChecks(snapshot);
          }

          snapshot.stalePageData = stalePageData;
          snapshot.mismatchChecks = consecutiveMismatchChecks;
          return publishState(snapshot);
        };

        // Public/manual checks and delayed work always read current native state.
        const runCoherenceCheck = () => checkSnapshot(buildSnapshot());

        const clearScheduledChecks = () => {
          checkTimers.forEach((timerId) => clearTimeout(timerId));
          checkTimers.clear();
        };

        const beginNavigationGeneration = (videoId = "") => {
          navigationGeneration += 1;
          navigationVideoId = videoId;
          staleRecoveryKey = "";
          consecutiveMismatchChecks = 0;
          navigationStartedAt = Date.now();
          navigationRecoveryEvidenceVideoId = "";
          loadingRecoveryStatus = "not-attempted";
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

        const scheduleChecks = (eventSnapshot = null) => {
          if (!isWatchPath()) {
            clearStaleRecoveryChecks();
            // The event recorder just read this same off-watch state synchronously.
            // Reuse only that call's snapshot, not data from an earlier event/check.
            if (eventSnapshot) checkSnapshot(eventSnapshot);
            else runCoherenceCheck();
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
          return publishState(snapshot);
        };

        const handleNavigateStart = () => {
          navigationSourceVideoId = getVideoIdFromUrl(location.href);
          beginNavigationGeneration();
          navigationInProgress = true;
          recordNavigationEvent("yt-navigate-start");
        };

        const handleNavigationUpdate = (event) => {
          alignNavigationGenerationToCurrentUrl();
          if (event.type === "yt-navigate-finish") navigationInProgress = false;
          if (event.type === "yt-page-data-updated") {
            navigationRecoveryEvidenceVideoId = getVideoIdFromUrl(location.href);
          }
          scheduleChecks(recordNavigationEvent(event.type));
        };

        const handleNativeCommentsReady = (event) => {
          if (
            loadingRecoveryStatus !== "pending" ||
            pageSuspended ||
            document.visibilityState !== "visible" ||
            !isWatchPath()
          ) return;

          const flexy = getActiveWatchFlexy();
          if (
            event.target !== flexy ||
            !isRenderedWatchFlexy(flexy) ||
            flexy.loading !== false
          ) return;

          const snapshot = buildSnapshot();
          if (
            !snapshot.confirmedCoherent ||
            snapshot.watchControllerVideoId !== snapshot.urlVideoId ||
            snapshot.commentVideoIds.length !== 1 ||
            snapshot.commentVideoIds[0] !== snapshot.urlVideoId
          ) return;

          // Native comments refresh is asynchronous. Reconcile its diagnostic
          // result only; never replay completion or replenish the attempt budget.
          loadingRecoveryStatus = "completed";
          publishState({ ...snapshot, loadingRecoveryStatus });
        };

        const handlePageHide = () => {
          pageSuspended = true;
          beginNavigationGeneration();
          navigationInProgress = true;
        };

        const handlePageShow = () => {
          pageSuspended = false;
          beginNavigationGeneration(getVideoIdFromUrl(location.href));
          navigationInProgress = false;
          scheduleChecks(recordNavigationEvent("pageshow"));
        };

        globalThis.__YT_MASTER_STATE__ = Object.freeze({
          check: runCoherenceCheck,
          events: () => navigationEvents.map((entry) => ({ ...entry })),
          snapshot: () => publishState(buildSnapshot()),
        });

        suite.addWindowListener("yt-navigate-start", handleNavigateStart, true);
        suite.addWindowListener("yt-navigate-finish", handleNavigationUpdate, true);
        suite.addWindowListener("yt-page-data-updated", handleNavigationUpdate, true);
        suite.addWindowListener("yt-watch-comments-ready", handleNativeCommentsReady, true);
        suite.addWindowListener("pagehide", handlePageHide, true);
        suite.addWindowListener("pageshow", handlePageShow, true);
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
            // Current-video progress can outlive a lost navigate-finish event.
            // Recovery still requires a changed URL and the exact accepted response.
            navigationRecoveryEvidenceVideoId = getVideoIdFromUrl(location.href);
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
    },
  );

  suite.registerModule(
    "playerPreferencesLite",
    "Player Preferences Lite v1.76",
    "document-idle",
    () => {
      const MutationObserver = suite.SharedMutationObserver;
      const GM_addStyle = (css) => suite.setStyle("playerPreferencesLite", css);

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
          showRydTooltipBar: false,
          showDeArrowTitleButton: false,
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
          disableTitleHashtagLinks: false,
          collapseDescriptionBlankRows: true,
          hideStructuredDescription: true,
          hideChat: true,
          hideInfoCards: true,
          hideEndScreenRecommendationGrid: true,
          showAutoplayUpNextCard: true,
          useReadableYellowCaptions: true,
          enableTheaterMode: true,
          preferredVideoQuality: "off",
          enablePlayerWheelVolume: true,
          enableVideoMirrorButton: true,
          enableFullscreenComments: true,
          hideFullscreenQuickActions: false,
          enableCleanVideoUrlCopy: true,
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
        Object.assign(CONFIG, suite.settings.overrides("playerPreferencesLite", CONFIG));

        const STYLE_ID = "ytppl-style";
        const VIDEO_MIRROR_BUTTON_ID = "ytppl-video-mirror-button";
        const VIDEO_MIRROR_TOOLTIP_ID = "ytppl-video-mirror-tooltip";
        const VIDEO_MIRROR_ATTRIBUTE = "data-ytppl-video-mirrored";
        const VIDEO_MIRROR_ANCHOR_SELECTOR =
          ".ytp-settings-button, .ytp-size-button, .ytp-fullscreen-button, .ytp-miniplayer-button, #tmk-miniplayer-button";
        const VIDEO_MIRROR_SURFACE_SELECTOR = [
          "#movie_player", "video.html5-main-video", ".ytp-right-controls",
          "#ytsmp-player-placeholder", `#${VIDEO_MIRROR_BUTTON_ID}`,
          VIDEO_MIRROR_ANCHOR_SELECTOR,
        ].join(",");
        const FULLSCREEN_COMMENTS_ATTRIBUTE = "data-ytppl-fullscreen-comments";
        const FULLSCREEN_WHEEL_EXCLUDED_SELECTOR = [
          ".ytp-settings-menu",
          ".ytp-popup",
          ".ytp-contextmenu",
          ".ytp-playlist-menu",
          ".ytp-queue-menu",
          '[role="menu"]',
          '[role="listbox"]',
          "dialog",
          '[role="dialog"]',
          '[role="alertdialog"]',
          '[aria-modal="true"]',
          "input",
          "textarea",
          "select",
          "[contenteditable]",
        ].join(",");
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
        const TITLE_HASHTAG_LINK_SELECTOR =
          'ytd-watch-flexy :is(ytd-watch-metadata, ytd-video-primary-info-renderer) h1 ' +
          ':is(a[href^="/hashtag/"], a[href^="https://www.youtube.com/hashtag/"], a[href^="https://youtube.com/hashtag/"])';
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
        const PREFERRED_QUALITY_RETRY_DELAYS_MS = [0, 300, 1000, 2500, 5000, 8000];
        const PLAYER_LAYOUT_REFRESH_DELAYS_MS = [0, 100, 500, 1200];

        let applyFrame = 0;
        const pendingApplyRoots = new Set();
        let legacyActionHiddenCleared = false;
        let theaterModeUserDisabled = false;
        let preferredQualityVideoId = "";
        let preferredQualityNavigationPending = false;
        const preferredQualityRetryTimers = new Set();
        let theaterModeAttemptKey = "";
        let playerLayoutRefreshFrame = 0;
        const playerLayoutRefreshAttemptTimers = new Map();
        let liveChatCollapseAttemptTimers = [];
        let liveChatCollapsePendingTimer = 0;
        let pendingLiveChatFrame = null;
        let rightButtonHeldOnPlayer = false;
        let contextMenuSuppressionExpiresAt = 0;
        let cleanVideoUrlCopyMenu = null;
        let cleanVideoUrlCopyTimer = 0;
        let volumeOverlayHideTimer = 0;
        let videoMirrorFrame = 0;
        let videoMirrorVideoId = "";
        let videoMirrorEnabled = false;
        let videoMirrorVideo = null;
        let videoMirrorButton = null;
        let videoMirrorTooltip = null;
        let videoMirrorTooltipObserver = null;
        let videoMirrorPlayer = null;
        let videoMirrorControls = null;
        let videoMirrorPageSuspended = false;

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
          // Quick actions retain their native artwork even while their strip is hidden.
          if (!button ||
              closestElement(button, ".ytp-fullscreen-quick-actions, yt-player-quick-action-buttons") ||
              closestElement(button, EXCLUDED_SURFACE_SELECTOR)) {
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
          if (!button ||
              closestElement(button, ".ytp-fullscreen-quick-actions, yt-player-quick-action-buttons") ||
              closestElement(button, EXCLUDED_SURFACE_SELECTOR)) {
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

        function isWatchActionMatch(actionElement, label, labels = getWatchActionLabels(actionElement)) {
          const normalisedLabel = label.toLowerCase();

          return labels.some((candidate) => {
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

        function isConfiguredWatchActionMatch(actionElement, readLabels) {
          let labels;
          return WATCH_ACTION_BUTTON_RULES.some(({ configKey, label }) => {
            if (!CONFIG[configKey]) return false;
            labels ||= readLabels ? readLabels() : getWatchActionLabels(actionElement);
            return isWatchActionMatch(actionElement, label, labels);
          });
        }

        function isConfiguredInlineWatchActionMatch(actionElement, readLabels) {
          let labels;
          return WATCH_ACTION_INLINE_BUTTON_RULES.some(({ configKey, label }) => {
            if (!CONFIG[configKey]) return false;
            labels ||= readLabels ? readLabels() : getWatchActionLabels(actionElement);
            return isWatchActionMatch(actionElement, label, labels);
          });
        }

        function hideWatchActionButtons(root = document) {
          collectMatchingElements(root, WATCH_ACTION_BUTTON_SELECTOR).forEach(
            (buttonModel) => {
              if (isPreservedWatchActionButton(buttonModel)) {
                setWatchActionHidden(buttonModel, false);
                return;
              }

              // Labels are stable only within this synchronous row reconciliation.
              // Share its lazy read across menu rules and the inline Save rule.
              let labels;
              const readLabels = () => (labels ||= getWatchActionLabels(buttonModel));
              setWatchActionHidden(
                buttonModel,
                isConfiguredWatchActionMatch(buttonModel, readLabels) ||
                  isConfiguredInlineWatchActionMatch(buttonModel, readLabels),
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
          // YouTube reuses the title's formatted-string nodes between videos. Removing
          // a title run breaks its retained bindings and can also feed DeArrow a suffix.
          if (
            !link ||
            link.closest("h1") ||
            link.dataset.ytpplHashtagRemoved === "1"
          ) {
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
          if (!CONFIG.showRydTooltipBar) {
            // RYD can attach its tooltip outside the watch-page container.
            rules.push(`
              .ryd-tooltip-bar-container {
                display: none !important;
              }
            `);
          }
          if (CONFIG.hideAskButton) {
            rules.push(`
              ytd-menu-renderer .you-chat-entrypoint-button,
              .you-chat-entrypoint-button.ytd-menu-renderer {
                display: none !important;
              }
            `);
          }
          if (!CONFIG.showDeArrowTitleButton) {
            // Hide only DeArrow's watch-title button container, never title content.
            rules.push(`
              ytd-watch-flexy .cbTitleButtonContainer {
                display: none !important;
              }
            `);
          }
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
              :is(
                #segmented-like-button,
                #segmented-dislike-button,
                #like-button,
                #dislike-button,
                like-button-view-model,
                dislike-button-view-model
              )
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
              ytd-watch-flexy ytd-watch-metadata a[href^="/hashtag/"]:not(h1 *),
              ytd-watch-flexy ytd-watch-metadata a[href*="youtube.com/hashtag/"]:not(h1 *),
              ytd-watch-flexy ytd-video-primary-info-renderer a[href^="/hashtag/"]:not(h1 *),
              ytd-watch-flexy ytd-video-primary-info-renderer a[href*="youtube.com/hashtag/"]:not(h1 *),
              ytd-watch-flexy yt-chip-cloud-chip-renderer a[href^="/hashtag/"]:not(h1 *),
              ytd-watch-flexy yt-chip-cloud-chip-renderer a[href*="youtube.com/hashtag/"]:not(h1 *),
              ytd-watch-flexy span:has(> a[href^="/hashtag/"]:only-child):not(h1 *),
              ytd-watch-flexy span:has(> a[href*="youtube.com/hashtag/"]:only-child):not(h1 *) {
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

        function buildFullscreenQuickActionsCss() {
          if (!CONFIG.hideFullscreenQuickActions) return "";

          // Hide only the separate quick-action strip, not the main playback controls.
          return `
              .html5-video-player .ytp-fullscreen-quick-actions {
                display: none !important;
              }
            `;
        }

        function buildFullscreenCommentsCss() {
          if (!CONFIG.enableFullscreenComments) return "";

          // YouTube fullscreens the HTML root: keep its native player geometry and
          // let the app scroll to the existing watch-page content below the player.
          return `
              :root[${FULLSCREEN_COMMENTS_ATTRIBUTE}]:fullscreen ytd-app[fullscreen] {
                overflow-y: auto !important;
                overflow-x: hidden !important;
                height: 100vh !important;
              }

              :root[${FULLSCREEN_COMMENTS_ATTRIBUTE}]:fullscreen ytd-watch-flexy[fullscreen] #columns {
                display: flex !important;
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

        function buildVideoMirrorCss() {
          if (!CONFIG.enableVideoMirrorButton) return "";
          return `
              video.html5-main-video[${VIDEO_MIRROR_ATTRIBUTE}="1"] {
                scale: -1 1 !important;
              }
              #${VIDEO_MIRROR_BUTTON_ID}.ytp-button {
                display: inline-flex !important;
                align-items: center !important;
                justify-content: center !important;
                padding: 0 !important;
                margin: 0 !important;
                line-height: 0 !important;
              }
              #${VIDEO_MIRROR_BUTTON_ID}.ytp-button svg {
                width: 36px !important;
                height: 36px !important;
                min-width: 36px !important;
                min-height: 36px !important;
                max-width: 36px !important;
                max-height: 36px !important;
                display: block !important;
                pointer-events: none !important;
              }
              #${VIDEO_MIRROR_BUTTON_ID}[aria-pressed="true"] .ytp-svg-fill {
                fill: #3ea6ff !important;
              }
              #${VIDEO_MIRROR_TOOLTIP_ID} {
                position: absolute !important;
                z-index: 1000 !important;
                display: flex !important;
                align-items: center !important;
                gap: 4px !important;
                box-sizing: border-box !important;
                max-width: calc(100% - 16px) !important;
                padding: 5px 9px !important;
                border-radius: 2px !important;
                background: rgba(0, 0, 0, 0.9) !important;
                color: #eee !important;
                font: 500 12px/1.2 Roboto, Arial, sans-serif !important;
                text-shadow: none !important;
                pointer-events: none !important;
              }
              #${VIDEO_MIRROR_TOOLTIP_ID} kbd {
                flex: 0 0 auto !important;
                box-sizing: border-box !important;
                min-width: 14px !important;
                height: 16px !important;
                padding: 0 2px !important;
                border: 1px solid #555 !important;
                border-radius: 3px !important;
                background: transparent !important;
                color: inherit !important;
                font: 400 12px/14px Roboto, Arial, sans-serif !important;
                text-align: center !important;
              }
            `;
        }

        function buildTitleHashtagCss() {
          if (!CONFIG.disableTitleHashtagLinks) return "";
          // Styling only: YouTube and DeArrow retain ownership of title runs and hrefs.
          return `
            ${TITLE_HASHTAG_LINK_SELECTOR} {
              color: inherit !important;
              text-decoration: none !important;
              cursor: text !important;
              pointer-events: none !important;
            }
          `;
        }

        function buildCss() {
          return [
            buildVolumeOverlayCss(),
            buildVideoMirrorCss(),
            buildCaptionCss(),
            buildShortsCss(),
            buildFeedCleanupCss(),
            buildWatchCleanupCss(),
            buildTitleHashtagCss(),
            buildWatchLayoutCss(),
            buildFullscreenQuickActionsCss(),
            buildFullscreenCommentsCss(),
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
            suite.removeStyle("playerPreferencesLite");
            return;
          }

          if (suite.setStyle("playerPreferencesLite", css)) {
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
          if (isRenderedWatchFlexy(playerFlexy)) return playerFlexy;

          const placeholderFlexy = document
            .querySelector("#ytsmp-player-placeholder")
            ?.closest?.("ytd-watch-flexy");
          if (isRenderedWatchFlexy(placeholderFlexy)) return placeholderFlexy;

          const flexies = Array.from(document.querySelectorAll("ytd-watch-flexy"));
          return (
            flexies.find(isRenderedWatchFlexy) ||
            flexies.find((flexy) => flexy.isConnected) ||
            null
          );
        }

        function getVideoMirrorRouteId() {
          if (!isWatchPath()) return "";
          return location.pathname === "/watch"
            ? new URLSearchParams(location.search).get("v") || ""
            : location.pathname.split("/")[2] || "";
        }

        function getVideoMirrorTarget(videoId = getVideoMirrorRouteId()) {
          if (!videoId) return null;
          const placeholderOwner = document
            .querySelector("#ytsmp-player-placeholder")
            ?.closest("ytd-watch-flexy");
          const watchOwner = getWatchFlexy();
          const floatingOwner = isRenderedWatchFlexy(placeholderOwner)
            ? placeholderOwner
            : watchOwner;
          for (const player of document.querySelectorAll("#movie_player")) {
            if (
              !isRenderedWatchFlexy(player) ||
              player.closest("ytd-miniplayer, ytd-video-preview, ytd-reel-video-renderer")
            ) continue;

            const owner = player.closest("ytd-watch-flexy") || (
              player.parentElement === document.body ? floatingOwner : null
            );
            if (!isRenderedWatchFlexy(owner)) continue;
            let playerVideoId = "";
            try {
              playerVideoId = player.getVideoData?.()?.video_id || "";
            } catch {
              continue;
            }
            // Never carry the previous video's mirror into a pending SPA handoff.
            if (playerVideoId !== videoId) continue;
            const video = Array.from(player.querySelectorAll("video.html5-main-video"))
              .find(isRenderedWatchFlexy);
            if (video) return { player, video };
          }
          return null;
        }

        function clearVideoMirrorElements() {
          hideVideoMirrorTooltip();
          videoMirrorVideo?.removeAttribute(VIDEO_MIRROR_ATTRIBUTE);
          videoMirrorVideo = null;
          videoMirrorButton?.remove();
          videoMirrorButton = null;
          videoMirrorPlayer = null;
          videoMirrorControls = null;
        }

        function resetVideoMirror() {
          if (videoMirrorFrame) cancelAnimationFrame(videoMirrorFrame);
          videoMirrorFrame = 0;
          clearVideoMirrorElements();
          videoMirrorVideoId = "";
          videoMirrorEnabled = false;
        }

        function handleVideoMirrorClick(event) {
          event.preventDefault();
          event.stopPropagation();
          const videoId = getVideoMirrorRouteId();
          const target = getVideoMirrorTarget(videoId);
          if (
            !CONFIG.enableVideoMirrorButton || videoMirrorPageSuspended ||
            event.currentTarget !== videoMirrorButton || !target ||
            videoId !== videoMirrorVideoId || target.video !== videoMirrorVideo
          ) {
            scheduleVideoMirrorSync();
            return;
          }
          videoMirrorEnabled = !videoMirrorEnabled;
          syncVideoMirror();
        }

        function getVideoMirrorLabel() {
          return videoMirrorEnabled ? "Restore original video" : "Mirror video";
        }

        function hideVideoMirrorTooltip() {
          videoMirrorTooltipObserver?.disconnect();
          videoMirrorTooltipObserver = null;
          document.removeEventListener("pointermove", handleVideoMirrorTooltipPointerMove, true);
          document.removeEventListener("pointerdown", hideVideoMirrorTooltip, true);
          document.removeEventListener("pointercancel", hideVideoMirrorTooltip, true);
          document.removeEventListener("mouseleave", handleVideoMirrorTooltipDocumentLeave, true);
          document.removeEventListener("scroll", hideVideoMirrorTooltip, true);
          document.removeEventListener("visibilitychange", handleVideoMirrorTooltipVisibility, true);
          videoMirrorTooltip?.remove();
          videoMirrorTooltip = null;
          videoMirrorButton?.removeAttribute("aria-describedby");
        }

        function isVideoMirrorTooltipOwnerVisible() {
          if (
            document.hidden || !videoMirrorButton?.isConnected || !videoMirrorPlayer?.isConnected ||
            !videoMirrorPlayer.contains(videoMirrorButton) || videoMirrorPlayer.matches(".ytp-autohide")
          ) return false;
          for (let element = videoMirrorButton; element; element = element.parentElement) {
            if (element.hidden || element.getAttribute("aria-hidden") === "true") return false;
            const style = getComputedStyle(element);
            if (
              style.display === "none" || style.visibility === "hidden" ||
              style.visibility === "collapse" || style.opacity === "0"
            ) return false;
          }
          return true;
        }

        function handleVideoMirrorTooltipPointerMove(event) {
          if (!videoMirrorTooltip) return;
          const rect = videoMirrorButton?.getBoundingClientRect();
          if (
            !videoMirrorButton?.contains(event.target) || !rect?.width || !rect.height ||
            (Number.isFinite(event.clientX) && Number.isFinite(event.clientY) &&
              (event.clientX < rect.left || event.clientX >= rect.right ||
                event.clientY < rect.top || event.clientY >= rect.bottom))
          ) hideVideoMirrorTooltip();
        }

        function handleVideoMirrorTooltipVisibility() {
          if (document.hidden) hideVideoMirrorTooltip();
        }

        function handleVideoMirrorTooltipDocumentLeave(event) {
          if (event.target === document || event.target === document.documentElement) hideVideoMirrorTooltip();
        }

        function positionVideoMirrorTooltip() {
          if (!videoMirrorTooltip) return;
          if (
            !isVideoMirrorTooltipOwnerVisible() ||
            videoMirrorTooltip.parentElement !== videoMirrorPlayer
          ) {
            hideVideoMirrorTooltip();
            return;
          }
          const label = videoMirrorTooltip.firstElementChild;
          const text = getVideoMirrorLabel();
          if (label.textContent !== text) label.textContent = text;
          const playerRect = videoMirrorPlayer.getBoundingClientRect();
          const buttonRect = videoMirrorButton.getBoundingClientRect();
          if (!playerRect.width || !playerRect.height || !buttonRect.width || !buttonRect.height) {
            hideVideoMirrorTooltip();
            return;
          }
          // Keep the tooltip inside this player, including scaled floating players.
          // Measurements happen only on interaction/reconciliation, never on a timer.
          const width = videoMirrorPlayer.offsetWidth || playerRect.width;
          const height = videoMirrorPlayer.offsetHeight || playerRect.height;
          const scaleX = playerRect.width / width;
          const scaleY = playerRect.height / height;
          const left = (buttonRect.left + buttonRect.width / 2 - playerRect.left) / scaleX -
            videoMirrorTooltip.offsetWidth / 2;
          const progress = videoMirrorPlayer.querySelector(".ytp-progress-bar-container");
          const progressRect = isRenderedWatchFlexy(progress) ? progress.getBoundingClientRect() : null;
          const progressAboveControls = progressRect?.width > 0 && progressRect.height > 0 &&
            progressRect.top >= playerRect.top && progressRect.bottom <= buttonRect.top + 1 &&
            progressRect.left >= playerRect.left - 1 && progressRect.right <= playerRect.right + 1;
          // Native tooltips clear the seek bar, not just the button hit area. Retain a
          // larger button-relative gap when YouTube hides or rebuilds the seek bar.
          const tooltipBottom = progressAboveControls
            ? (progressRect.top - playerRect.top) / scaleY - 8
            : (buttonRect.top - playerRect.top) / scaleY - 20;
          const top = tooltipBottom - videoMirrorTooltip.offsetHeight;
          const nextLeft = `${Math.round(Math.max(8, Math.min(left, width - videoMirrorTooltip.offsetWidth - 8)))}px`;
          const nextTop = `${Math.round(Math.max(8, top))}px`;
          if (videoMirrorTooltip.style.left !== nextLeft) videoMirrorTooltip.style.left = nextLeft;
          if (videoMirrorTooltip.style.top !== nextTop) videoMirrorTooltip.style.top = nextTop;
        }

        function refreshVideoMirrorTooltip() {
          if (!videoMirrorTooltip) return;
          if (
            videoMirrorButton?.matches(":hover") ||
            (document.activeElement === videoMirrorButton && videoMirrorButton.matches(":focus-visible"))
          ) positionVideoMirrorTooltip();
          else hideVideoMirrorTooltip();
        }

        function showVideoMirrorTooltip(event) {
          if (
            !CONFIG.enableVideoMirrorButton || videoMirrorPageSuspended ||
            event.currentTarget !== videoMirrorButton || !isVideoMirrorTooltipOwnerVisible() ||
            (event.type === "focus" && !videoMirrorButton.matches(":focus-visible"))
          ) return;
          const target = getVideoMirrorTarget();
          if (!target || target.player !== videoMirrorPlayer || target.video !== videoMirrorVideo) return;
          if (!videoMirrorTooltip) {
            const tooltip = document.createElement("div");
            tooltip.id = VIDEO_MIRROR_TOOLTIP_ID;
            tooltip.setAttribute("role", "tooltip");
            const label = document.createElement("span");
            label.textContent = getVideoMirrorLabel();
            const key = document.createElement("kbd");
            key.textContent = "H";
            tooltip.appendChild(label);
            tooltip.appendChild(key);
            videoMirrorTooltip = videoMirrorPlayer.appendChild(tooltip);
            videoMirrorButton.setAttribute("aria-describedby", VIDEO_MIRROR_TOOLTIP_ID);
            // Only a visible tooltip needs missed-exit/lifecycle protection. Observe
            // the owner's own ancestors, not the changing player/page subtree.
            document.addEventListener("pointermove", handleVideoMirrorTooltipPointerMove, true);
            document.addEventListener("pointerdown", hideVideoMirrorTooltip, true);
            document.addEventListener("pointercancel", hideVideoMirrorTooltip, true);
            document.addEventListener("mouseleave", handleVideoMirrorTooltipDocumentLeave, true);
            document.addEventListener("scroll", hideVideoMirrorTooltip, true);
            document.addEventListener("visibilitychange", handleVideoMirrorTooltipVisibility, true);
            videoMirrorTooltipObserver = new MutationObserver(() => {
              if (!isVideoMirrorTooltipOwnerVisible()) hideVideoMirrorTooltip();
            });
            const registrations = [];
            for (let element = videoMirrorButton; element; element = element.parentElement) {
              registrations.push([element, {
                attributes: true,
                attributeFilter: ["class", "style", "hidden", "aria-hidden"],
              }]);
            }
            // Register this complete owner chain once. Sequential observe calls
            // otherwise rebuild the master's shared native observer for each ancestor.
            replaceObserverRegistrations(videoMirrorTooltipObserver, registrations);
          }
          positionVideoMirrorTooltip();
        }

        function handleVideoMirrorKeyDown(event) {
          if (event.key === "Escape") {
            hideVideoMirrorTooltip();
            return; // Leave YouTube/browser fullscreen and menu handling untouched.
          }
          if (
            !CONFIG.enableVideoMirrorButton || videoMirrorPageSuspended ||
            event.defaultPrevented || event.repeat || event.isComposing || event.keyCode === 229 ||
            event.ctrlKey || event.altKey || event.metaKey || event.shiftKey ||
            event.key?.toLowerCase() !== "h" || !videoMirrorButton?.isConnected
          ) return;
          const node = event.target;
          const focus = document.activeElement;
          const excluded = 'input, textarea, select, dialog, [contenteditable], [role="textbox"], [role="searchbox"], ' +
            '[role="combobox"], [role="slider"], [role="menu"], [role="listbox"], [role="dialog"], ' +
            '[role="alertdialog"], [aria-modal="true"], .ytp-settings-menu, .ytp-popup, .ytp-panel, .ytp-contextmenu';
          if (
            !videoMirrorPlayer?.contains(node) || !videoMirrorPlayer.contains(focus) ||
            node.isContentEditable || focus.isContentEditable ||
            node.closest?.(excluded) || focus.closest?.(excluded)
          ) return;
          const videoId = getVideoMirrorRouteId();
          const target = getVideoMirrorTarget(videoId);
          if (
            !target || target.player !== videoMirrorPlayer || target.video !== videoMirrorVideo ||
            videoId !== videoMirrorVideoId || !videoMirrorPlayer.contains(videoMirrorButton)
          ) return;
          event.preventDefault();
          event.stopPropagation();
          videoMirrorButton.click();
        }

        function createVideoMirrorButton() {
          const button = document.createElement("button");
          button.id = VIDEO_MIRROR_BUTTON_ID;
          button.type = "button";
          button.className = "ytp-button";
          button.setAttribute("aria-label", "Mirror video horizontally");
          button.setAttribute("aria-pressed", "false");
          button.setAttribute("aria-keyshortcuts", "H");
          const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
          svg.setAttribute("viewBox", "0 0 36 36");
          svg.setAttribute("width", "36");
          svg.setAttribute("height", "36");
          svg.setAttribute("aria-hidden", "true");
          svg.setAttribute("focusable", "false");
          const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
          path.setAttribute("class", "ytp-svg-fill");
          path.setAttribute("d", "M17 7h2v4h-2zm0 6h2v4h-2zm0 6h2v4h-2zm0 6h2v4h-2zM5 11l9 7-9 7zm26 0v14l-9-7z");
          svg.appendChild(path);
          button.appendChild(svg);
          button.addEventListener("click", handleVideoMirrorClick);
          button.addEventListener("mouseenter", showVideoMirrorTooltip);
          button.addEventListener("focus", showVideoMirrorTooltip);
          button.addEventListener("mouseleave", hideVideoMirrorTooltip);
          button.addEventListener("blur", hideVideoMirrorTooltip);
          return button;
        }

        function placeVideoMirrorButton(controls) {
          const settingsButton = controls.querySelector(".ytp-settings-button");
          const defaultViewButton = controls.querySelector(".ytp-size-button");
          const [beforeButton, afterButton] = settingsButton || defaultViewButton
            ? [settingsButton, defaultViewButton]
            : [controls.querySelector(".ytp-fullscreen-button"),
                controls.querySelector("#tmk-miniplayer-button") ||
                controls.querySelector(".ytp-miniplayer-button")];
          const parent = beforeButton?.parentElement || afterButton?.parentElement || controls;
          let next = beforeButton || afterButton || null;
          // Keep the native controls in their existing order, including nested or
          // right-floated toolbars. Prefer Settings / Default view; retain the old
          // fallback while YouTube has not yet created either preferred anchor.
          if (
            beforeButton && (
              (afterButton && (beforeButton.compareDocumentPosition(afterButton) &
                Node.DOCUMENT_POSITION_FOLLOWING)) ||
              (settingsButton && !afterButton)
            )
          ) next = beforeButton.nextSibling;

          // The suite's panel shortcut belongs immediately before Mirror video.
          // Respect it when this module reconciles or recreates native controls.
          if (next?.id === "ytms-player-settings-button") next = next.nextSibling;

          if (
            next !== videoMirrorButton &&
            (videoMirrorButton.parentElement !== parent || videoMirrorButton.nextSibling !== next)
          ) {
            hideVideoMirrorTooltip();
            parent.insertBefore(videoMirrorButton, next);
          }
        }

        function syncVideoMirror() {
          if (videoMirrorFrame) cancelAnimationFrame(videoMirrorFrame);
          videoMirrorFrame = 0;
          const videoId = getVideoMirrorRouteId();
          if (!CONFIG.enableVideoMirrorButton || videoMirrorPageSuspended || !videoId) {
            resetVideoMirror();
            return;
          }
          if (videoMirrorVideoId !== videoId) {
            clearVideoMirrorElements();
            videoMirrorVideoId = videoId;
            videoMirrorEnabled = false;
          }
          const target = getVideoMirrorTarget(videoId);
          if (!target) {
            clearVideoMirrorElements();
            return;
          }
          if (videoMirrorVideo !== target.video) {
            hideVideoMirrorTooltip();
            videoMirrorVideo?.removeAttribute(VIDEO_MIRROR_ATTRIBUTE);
            videoMirrorVideo = target.video;
          }
          if (videoMirrorPlayer !== target.player) hideVideoMirrorTooltip();
          videoMirrorPlayer = target.player;
          if (videoMirrorEnabled) {
            if (videoMirrorVideo.getAttribute(VIDEO_MIRROR_ATTRIBUTE) !== "1") {
              videoMirrorVideo.setAttribute(VIDEO_MIRROR_ATTRIBUTE, "1");
            }
          } else if (videoMirrorVideo.hasAttribute(VIDEO_MIRROR_ATTRIBUTE)) {
            videoMirrorVideo.removeAttribute(VIDEO_MIRROR_ATTRIBUTE);
          }

          const controls = target.player.querySelector(".ytp-right-controls");
          if (videoMirrorControls !== controls) hideVideoMirrorTooltip();
          videoMirrorControls = controls;
          if (!controls) {
            videoMirrorButton?.remove();
            videoMirrorButton = null;
            return;
          }
          videoMirrorButton ||= createVideoMirrorButton();
          placeVideoMirrorButton(controls);
          const pressed = String(videoMirrorEnabled);
          if (videoMirrorButton.getAttribute("aria-pressed") !== pressed) {
            videoMirrorButton.setAttribute("aria-pressed", pressed);
          }
          positionVideoMirrorTooltip();
        }

        function scheduleVideoMirrorSync() {
          if (!CONFIG.enableVideoMirrorButton || videoMirrorPageSuspended || videoMirrorFrame) return;
          videoMirrorFrame = requestAnimationFrame(syncVideoMirror);
        }

        function mutationAffectsVideoMirror(mutation) {
          if (
            !CONFIG.enableVideoMirrorButton || videoMirrorPageSuspended ||
            !isWatchPath() || mutation.type !== "childList"
          ) return false;
          if (
            videoMirrorVideo?.isConnected && videoMirrorButton?.isConnected &&
            videoMirrorControls?.isConnected && videoMirrorPlayer?.isConnected &&
            videoMirrorControls.contains(videoMirrorButton) &&
            videoMirrorPlayer.contains(videoMirrorControls) &&
            videoMirrorPlayer.contains(videoMirrorVideo)
          ) {
            // Reconcile late/replaced placement anchors, not unrelated page traffic.
            if (!videoMirrorControls.contains(mutation.target)) return false;
            return [...mutation.addedNodes, ...mutation.removedNodes].some((node) =>
              node.nodeType === Node.ELEMENT_NODE &&
              (node.matches(VIDEO_MIRROR_ANCHOR_SELECTOR) ||
                Boolean(node.querySelector(VIDEO_MIRROR_ANCHOR_SELECTOR))),
            );
          }
          const ignoredSurface = "ytd-comments, .ytp-caption-window-container, .ytp-progress-bar-container";
          if (mutation.target?.closest?.(ignoredSurface)) return false;
          return [...mutation.addedNodes, ...mutation.removedNodes].some((node) => {
            if (node.nodeType !== Node.ELEMENT_NODE) return false;
            if (node.matches(ignoredSurface)) return false;
            if (node.id === VIDEO_MIRROR_BUTTON_ID) {
              // Ignore our own insertion/cleanup, but repair a button removed by YouTube.
              return node === videoMirrorButton && !node.isConnected;
            }
            return node.matches(VIDEO_MIRROR_SURFACE_SELECTOR) ||
              Boolean(node.querySelector(VIDEO_MIRROR_SURFACE_SELECTOR));
          });
        }

        function handleVideoMirrorMetadata(event) {
          if (
            !event.target?.matches?.("video.html5-main-video") ||
            !event.target.closest("#movie_player") ||
            event.target.closest("ytd-miniplayer, ytd-video-preview, ytd-reel-video-renderer")
          ) return;
          scheduleVideoMirrorSync();
        }

        function syncFullscreenComments() {
          const root = document.documentElement;
          if (!root) return;

          root.toggleAttribute(
            FULLSCREEN_COMMENTS_ATTRIBUTE,
            Boolean(
              CONFIG.enableFullscreenComments &&
                isWatchPath() &&
                document.fullscreenElement === root,
            ),
          );
        }

        function hasNestedFullscreenWheelSurface(target, player) {
          if (closestElement(target, FULLSCREEN_WHEEL_EXCLUDED_SELECTOR)) return true;

          let element = target?.nodeType === Node.ELEMENT_NODE
            ? target
            : target?.parentElement;
          while (element && element !== player) {
            const overflowY = getComputedStyle(element).overflowY;
            if (
              /^(auto|scroll|overlay)$/.test(overflowY) &&
              element.scrollHeight > element.clientHeight
            ) return true;
            element = element.parentElement;
          }
          return false;
        }

        function handleFullscreenCommentsWheel(event) {
          const root = document.documentElement;
          if (
            !CONFIG.enableFullscreenComments ||
            !root?.hasAttribute(FULLSCREEN_COMMENTS_ATTRIBUTE) ||
            document.fullscreenElement !== root ||
            !isWatchPath() ||
            event.defaultPrevented ||
            !event.cancelable ||
            event.buttons ||
            rightButtonHeldOnPlayer ||
            event.ctrlKey || event.altKey || event.metaKey || event.shiftKey ||
            !Number.isFinite(event.deltaY) ||
            !event.deltaY ||
            Math.abs(event.deltaX || 0) >= Math.abs(event.deltaY)
          ) return;

          const player = getPlayerFromTarget(event.target);
          if (!player || hasNestedFullscreenWheelSurface(event.target, player)) return;

          const flexy = getWatchFlexy();
          const app = flexy?.closest("ytd-app[fullscreen]");
          if (!flexy?.contains(player) || !app) return;

          const maxScrollTop = app.scrollHeight - app.clientHeight;
          if (maxScrollTop <= 0) return;
          const unit = event.deltaMode === 1 ? 40
            : event.deltaMode === 2 ? app.clientHeight : 1;
          app.scrollTop = clamp(app.scrollTop + event.deltaY * unit, 0, maxScrollTop);
          event.preventDefault();
          event.stopImmediatePropagation();
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

        function getPreferredQualityLevel(levels, preference = CONFIG.preferredVideoQuality) {
          if (!Array.isArray(levels) || !preference || preference === "off") return "";
          const limit = preference === "highest" ? 0 : QUALITY_LEVELS_HIGH_TO_LOW.indexOf(preference);
          if (limit < 0) return "";
          // Unknown quality IDs are not guessed, and a fixed preference never picks
          // a higher resolution when no equal/lower stream is available.
          return QUALITY_LEVELS_HIGH_TO_LOW.slice(limit).find((quality) => levels.includes(quality)) || "";
        }

        function clearPreferredQualityAttempts() {
          preferredQualityRetryTimers.forEach((timerId) => clearTimeout(timerId));
          preferredQualityRetryTimers.clear();
        }

        function applyPreferredPlaybackQuality(videoId) {
          if (
            !CONFIG.preferredVideoQuality || CONFIG.preferredVideoQuality === "off" ||
            preferredQualityNavigationPending || videoMirrorPageSuspended ||
            videoId !== preferredQualityVideoId || videoId !== getVideoMirrorRouteId()
          ) return false;
          // Reuse the identity-checked watch target, including a floating player.
          // Never change an old queue player, inline preview, duplicate or ad.
          const target = getVideoMirrorTarget(videoId);
          const player = target?.player;
          if (!player) return false;
          if (player.classList.contains("ad-showing") || player.classList.contains("ad-interrupting")) {
            // A preroll can outlast startup retries. Defer to the content's next
            // metadata/page event rather than consuming attempts on the advert.
            clearPreferredQualityAttempts();
            preferredQualityVideoId = "";
            return false;
          }
          if (isRenderedWatchFlexy(player.querySelector(".ytp-settings-menu"))) {
            clearPreferredQualityAttempts();
            return false;
          }
          if (
            typeof player.getAvailableQualityLevels !== "function" ||
            typeof player.getPlaybackQuality !== "function" ||
            typeof player.setPlaybackQualityRange !== "function"
          ) return false;
          try {
            let levels = player.getAvailableQualityLevels();
            if (typeof player.getAvailableQualityData === "function") {
              const data = player.getAvailableQualityData();
              if (Array.isArray(levels) && Array.isArray(data)) {
                levels = levels.filter((quality) => {
                  const variants = data.filter((entry) => entry?.quality === quality);
                  return !variants.length || variants.some((entry) => entry.isPlayable !== false);
                });
              }
            }
            const quality = getPreferredQualityLevel(levels);
            if (!quality) return false;
            if (player.getPlaybackQuality() !== quality) player.setPlaybackQualityRange(quality, quality);
            // A setter returning normally does not establish that it took effect.
            // Cancel the remaining bounded attempts only after the player confirms.
            if (player.getPlaybackQuality() === quality) {
              clearPreferredQualityAttempts();
              return true;
            }
          } catch { /* Missing or changing native contracts leave YouTube in control. */ }
          return false;
        }

        function schedulePreferredQualityAttempts() {
          if (!CONFIG.preferredVideoQuality || CONFIG.preferredVideoQuality === "off" || !isWatchPath()) {
            preferredQualityVideoId = "";
            clearPreferredQualityAttempts();
            return;
          }
          if (preferredQualityNavigationPending || videoMirrorPageSuspended) return;
          const videoId = getVideoMirrorRouteId();
          if (!videoId || videoId === preferredQualityVideoId) return;
          const player = getVideoMirrorTarget(videoId)?.player;
          if (player?.classList.contains("ad-showing") || player?.classList.contains("ad-interrupting")) return;
          preferredQualityVideoId = videoId;
          clearPreferredQualityAttempts();
          for (const delay of PREFERRED_QUALITY_RETRY_DELAYS_MS) {
            const timerId = setTimeout(() => {
              preferredQualityRetryTimers.delete(timerId);
              applyPreferredPlaybackQuality(videoId);
            }, delay);
            preferredQualityRetryTimers.add(timerId);
          }
        }

        function handleManualQualitySelection(event) {
          if (!preferredQualityRetryTimers.size || !event.isTrusted ||
            (event.type === "keydown" && !["Enter", " "].includes(event.key))) return;
          const control = closestElement(event.target, ".ytp-settings-button, .ytp-settings-menu");
          if (!control || control.closest("#movie_player") !== getVideoMirrorTarget()?.player) return;
          // Observe native settings interaction without cancelling or replaying it.
          // Keep this video's ID armed so later metadata cannot undo a manual choice.
          clearPreferredQualityAttempts();
        }

        function handlePreferredQualityMetadata(event) {
          if (event.target === getVideoMirrorTarget()?.video) schedulePreferredQualityAttempts();
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
            try {
              player.setVolume(nextPercent);
            } catch {
              // Keep the media-element fallback usable during player transitions.
            }
          }

          video.volume = nextPercent / 100;

          if (nextPercent > 0) {
            if (typeof player.unMute === "function") {
              try {
                player.unMute();
              } catch {
                // A stale player API must not prevent the media element unmuting.
              }
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

        function getCleanVideoUrl(rawUrl) {
          let url;
          try {
            url = new URL(rawUrl);
          } catch {
            return "";
          }
          if (
            !["https:", "http:"].includes(url.protocol) ||
            url.username || url.password || url.port
          ) {
            return "";
          }

          let videoId = "";
          if (url.hostname === "youtu.be") {
            videoId = url.pathname.match(/^\/([A-Za-z0-9_-]{11})$/)?.[1] || "";
          } else if (
            ["www.youtube.com", "youtube.com", "m.youtube.com"].includes(url.hostname) &&
            url.pathname === "/watch" && url.searchParams.getAll("v").length === 1
          ) {
            videoId = url.searchParams.get("v") || "";
          }
          return /^[A-Za-z0-9_-]{11}$/.test(videoId) ? `https://youtu.be/${videoId}` : "";
        }

        function clearCleanVideoUrlCopy() {
          if (cleanVideoUrlCopyTimer) {
            clearTimeout(cleanVideoUrlCopyTimer);
            cleanVideoUrlCopyTimer = 0;
          }
          cleanVideoUrlCopyMenu = null;
        }

        function handleCleanVideoUrlSelection(event) {
          if (!CONFIG.enableCleanVideoUrlCopy || !event.isTrusted || event.defaultPrevented) {
            return;
          }
          if (event.type === "keydown") {
            if (
              !["Enter", " ", "ArrowRight"].includes(event.key) ||
              event.ctrlKey || event.altKey || event.metaKey || event.repeat || event.isComposing
            ) {
              return;
            }
          } else if (event.type !== "click" || event.button !== 0) {
            return;
          }

          const item = closestElement(event.target, ".ytp-menuitem");
          const menu = item?.closest(".ytp-contextmenu");
          if (!menu || !menu.isConnected) {
            return;
          }
          clearCleanVideoUrlCopy();
          if (item.querySelector(".ytp-menuitem-label")?.textContent.trim() !== "Copy video URL") {
            return;
          }

          cleanVideoUrlCopyMenu = menu;
          // A microtask can run between native capture and target listeners. Expire
          // after this task so YouTube can populate and synchronously copy its URL.
          cleanVideoUrlCopyTimer = setTimeout(clearCleanVideoUrlCopy, 0);
        }

        function handleCleanVideoUrlCopy(event) {
          if (!cleanVideoUrlCopyMenu || !event.isTrusted) {
            return;
          }
          try {
            if (
              !CONFIG.enableCleanVideoUrlCopy || !cleanVideoUrlCopyMenu.isConnected ||
              !event.cancelable || event.defaultPrevented || !event.clipboardData
            ) {
              return;
            }
            const clipboard = cleanVideoUrlCopyMenu.querySelector("textarea.ytp-html5-clipboard");
            if (
              !clipboard || !clipboard.isConnected ||
              (event.target !== clipboard && document.activeElement !== clipboard) ||
              clipboard.selectionStart !== 0 || clipboard.selectionEnd !== clipboard.value.length
            ) {
              return;
            }

            // Use YouTube's freshly generated payload, not potentially stale watch
            // metadata or the page URL during a queue/autoplay hand-off.
            const cleanUrl = getCleanVideoUrl(clipboard.value);
            if (!cleanUrl) {
              return;
            }
            event.clipboardData.setData("text/plain", cleanUrl);
            event.preventDefault();
          } catch {
            // Preserve native copying, including its failure UI, if customising fails.
          } finally {
            clearCleanVideoUrlCopy();
          }
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
          scheduleVideoMirrorSync();
          ensureStyles();
          syncFullscreenComments();
          convertCurrentShortsPage();
          applyDynamicPreferences(document);
          schedulePreferredQualityAttempts();
          scheduleLiveChatCollapseAttempts();

          if (isWatchPath()) {
            scheduleTheaterModeAttempts();
          }
        }

        function handleNavigateFinish() {
          preferredQualityNavigationPending = false;
          theaterModeUserDisabled = false;
          theaterModeAttemptKey = "";
          applyRoutePreferences();
          configureDynamicMutationObserver();
          schedulePlayerLayoutRefreshAttempts();
        }

        function handleNavigateStart() {
          preferredQualityNavigationPending = true;
          clearPreferredQualityAttempts();
          resetVideoMirror();
          document.documentElement?.removeAttribute(FULLSCREEN_COMMENTS_ATTRIBUTE);
          clearLiveChatCollapseAttempts();
          clearPlayerLayoutRefreshAttempts();
          cancelScheduledAnimationWork();
          clearCleanVideoUrlCopy();
          rightButtonHeldOnPlayer = false;
          clearContextMenuSuppression();
        }

        function handleTitleHashtagActivation(event) {
          if (!CONFIG.disableTitleHashtagLinks || !isWatchPath()) return;
          if (event.type === "keydown") {
            if (event.key !== "Enter" || event.isComposing) return;
          } else if (
            (event.type !== "click" || event.button !== 0) &&
            (event.type !== "auxclick" || event.button !== 1)
          ) {
            return;
          }
          if (!closestElement(event.target, TITLE_HASHTAG_LINK_SELECTOR)) return;
          // CSS handles pointer hit-testing; capture also blocks keyboard activation
          // and native/synthetic clicks without changing retained title bindings.
          event.preventDefault();
          event.stopImmediatePropagation();
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

          pendingApplyRoots.add(applyRoot);
        }

        function scheduleApply(root = document) {
          addPendingApplyRoot(root);
          if (applyFrame) {
            return;
          }

          applyFrame = requestAnimationFrame(() => {
            applyFrame = 0;
            const roots = new Set(pendingApplyRoots);
            pendingApplyRoots.clear();

            if (!roots.size) {
              return;
            }

            if (roots.has(document)) {
              applyDynamicPreferences(document);
              return;
            }

            roots.forEach((applyRoot) => {
              if (applyRoot.isConnected === false) return;
              for (let parent = applyRoot.parentNode; parent; parent = parent.parentNode) {
                if (roots.has(parent)) return;
              }
              applyDynamicPreferences(applyRoot);
            });
          });
        }

        function cancelScheduledAnimationWork() {
          if (applyFrame) cancelAnimationFrame(applyFrame);
          if (playerLayoutRefreshFrame) cancelAnimationFrame(playerLayoutRefreshFrame);
          if (videoMirrorFrame) cancelAnimationFrame(videoMirrorFrame);
          applyFrame = 0;
          playerLayoutRefreshFrame = 0;
          videoMirrorFrame = 0;
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

        function isPreviewPlaybackMutation(mutation) {
          const surface = closestElement(
            mutation.target,
            ".ytp-progress-bar-container, .ytp-caption-window-container, .ytp-chrome-controls",
          );
          const player = surface?.closest(".html5-video-player");
          return Boolean(player?.closest("ytd-video-preview"));
        }

        function addMutationApplyRoots(roots, mutation) {
          // Ignore only known preview playback internals for preference routing.
          // Mirror/control discovery still receives the original mutation records.
          if (isPreviewPlaybackMutation(mutation)) return;
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
          let videoMirrorChanged = false;

          for (const mutation of mutations) {
            videoMirrorChanged ||= mutationAffectsVideoMirror(mutation);
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
          if (videoMirrorChanged) scheduleVideoMirrorSync();
          if (watchDynamicRootsChanged) {
            configureDynamicMutationObserver();
          }
        });

        configureDynamicMutationObserver();

        if (CONFIG.disableTitleHashtagLinks) {
          document.addEventListener("click", handleTitleHashtagActivation, true);
          document.addEventListener("auxclick", handleTitleHashtagActivation, true);
          document.addEventListener("keydown", handleTitleHashtagActivation, true);
        }
        document.addEventListener("click", handleShortsClick, true);
        if (CONFIG.preferredVideoQuality !== "off") {
          document.addEventListener("click", handleManualQualitySelection, true);
          document.addEventListener("keydown", handleManualQualitySelection, true);
          document.addEventListener("loadedmetadata", handlePreferredQualityMetadata, true);
        }
        document.addEventListener("click", handleTheaterModeToggle, true);
        document.addEventListener("click", handleDescriptionClick, true);
        document.addEventListener("click", handleCleanVideoUrlSelection, true);
        document.addEventListener("keydown", handleCleanVideoUrlSelection, true);
        document.addEventListener("copy", handleCleanVideoUrlCopy, true);
        document.addEventListener("wheel", handleWheelVolume, {
          capture: true,
          passive: false,
        });
        document.addEventListener("wheel", handleFullscreenCommentsWheel, {
          capture: true,
          passive: false,
        });
        document.addEventListener("fullscreenchange", syncFullscreenComments, true);
        document.addEventListener("fullscreenchange", hideVideoMirrorTooltip, true);
        document.addEventListener("fullscreenchange", scheduleVideoMirrorSync, true);
        document.addEventListener("loadedmetadata", handleVideoMirrorMetadata, true);
        document.addEventListener("keydown", handleVideoMirrorKeyDown);
        document.addEventListener("mousedown", handleMouseDown, true);
        document.addEventListener("mouseup", handleMouseUp, true);
        document.addEventListener("contextmenu", handleContextMenu, true);

        suite.addWindowListener("blur", handleWindowBlur, true);
        suite.addWindowListener("blur", hideVideoMirrorTooltip, true);
        suite.addWindowListener("resize", refreshVideoMirrorTooltip, true);
        suite.addWindowListener("yt-navigate-start", handleNavigateStart, true);
        suite.addWindowListener("yt-navigate-finish", handleNavigateFinish, true);
        suite.addWindowListener(
          "yt-page-data-updated",
          () => {
            scheduleVideoMirrorSync();
            schedulePreferredQualityAttempts();
            syncFullscreenComments();
            configureDynamicMutationObserver();
            scheduleApply(document);
            scheduleLiveChatCollapseAttempts();
          },
          true,
        );

        suite.addWindowListener(
          "pagehide",
          () => {
            videoMirrorPageSuspended = true;
            clearPreferredQualityAttempts();
            resetVideoMirror();
            document.documentElement?.removeAttribute(FULLSCREEN_COMMENTS_ATTRIBUTE);
            cancelScheduledAnimationWork();
            clearLiveChatCollapseAttempts();
            clearPlayerLayoutRefreshAttempts();
            clearCleanVideoUrlCopy();
          },
          true,
        );

        suite.addWindowListener(
          "pageshow",
          () => {
            videoMirrorPageSuspended = false;
            schedulePreferredQualityAttempts();
            scheduleVideoMirrorSync();
            ensureStyles();
            syncFullscreenComments();
            configureDynamicMutationObserver();
            scheduleApply(document);
            scheduleLiveChatCollapseAttempts();
            schedulePlayerLayoutRefreshAttempts();
          },
          true,
        );
    },
  );

  suite.registerModule(
    "scrollMiniplayer",
    "Scroll Miniplayer v5.27",
    "document-idle",
    () => {
      const MutationObserver = suite.SharedMutationObserver;
      const GM_addStyle = (css) => suite.setStyle("scrollMiniplayer", css);

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
        Object.assign(CONFIG, suite.settings.overrides("scrollMiniplayer", CONFIG));

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
          if (isRenderedWatchRoot(playerRoot)) return playerRoot;

          const placeholderRoot = document
            .querySelector(`#${PLACEHOLDER_ID}`)
            ?.closest?.(WATCH_ROOT_SELECTOR);
          if (isRenderedWatchRoot(placeholderRoot)) return placeholderRoot;

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

        function isPlayerInFullscreen(player = floatedPlayer) {
          const fullscreenElement = document.fullscreenElement;
          return Boolean(
            player && fullscreenElement &&
            (player === fullscreenElement || player.contains(fullscreenElement))
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
              bottom: auto !important;
              box-sizing: border-box !important;
              color: #fff !important;
              display: flex !important;
              font: 500 12px/1.2 Arial, Helvetica, sans-serif !important;
              gap: 8px !important;
              left: 12px !important;
              max-width: calc(100% - 96px) !important;
              min-height: 30px !important;
              overflow: hidden !important;
              padding: 6px 9px !important;
              pointer-events: none !important;
              position: absolute !important;
              right: 84px !important;
              top: 8px !important;
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
          suite.setStyle("scrollMiniplayer", buildCss());
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
          if (isPlayerInFullscreen(obsoletePlayer)) return false;
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

          if (isPlayerInFullscreen(candidate)) return false;
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
          if (isPlayerInFullscreen(candidate)) return;
          playerOrphanFinaliseTimer = setTimeout(() => {
            playerOrphanFinaliseTimer = 0;
            if (
              floatedPlayer !== candidate ||
              navigationInProgress ||
              isEligiblePath() ||
              isBodyFloating() ||
              isPlayerInFullscreen(candidate)
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

          // Reparenting a native fullscreen element (or its video child) exits
          // fullscreen. Keep its placeholder and ownership until fullscreenchange.
          if (isPlayerInFullscreen()) {
            clearPlayerRestoreRetries();
            return false;
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
            const position = document.createElement("span");
            position.className = "ytsmp-queue-position";
            const title = document.createElement("span");
            title.className = "ytsmp-queue-title";
            queueInfo.append(position, title);
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

        function isSuiteDialogContentMutation(mutation) {
          if (mutation.type !== "childList") return false;
          const target = mutation.target?.closest ? mutation.target : mutation.target?.parentElement;
          const dialog = target?.closest?.("dialog");
          const topology = "#movie_player, .html5-video-player, ytd-watch-flexy, #ytsmp-player-placeholder, .ytp-right-controls";
          if (
            typeof HTMLDialogElement !== "function" || !(dialog instanceof HTMLDialogElement) ||
            !dialog.isConnected || dialog.parentElement !== document.body ||
            !["ytms-settings-dialog", "ytms-age-dialog"].includes(dialog.id) ||
            target.closest(topology)
          ) return false;

          return [...mutation.addedNodes, ...mutation.removedNodes].every((node) =>
            !node.matches?.(topology) && !node.querySelector?.(topology),
          );
        }

        const mutationObserver = new MutationObserver((mutations) => {
          // Ignore only internal edits to the two body-mounted Suite dialogues.
          // Real player detach/adoption, dialogue mounting and mixed batches still reconcile.
          if (mutations.length && mutations.every(isSuiteDialogContentMutation)) return;
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

        suite.addWindowListener("resize", () => {
          if (isBodyActive()) {
            setBodyBoxVars();
          }
          scheduleScrollSync();
        }, { passive: true });

        suite.addWindowListener("scroll", scheduleScrollSync, { passive: true });

        suite.addWindowListener("storage", (event) => {
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

        function handleFullscreenChange() {
          setActive(false);
          if (!document.fullscreenElement) scheduleRouteSync();
        }

        document.addEventListener("fullscreenchange", handleFullscreenChange, true);

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

        suite.addWindowListener("yt-navigate-start", () => {
          beginNavigationLock();
          deactivateImmediately();
        }, true);
        suite.addWindowListener("yt-navigate-finish", () => {
          navigationFinishPending = true;
          finishNavigationLockIfSettled();
        }, true);
        suite.addWindowListener("yt-page-data-updated", () => {
          if (navigationFinishPending) {
            finishNavigationLockIfSettled();
            return;
          }
          scheduleRouteSync();
        }, true);
        suite.addWindowListener("pagehide", cancelScheduledAnimationFrames, true);
        suite.addWindowListener("pageshow", () => {
          // A BFCache restore may not emit a matching YouTube navigation finish.
          finishNavigationLock();
        }, true);

        syncRouteState();
    },
  );

  suite.registerModule(
    "watchLayoutCleaner",
    "Watch Layout Cleaner v1.46",
    "document-start",
    () => {
      const MutationObserver = suite.SharedMutationObserver;
      const GM_addStyle = (css) => suite.setStyle("watchLayoutCleaner", css);

      "use strict";

        const CONFIG = {
          sidebarWidthPx: 374,
          queueLayoutBreakpointPx: 1000,
          relatedVideosHideBreakpointPx: 1400,
          showDeArrowQueueButton: true,
        };
        Object.assign(CONFIG, suite.settings.overrides("watchLayoutCleaner", CONFIG));

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
        ${WATCH_FLEXY_SELECTOR}{
          --tm-yw-sidebar-width: ${px(CONFIG.sidebarWidthPx)} !important;
          --ytd-watch-flexy-sidebar-width: ${px(CONFIG.sidebarWidthPx)} !important;
        }

        ${watchFlexyChildSelector("#secondary.ytd-watch-flexy")}{
          flex: 0 0 ${px(CONFIG.sidebarWidthPx)} !important;
          width: ${px(CONFIG.sidebarWidthPx)} !important;
          min-width: ${px(CONFIG.sidebarWidthPx)} !important;
          max-width: ${px(CONFIG.sidebarWidthPx)} !important;
        }

        ${TWO_COLUMN_WATCH_FLEXY_SELECTORS.map((watchSelector) => `${watchSelector}[${EMPTY_SECONDARY_RAIL_ATTRIBUTE}="1"] #secondary.ytd-watch-flexy`).join(",\n  ")}{
          flex: 0 0 0 !important;
          width: 0 !important;
          min-width: 0 !important;
          max-width: 0 !important;
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

          suite.setStyle("watchLayoutCleaner", css);
        }

        function removeStyle() {
          suite.removeStyle("watchLayoutCleaner");
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
          ['yt-playlist-data-updated', 'yt-page-data-updated'].forEach(type => suite.addWindowListener(type, schedule, true));
          suite.addWindowListener('yt-rendererstamper-finished', event => {
            if (event.target?.closest?.(panelSelector)) schedule();
          }, true);
          suite.addWindowListener('yt-navigate-start', () => {
            navigating = true;
            if (frame) cancelAnimationFrame(frame);
            frame = 0;
          }, true);
          ['yt-navigate-finish', 'pageshow'].forEach(type => suite.addWindowListener(type, () => {
            navigating = false;
            schedule();
          }, true));
          suite.addWindowListener('pagehide', () => {
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
          suite.addWindowListener("yt-popup-opened", openMenu, true);
          ["click", "tap", "keydown"].forEach(type => document.addEventListener(type, activate, true));
          ["yt-playlist-data-updated", "yt-page-data-updated"].forEach(type => suite.addWindowListener(type, scheduleMove, true));
          ["yt-navigate-start", "pagehide"].forEach(type => suite.addWindowListener(type, reset, true));
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
            suite.setStyle("watchLayoutCleanerDrag", css);
            return true;
          }

          function removeMarkerStyle(style) {
            if (style) suite.removeStyle("watchLayoutCleanerDrag");
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
        suite.addWindowListener(
          "yt-navigate-finish",
          () => {
            ensureStyle();
            scheduleQueueThumbnailFallbacks();
          },
          true,
        );
        suite.addWindowListener(
          "yt-page-data-updated",
          () => {
            ensureStyle();
            scheduleQueueThumbnailFallbacks();
          },
          true,
        );
        suite.addWindowListener(
          "pageshow",
          () => {
            ensureStyle();
            scheduleQueueThumbnailFallbacks();
          },
          true,
        );
    },
  );

  suite.registerModule(
    "suiteSettings",
    "Suite Settings v1.31",
    "document-idle",
    () => {
      const MutationObserver = suite.SharedMutationObserver;
      const GM_addStyle = (css) => suite.setStyle("suiteSettings", css);

      "use strict";
        // This canonical module uses the master's validated preference service and embedded assets.
        const settings = suite.settings;
        const BUTTON_ID = "ytms-settings-button";
        const PLAYER_BUTTON_ID = "ytms-player-settings-button";
        const TOOLTIP_ID = "ytms-player-settings-tooltip";
        const DIALOG_ID = "ytms-settings-dialog";
        let panel = null;
        let frame = 0;
        let suspended = false;
        let watchedMasthead = null;
        let watchedApp = null;
        let watchedMastheadContainer = null;
        let discoveryActive = false;
        let button = null;
        let playerButton = null;
        let playerTooltip = null;
        let playerTarget = null;
        let watchedPlayerBranch = [];
        let channelAgeDialog = null;

        suite.openChannelAgeSettings = channel => {
          if (suspended) return;
          hidePlayerTooltip();
          try {
            channelAgeDialog ||= suite.createChannelAgeDialog(document, suite.channelAge);
            channelAgeDialog.open(channel);
          } catch (error) {
            suite.reportModuleError('suiteSettings', 'open channel upload filters', error);
          }
        };
        suite.installVideoMenu(suite);

        function createPanel() {
          const dialog = suite.createSettingsDialog(document);
          document.body.append(dialog);

          const $ = id => dialog.querySelector(`[id="ytms-${id}"]`);
          const DEFAULTS = settings.defaults;
          const GROUPS = {
            feed: [
              ['hideShorts', 'Hide Shorts'], ['hideWatchedVideos', 'Hide watched videos'],
              ['hideMixes', 'Hide mixes'], ['hidePodcasts', 'Hide podcasts'], ['hideMembersOnly', 'Hide members-only videos'],
              ['watchedThreshold', 'Watched threshold', ['80', '90', '95', '100'], value => `${value}%`],
            ],
            player: [
              ['yellowCaptions', 'Readable yellow captions'], ['mirrorButton', 'Show mirror button'],
              ['hideFullscreenQuickActions', 'Hide fullscreen action strip'],
              ['theatreMode', 'Automatic theatre mode'], ['wheelVolume', 'Right-button wheel volume'],
              ['wheelStep', 'Volume step', ['1', '2', '5', '10'], value => `${value}%`],
              ['preferredVideoQuality', 'Preferred video quality', ['off', 'highest', 'tiny', 'small', 'medium', 'large', 'hd720', 'hd1080', 'hd1440', 'hd2160'],
                value => ({ off: 'YouTube default', highest: 'Highest available', tiny: '144p', small: '240p', medium: '360p', large: '480p',
                  hd720: '720p', hd1080: '1080p', hd1440: '1440p', hd2160: '2160p (4K)' })[value]],
            ],
            layout: [
              ['hideRelated', 'Hide related videos'], ['hideChat', 'Hide live chat'], ['hideInfoCards', 'Hide info cards'],
              ['hideEndScreens', 'Hide end-screen recommendations'], ['fullscreenComments', 'Scrollable fullscreen comments'],
              ['disableTitleHashtagLinks', 'Disable hashtag links in titles'],
            ],
            miniplayer: [
              ['miniplayerEnabled', 'Scroll miniplayer'],
              ['corner', 'Preferred corner', ['top-right', 'bottom-right', 'bottom-left', 'top-left'], value => value.replace('-', ' ')],
              ['queueInfo', 'Show compact title and queue information'],
            ],
            interface: [
              ['headerSettingsIcon', 'Header button', ['off', 'colour', 'monochrome'], value => value[0].toUpperCase() + value.slice(1)],
              ['playerSettingsIcon', 'Video player button', ['off', 'colour', 'monochrome'], value => value[0].toUpperCase() + value.slice(1)],
              ['showRydTooltipBar', 'Show Return YouTube Dislike tooltip bar'],
              ['showDeArrowTitleButton', 'Show DeArrow icon beside video title'],
              ['showDeArrowQueueButton', 'Show DeArrow logo in queues'],
              ['menuShowDownload', 'Show Download in video menus'],
              ['menuGroupChannelTools', 'Group channel tools in a submenu'],
              ['menuShowAgeLimit', 'Show Filter channel uploads action'],
              ['menuShowNotInterested', 'Show Not interested'],
              ['menuShowDontRecommend', 'Show Don’t recommend channel'],
              ['menuShowReport', 'Show Report'],
            ],
          };
          const DESCRIPTIONS = {
            hideShorts: 'Remove Shorts shelves and cards from feeds and search results.',
            hideWatchedVideos: 'Hide videos already watched past your threshold. Watch History is left unchanged.',
            hideMixes: 'Remove automatically generated mix cards from supported feeds.',
            hidePodcasts: 'Remove podcast cards and shelves from supported feeds.',
            hideMembersOnly: 'Remove cards for videos restricted to channel members.',
            watchedThreshold: 'Choose how much watched progress is required before a video card is hidden.',
            yellowCaptions: 'Use readable yellow subtitles with a black shadow in the player and inline previews.',
            mirrorButton: 'Show the horizontal flip control. Only the video image is mirrored, not captions or controls.',
            hideFullscreenQuickActions: 'Hide the fullscreen Likes, Dislikes, Comments, Share and More action strip. The main playback controls are unchanged. Off by default; applies after reload.',
            theatreMode: 'Start watch videos in YouTube’s theatre view.',
            wheelVolume: 'Hold the right mouse button and scroll over the player to adjust volume.',
            wheelStep: 'Choose the volume change for each wheel step during the right-button gesture.',
            preferredVideoQuality: 'Request this quality on each new video, or the nearest lower available resolution. Opening native player settings stops pending attempts. Higher quality uses more bandwidth. Applies after reload.',
            hideRelated: 'Hide suggested videos beside the watch page without hiding the active queue.',
            hideChat: 'Hide live-chat panels without removing other engagement panels.',
            hideInfoCards: 'Hide in-video information cards and their buttons.',
            hideEndScreens: 'Hide end-screen recommendation tiles without taking over native autoplay.',
            fullscreenComments: 'Scroll to existing comments while page fullscreen remains active. Player-only fullscreen is unchanged.',
            disableTitleHashtagLinks: 'Keep hashtag text as ordinary title text without opening hashtag pages. Preserves YouTube’s title nodes and DeArrow replacements. Applies after reload.',
            miniplayerEnabled: 'Float the watch player into a corner when it scrolls out of view.',
            corner: 'Choose the floating player’s corner. This also synchronises with other open YouTube windows.',
            queueInfo: 'Show the current title and queue position at the top of the floating player.',
            headerSettingsIcon: 'Choose the icon beside your profile button. Available on feed and watch pages.',
            playerSettingsIcon: 'Choose the icon before Mirror video in watch and live player controls.',
            showRydTooltipBar: 'Show Return YouTube Dislike’s tooltip bar. Hidden by default; dislike counts and voting buttons are unchanged. Applies after reload.',
            showDeArrowTitleButton: 'Show DeArrow’s title-button controls beside the watch-page title. Hidden by default; title and thumbnail replacements remain active. Applies after reload.',
            showDeArrowQueueButton: 'Show DeArrow’s original/custom toggle logo in queue titles. Hiding it does not disable DeArrow title or thumbnail replacements.',
            menuShowDownload: 'Show YouTube’s Download action when available. Hidden by default; this does not enable downloads or change your account permissions.',
            menuGroupChannelTools: 'On: place Don’t recommend channel, Report and Filter channel uploads in a Channel tools submenu. Off: keep enabled actions separate in the main menu. Not interested always stays in the main menu. Save and reload to apply.',
            menuShowAgeLimit: 'Add Filter channel uploads to set how old a selected channel’s uploads can be. It appears at the bottom by default.',
            menuShowNotInterested: 'Keep YouTube’s Not interested action visible when the video menu provides it.',
            menuShowDontRecommend: 'Keep YouTube’s Don’t recommend channel action available, separately or inside Channel tools.',
            menuShowReport: 'Keep YouTube’s Report action available, separately or inside Channel tools. A report is never submitted automatically.',
          };
          let saved = settings.read();
          let draft = { ...saved };
          let externalConflict = false;
          let pickerTarget = null;
          let pickerTrigger = null;
          let currentTab = 'comments';

          let supportPanel = null;
          const tabIds = ['comments', 'feed', 'channels', 'player', 'layout', 'miniplayer', 'interface', 'extensions', 'support', 'credits'];
          function selectTab(id, focus = false) {
            closePicker(false);
            currentTab = id;
            $('restore-section-defaults').disabled = ['channels', 'extensions', 'support', 'credits'].includes(id);
            for (const tab of tabIds) {
              const selected = tab === id;
              const section = $(`section-${tab}`), button = $(`tab-${tab}`);
              if (section.hidden === selected) section.hidden = !selected;
              if (button.getAttribute('aria-selected') !== String(selected)) button.setAttribute('aria-selected', String(selected));
              if (button.tabIndex !== (selected ? 0 : -1)) button.tabIndex = selected ? 0 : -1;
            }
            dialog.querySelector('.content').scrollTop = 0;
            if (id === 'channels') renderChannelRules();
            if (id === 'support') supportPanel?.refresh();
            if (focus) $(`tab-${id}`).focus();
          }
          for (const id of tabIds) {
            const tab = document.createElement('button');
            tab.id = `ytms-tab-${id}`; tab.textContent = id === 'miniplayer' ? 'Miniplayer' : id[0].toUpperCase() + id.slice(1);
            tab.setAttribute('role', 'tab'); tab.setAttribute('aria-controls', `ytms-section-${id}`);
            tab.addEventListener('click', () => selectTab(id));
            tab.addEventListener('keydown', event => {
              const index = tabIds.indexOf(id);
              const next = event.key === 'ArrowRight' ? (index + 1) % tabIds.length :
                event.key === 'ArrowLeft' ? (index + tabIds.length - 1) % tabIds.length :
                event.key === 'Home' ? 0 : event.key === 'End' ? tabIds.length - 1 : -1;
              if (next >= 0) { event.preventDefault(); selectTab(tabIds[next], true); }
            });
            dialog.querySelector('nav').append(tab);
          }
          const menuDetails = document.createElement('details'); menuDetails.id = 'ytms-video-menu-settings';
          const menuSummary = document.createElement('summary'); menuSummary.textContent = 'Video context menu';
          menuDetails.append(menuSummary); $('section-interface').append(menuDetails);
          for (const [group, rows] of Object.entries(GROUPS)) {
            for (const [key, labelText, choices, format] of rows) {
              const row = document.createElement('div'); row.className = 'row';
              const label = document.createElement('label'); label.htmlFor = `ytms-${key}`; label.textContent = labelText;
              const description = document.createElement('span'); description.className = 'description';
              description.id = `ytms-${key}-description`; description.textContent = DESCRIPTIONS[key]; label.append(description);
              const input = document.createElement(choices ? 'select' : 'input'); input.id = `ytms-${key}`;
              input.setAttribute('aria-describedby', description.id);
              if (choices) {
                for (const value of choices) { const option = document.createElement('option'); option.value = value; option.textContent = format(value); input.append(option); }
              } else { input.type = 'checkbox'; input.className = 'switch'; input.setAttribute('role', 'switch'); }
              row.append(label, input);
              if (group === 'interface' && key.startsWith('menu')) menuDetails.append(row);
              else $(`section-${group}`).insertBefore(row, group === 'interface' ? menuDetails : null);
              input.addEventListener('change', () => { draft[key] = choices ? input.value : input.checked; updateColours(); });
            }
          }
          const ageRow = document.createElement('div'); ageRow.className = 'row';
          const ageLabel = document.createElement('div'); ageLabel.className = 'row-label';
          ageLabel.textContent = 'Channel upload filters';
          const ageDescription = document.createElement('span'); ageDescription.className = 'description';
          ageDescription.id = 'ytms-channel-age-description';
          ageDescription.textContent = 'Choose how old each channel’s uploads can be: days, weeks, months or years. Watched-video filtering remains independent. Manage and save these filters separately; the settings reset buttons leave them unchanged.';
          ageLabel.append(ageDescription);
          const ageButton = document.createElement('button'); ageButton.id = 'ytms-manage-channel-age';
          ageButton.type = 'button'; ageButton.className = 'text-button outlined-button'; ageButton.textContent = 'Manage filters';
          ageButton.setAttribute('aria-label', 'Manage channel upload filters');
          ageButton.setAttribute('aria-describedby', ageDescription.id); ageButton.setAttribute('aria-haspopup', 'dialog');
          ageButton.addEventListener('click', () => suite.openChannelAgeSettings());
          const channelNote = document.createElement('p'); channelNote.className = 'section-note';
          channelNote.textContent = 'This list contains filters saved by YouTube Master Suite in this browser profile. YouTube’s own Don’t recommend channel choices are separate and are not included here. Edit or remove a filter in the manager, then choose Save filters to apply it.';
          const channelHelp = document.createElement('a'); channelHelp.className = 'channel-filter-help';
          channelHelp.textContent = 'Manage YouTube’s own recommendation controls';
          channelHelp.href = 'https://support.google.com/youtube/answer/6342839?hl=en&co=GENIE.Platform%3DDesktop';
          channelHelp.target = '_blank'; channelHelp.rel = 'noopener noreferrer';
          channelHelp.setAttribute('aria-label', 'Manage YouTube’s own recommendation controls (opens in a new tab)');
          const channelList = document.createElement('div'); channelList.id = 'ytms-channel-filter-list';
          channelList.setAttribute('role', 'list'); channelList.setAttribute('aria-label', 'Saved channel upload filters');
          ageRow.append(ageLabel, ageButton); $('section-channels').append(ageRow, channelNote, channelHelp, channelList);
          function renderChannelRules() {
            channelList.replaceChildren();
            const rules = suite.channelAge.read();
            if (!rules.length) {
              const empty = document.createElement('p'); empty.className = 'section-note'; empty.textContent = 'No channel upload filters saved.';
              channelList.append(empty);
            }
            for (const rule of rules) {
              const card = document.createElement('article'); card.className = 'channel-filter-card'; card.setAttribute('role', 'listitem');
              const title = document.createElement('h3'); title.textContent = rule.name || rule.channelId;
              const id = document.createElement('p'); id.className = 'channel-filter-id'; id.textContent = rule.channelId;
              const age = document.createElement('p'); age.textContent = `Maximum upload age: ${rule.maxAge} ${rule.maxAge === 1 ? rule.unit.slice(0, -1) : rule.unit}`;
              const status = document.createElement('p'); status.className = 'channel-filter-status';
              status.textContent = `Status: ${!rule.enabled ? 'Disabled' : rule.blocked ? 'All uploads hidden' : 'Enabled'}`;
              const actions = document.createElement('div'); actions.className = 'channel-filter-actions';
              for (const [label, remove] of [['Edit', false], ['Remove', true]]) {
                const action = document.createElement('button'); action.type = 'button';
                action.className = `text-button ${remove ? 'danger-button' : 'outlined-button'}`;
                action.textContent = `${label} filter`; action.setAttribute('aria-label', `${label} filter for ${rule.name || rule.channelId}`);
                action.addEventListener('click', () => suite.openChannelAgeSettings({ channelId: rule.channelId, name: rule.name, ...(remove ? { remove: true } : {}) }));
                actions.append(action);
              }
              card.append(title, id, age, status, actions); channelList.append(card);
            }
          }

          const menuOrder = document.createElement('section'); menuOrder.className = 'menu-order';
          const menuOrderHeading = document.createElement('h3'); menuOrderHeading.textContent = 'Video context menu order';
          const menuOrderNote = document.createElement('p'); menuOrderNote.className = 'section-note';
          menuOrderNote.id = 'ytms-menu-order-description';
          menuOrderNote.textContent = 'Use the arrows to arrange recognised video actions. Hidden or unavailable actions are skipped. Grouped actions keep their relative order inside Channel tools; other YouTube items are left available.';
          const menuOrderList = document.createElement('ol'); menuOrderList.id = 'ytms-menu-order';
          menuOrderList.setAttribute('aria-label', 'Video context menu order'); menuOrderList.setAttribute('aria-describedby', menuOrderNote.id);
          const menuLabels = {
            playNext: 'Play next in queue', addToQueue: 'Add to queue', watchLater: 'Save to Watch Later',
            savePlaylist: 'Save to playlist', download: 'Download', share: 'Share', notInterested: 'Not interested',
            dontRecommend: 'Don’t recommend channel', report: 'Report', channelAge: 'Filter channel uploads', channelTools: 'Channel tools submenu',
          };
          function renderMenuOrder(focusId, focusDirection) {
            menuOrderList.replaceChildren();
            const order = draft.menuItemOrder;
            for (const [index, id] of order.entries()) {
              const item = document.createElement('li'); item.dataset.menuItem = id;
              const label = document.createElement('span'); label.textContent = menuLabels[id];
              item.append(label);
              for (const [direction, text, offset] of [['up', '↑', -1], ['down', '↓', 1]]) {
                const move = document.createElement('button'); move.type = 'button'; move.className = 'menu-order-move';
                move.dataset.direction = direction; move.textContent = text;
                move.setAttribute('aria-label', `Move ${menuLabels[id]} ${direction}`);
                move.disabled = index + offset < 0 || index + offset >= order.length;
                move.addEventListener('click', () => {
                  const next = [...draft.menuItemOrder];
                  [next[index], next[index + offset]] = [next[index + offset], next[index]];
                  draft.menuItemOrder = next; markDraftChanged(); renderMenuOrder(id, direction);
                });
                item.append(move);
              }
              menuOrderList.append(item);
              if (id === focusId) {
                const preferred = item.querySelector(`[data-direction="${focusDirection}"]`);
                (preferred?.disabled ? item.querySelector('button:not(:disabled)') : preferred)?.focus();
              }
            }
          }
          menuOrder.append(menuOrderHeading, menuOrderNote, menuOrderList); menuDetails.append(menuOrder);
          const miniplayerNote = document.createElement('p'); miniplayerNote.className = 'section-note';
          miniplayerNote.textContent = 'Size remains automatic and adapts to the available window space.';
          $('section-miniplayer').append(miniplayerNote);
          const accessNote = document.createElement('p'); accessNote.className = 'section-note';
          accessNote.textContent = 'Keep at least one button enabled. With the header button off, open a video to access settings. Changes apply after reload.';
          $('section-interface').append(accessNote);
          const extensionsHeading = document.createElement('h3'); extensionsHeading.textContent = 'Recommended extensions';
          const extensionsNote = document.createElement('p'); extensionsNote.className = 'section-note';
          extensionsNote.textContent = 'Optional companions to YouTube Master Suite. Install and manage them in your browser. This list does not check installation status or enable extensions.';
          $('section-extensions').append(extensionsHeading, extensionsNote);
          for (const extension of suite.settingsAssets.recommendedExtensions) {
            const card = document.createElement('article'); card.className = 'extension-card';
            card.id = `ytms-extension-${extension.id}`; card.setAttribute('aria-labelledby', `${card.id}-name`);
            const image = document.createElement('img'); image.src = extension.logo;
            image.alt = `${extension.name} logo`; image.width = 40; image.height = 40;
            const details = document.createElement('div'); details.className = 'extension-details';
            const name = document.createElement('h4'); name.id = `${card.id}-name`; name.textContent = extension.name;
            const description = document.createElement('p'); description.textContent = extension.description;
            const note = document.createElement('p'); note.className = 'extension-note'; note.textContent = extension.note;
            const link = document.createElement('a'); link.href = extension.url;
            link.target = '_blank'; link.rel = 'noopener noreferrer'; link.className = 'extension-link';
            link.textContent = 'Official website'; link.setAttribute('aria-label', `${extension.name}: official website (opens in a new tab)`);
            details.append(name, description, note, link); card.append(image, details); $('section-extensions').append(card);
          }
          const credits = document.createElement('div'); credits.className = 'credits';
          const logo = document.createElement('img'); logo.id = 'ytms-credits-logo';
          logo.src = suite.settingsAssets.logo; logo.alt = 'YouTube Master Suite logo'; logo.width = 96; logo.height = 96;
          const heading = document.createElement('h3'); heading.textContent = 'YouTube Master Suite';
          const author = document.createElement('p'); author.textContent = 'Created by Citizen';
          const version = document.createElement('p'); version.textContent = `Version ${suite.version} · GNU GPLv3`;
          const github = document.createElement('a'); github.id = 'ytms-credits-github';
          github.href = 'https://github.com/noswimmingplease'; github.target = '_blank'; github.rel = 'noopener noreferrer';
          github.textContent = 'noswimmingplease on GitHub';
          credits.append(logo, heading, author, version, github); $('section-credits').append(credits);
          const normaliseHex = settings.normaliseHex;
          function theme() { return document.documentElement.hasAttribute('dark') ? 'dark' : 'light'; }
          function colours() { return settings.colours(draft, theme() === 'dark'); }
          function rgb(hex) { return [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16)); }
          function hex(channels) { return '#' + channels.map(value => value.toString(16).padStart(2, '0')).join('').toUpperCase(); }
          function luminance(colour) {
            return rgb(colour).map(value => { const channel = value / 255; return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4; })
              .reduce((sum, channel, index) => sum + channel * [.2126, .7152, .0722][index], 0);
          }
          function samePreferences(left, right) {
            return Object.keys(DEFAULTS).every(key => {
              const value = left[key], other = right[key];
              return Array.isArray(value) && Array.isArray(other)
                ? value.length === other.length && value.every((item, index) => item === other[index])
                : value === other;
            });
          }
          function primaryActionState() {
            const invalid = draft.colourMode === 'custom' && ['viewer', 'owner'].some(name => !normaliseHex($(`${name}-hex`).value));
            const inaccessible = draft.headerSettingsIcon === 'off' && draft.playerSettingsIcon === 'off';
            return {
              invalid, inaccessible,
              dirty: invalid || inaccessible || !samePreferences(settings.validate(draft), saved),
              pendingReload: !samePreferences(saved, settings.initial),
            };
          }
          function updatePrimaryAction() {
            const state = primaryActionState();
            const reload = !externalConflict && !state.dirty && state.pendingReload;
            const button = $('save-preview'), label = reload ? 'Reload now' : 'Save', action = reload ? 'reload' : 'save';
            const disabled = externalConflict || state.invalid || state.inaccessible || (!state.dirty && !state.pendingReload);
            if (button.textContent !== label) button.textContent = label;
            if (button.dataset.action !== action) button.dataset.action = action;
            if (button.disabled !== disabled) button.disabled = disabled;
            supportPanel?.updateDraftState();
            return state;
          }
          function showConflictNotice() {
            $('settings-status').textContent = 'Settings changed in another window. Your draft has been kept. Cancel and reopen settings before saving or reloading.';
            $('settings-status').hidden = false;
          }
          function reconcileStoredPreferences() {
            if (!dialog.open) return true;
            const current = settings.read();
            if (samePreferences(current, saved)) return !externalConflict;
            if (externalConflict || primaryActionState().dirty) {
              externalConflict = true; updatePrimaryAction(); showConflictNotice();
              return false;
            }
            saved = current; draft = { ...saved };
            closePicker(false); populate();
            $('settings-status').textContent = primaryActionState().pendingReload
              ? 'Saved settings changed in another window. Reload when ready to apply them.'
              : 'Saved settings changed in another window. They now match the settings applied to this page.';
            $('settings-status').hidden = false;
            return true;
          }
          function setHidden(element, hidden) {
            if (element.hidden !== hidden) element.hidden = hidden;
          }
          function updateColours() {
            const custom = draft.colourMode === 'custom';
            setHidden($('custom-colours'), !custom); setHidden($('palette-row'), draft.colourMode !== 'preset');
            const pair = colours(); const preview = $('comment-preview');
            if (preview.dataset.mode !== draft.colourMode) preview.dataset.mode = draft.colourMode;
            function setColourStyle(element, name, value) {
              if (element.style.getPropertyValue(name) !== value) element.style.setProperty(name, value);
            }
            for (const [index, name] of ['viewer', 'owner'].entries()) {
              if (pair) setColourStyle(preview, `--${name}-colour`, pair[index]);
              else if (preview.style.getPropertyValue(`--${name}-colour`)) preview.style.removeProperty(`--${name}-colour`);
              setColourStyle($(`${name}-swatch`), '--swatch', draft[`${name}Colour`]);
            }
            const inaccessible = draft.headerSettingsIcon === 'off' && draft.playerSettingsIcon === 'off';
            setHidden($('button-access-error'), !inaccessible);
            updatePrimaryAction();
            const background = luminance(theme() === 'dark' ? '#0F0F0F' : '#FFFFFF');
            setHidden($('contrast-warning'), !pair || !pair.some(colour => {
              const foreground = luminance(colour);
              return (Math.max(foreground, background) + .05) / (Math.min(foreground, background) + .05) < 4.5;
            }));
          }
          function populate(keys) {
            const selected = keys ? new Set(keys) : null;
            for (const [key, value] of Object.entries(draft)) {
              if (selected && !selected.has(key)) continue;
              const input = $(key); if (!input) continue;
              if (input.type === 'checkbox') input.checked = value; else input.value = value;
            }
            if (!selected || selected.has('colourMode')) $('colour-mode').value = draft.colourMode;
            if (!selected || selected.has('palette')) $('palette').value = draft.palette;
            for (const name of ['viewer', 'owner']) {
              if (selected && !selected.has(`${name}Colour`)) continue;
              $(`${name}-hex`).value = draft[`${name}Colour`];
              $(`${name}-hex`).setAttribute('aria-invalid', 'false'); $(`${name}-error`).hidden = true;
            }
            updateColours();
            if (!selected || selected.has('menuItemOrder')) renderMenuOrder();
          }
          function closePicker(restoreFocus = true) {
            $('colour-picker').hidden = true;
            pickerTrigger?.setAttribute('aria-expanded', 'false');
            if (restoreFocus) pickerTrigger?.focus();
            pickerTarget = null; pickerTrigger = null;
          }
          function updateChannels() {
            const channels = rgb(draft[`${pickerTarget}Colour`]);
            ['red', 'green', 'blue'].forEach((name, index) => {
              $(name).value = channels[index]; $(`${name}-value`).value = channels[index];
              const start = [...channels]; const end = [...channels]; start[index] = 0; end[index] = 255;
              $(name).style.background = `linear-gradient(to right, ${hex(start)}, ${hex(end)})`;
            });
          }
          for (const name of ['viewer', 'owner']) {
            $(`${name}-hex`).addEventListener('input', event => {
              const value = normaliseHex(event.target.value);
              event.target.setAttribute('aria-invalid', String(!value)); $(`${name}-error`).hidden = Boolean(value);
              if (value) { draft[`${name}Colour`] = value; if (pickerTarget === name) updateChannels(); }
              updateColours();
            });
            $(`${name}-swatch`).addEventListener('click', event => {
              if (pickerTarget === name) { closePicker(); return; }
              closePicker(false); pickerTarget = name; pickerTrigger = event.currentTarget;
              pickerTrigger.setAttribute('aria-expanded', 'true'); $('colour-picker').hidden = false;
              $('picker-title').textContent = name === 'viewer' ? 'Viewer name colour' : 'Uploader and pinned colour';
              updateChannels(); $('red').focus();
            });
          }
          for (const name of ['red', 'green', 'blue']) {
            $(name).addEventListener('input', () => {
              if (!pickerTarget) return;
              draft[`${pickerTarget}Colour`] = hex(['red', 'green', 'blue'].map(channel => Number($(channel).value)));
              $(`${pickerTarget}-hex`).value = draft[`${pickerTarget}Colour`];
              $(`${pickerTarget}-hex`).setAttribute('aria-invalid', 'false'); $(`${pickerTarget}-error`).hidden = true;
              updateChannels(); updateColours();
            });
          }
          $('close-picker').addEventListener('click', () => closePicker());
          $('colour-mode').addEventListener('change', event => { closePicker(false); draft.colourMode = event.target.value; updateColours(); });
          $('palette').addEventListener('change', event => { draft.palette = event.target.value; updateColours(); });
          for (const key of ['compactComments', 'hideCommentControls']) {
            $(key).addEventListener('change', event => { draft[key] = event.target.checked; updateColours(); });
          }
          function openPanel() {
            saved = settings.read(); draft = { ...saved };
            externalConflict = false;
            supportPanel?.reset();
            menuDetails.open = false;
            $('settings-status').hidden = true;
            closePicker(false); populate(); selectTab('comments');
            if (primaryActionState().pendingReload) {
              $('settings-status').textContent = 'Saved changes are waiting for reload. This page still uses its previous settings.';
              $('settings-status').hidden = false;
            }
            dialog.showModal(); $('tab-comments').focus();
          }

          for (const id of ['close-panel', 'cancel-panel']) $(id).addEventListener('click', () => dialog.close());
          dialog.addEventListener('close', () => closePicker(false));
          dialog.addEventListener('keydown', event => {
            event.stopPropagation();
            if (event.key === 'Escape' && pickerTarget) { event.preventDefault(); closePicker(); }
          });
          dialog.addEventListener('click', event => {
            if (event.target !== dialog) return;
            const box = dialog.getBoundingClientRect();
            if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.close();
          });
          function markDraftChanged() {
            if (externalConflict) showConflictNotice();
            else setHidden($('settings-status'), true);
            updatePrimaryAction();
          }
          dialog.addEventListener('input', markDraftChanged);
          dialog.addEventListener('change', markDraftChanged);
          function restoreDraftDefaults(keys, message) {
            for (const key of keys) draft[key] = Array.isArray(DEFAULTS[key]) ? [...DEFAULTS[key]] : DEFAULTS[key];
            markDraftChanged(); closePicker(false); populate(keys);
            if (externalConflict) { showConflictNotice(); return; }
            const state = primaryActionState();
            $('settings-status').textContent = state.dirty ? message : state.pendingReload
              ? 'Defaults match your saved settings. Reload when ready to apply them. Saved channel filters are unchanged.'
              : 'These settings already match the defaults. Saved channel filters are unchanged.';
            $('settings-status').hidden = false;
          }
          $('restore-section-defaults').addEventListener('click', () => {
            const keys = currentTab === 'comments'
              ? ['colourMode', 'palette', 'viewerColour', 'ownerColour', 'compactComments', 'hideCommentControls']
              : (GROUPS[currentTab] || []).map(([key]) => key);
            if (!keys.length) return;
            if (currentTab === 'interface') keys.push('menuItemOrder');
            restoreDraftDefaults(keys, `${$(`tab-${currentTab}`).textContent} defaults restored in this draft. Save to apply. Saved channel filters are unchanged.`);
          });
          $('restore-defaults').addEventListener('click', () => {
            restoreDraftDefaults(Object.keys(DEFAULTS), 'All settings restored in this draft. Save to apply. Saved channel filters are unchanged.');
          });
          $('save-preview').addEventListener('click', () => {
            if (!reconcileStoredPreferences()) return;
            const state = updatePrimaryAction();
            if ($('save-preview').disabled) return;
            if (!state.dirty) {
              if (state.pendingReload && window.confirm('Reload YouTube now? This will restart the current page and video.')) location.reload();
              return;
            }
            const result = settings.save(draft);
            if (result.ok) { saved = result.values; draft = { ...saved }; }
            const next = updatePrimaryAction();
            $('settings-status').hidden = false;
            $('settings-status').textContent = !result.ok ? result.error : next.pendingReload
              ? 'Saved. Please reload this page.'
              : 'Saved. No reload needed.';
          });
          supportPanel = suite.createSettingsSupportPanel(document, suite, {
            hasDraft: () => externalConflict || primaryActionState().dirty,
            onRestored: result => {
              saved = result.values; draft = { ...saved }; externalConflict = false;
              closePicker(false); populate(); renderChannelRules();
              window.dispatchEvent(new CustomEvent('yt-master-channel-age-changed'));
              $('settings-status').hidden = false;
              $('settings-status').textContent = primaryActionState().pendingReload
                ? 'Backup restored. Please reload this page.' : 'Backup restored. No reload needed.';
            },
          });
          $('section-support').append(supportPanel.element);
          dialog.addEventListener('close', () => supportPanel.close());
          populate(); selectTab('comments');
          return { dialog, open: openPanel, updateTheme: updateColours, updateChannels: renderChannelRules, reconcileSaved: reconcileStoredPreferences };

        }

        function syncTheme() {
          const pair = settings.colours();
          const coloursCss = settings.initial.colourMode === "preset" && pair
            ? `:root { --ytms-viewer-colour: ${pair[0]}; --ytms-owner-colour: ${pair[1]}; }` : "";
          suite.setStyle("suiteSettings", suite.settingsAssets.css + coloursCss);
          if (document.getElementById(DIALOG_ID)?.open) panel?.updateTheme();
        }

        function openSettings() {
          if (suspended) return;
          hidePlayerTooltip();
          try {
            if (panel && !panel.dialog.isConnected) panel = null;
            panel ||= createPanel();
            panel.open();
          } catch (error) {
            document.getElementById(DIALOG_ID)?.remove();
            panel = null;
            suite.reportModuleError("suiteSettings", "open settings", error);
          }
        }

        function isRendered(element) {
          return Boolean(element?.isConnected && !element.closest('[hidden], [aria-hidden="true"]') && element.getClientRects().length);
        }

        function getPlayerTarget() {
          if (location.pathname !== '/watch' && !location.pathname.startsWith('/live/')) return null;
          const floatingOwner = document.querySelector('#ytsmp-player-placeholder')?.closest('ytd-watch-flexy');
          const mirrorPlayer = document.getElementById('ytppl-video-mirror-button')?.closest('#movie_player');
          const players = new Set([mirrorPlayer, ...document.querySelectorAll('#movie_player')]);
          for (const player of players) {
            if (!isRendered(player) || player.closest('ytd-miniplayer, ytd-video-preview, ytd-reel-video-renderer')) continue;
            const root = player.closest('ytd-watch-flexy') || (player.parentElement === document.body ? floatingOwner : null);
            if (isRendered(root) && player.querySelector('video.html5-main-video')) {
              return { player, controls: player.querySelector('.ytp-right-controls'), root };
            }
          }
          const root = Array.from(document.querySelectorAll('ytd-watch-flexy')).find(isRendered);
          return root ? { root, player: null, controls: null } : null;
        }

        function hidePlayerTooltip() {
          if (playerTooltip) {
            tooltipVisibilityObserver.disconnect();
            document.removeEventListener('pointermove', dismissPlayerTooltipOnPointerMove, true);
            document.removeEventListener('pointerout', dismissPlayerTooltipOnPointerOut, true);
            document.removeEventListener('pointerdown', hidePlayerTooltip, true);
            document.removeEventListener('pointercancel', hidePlayerTooltip, true);
            document.removeEventListener('scroll', hidePlayerTooltip, true);
            document.removeEventListener('visibilitychange', dismissHiddenPlayerTooltip);
            document.removeEventListener('keydown', dismissPlayerTooltipOnEscape, true);
          }
          playerTooltip?.remove(); playerTooltip = null;
          playerButton?.removeAttribute('aria-describedby');
        }

        function isPlayerTooltipOwnerVisible() {
          const player = playerTarget?.player;
          if (suspended || document.visibilityState === 'hidden' || playerButton?.disabled ||
            !isRendered(playerButton) || !player?.contains(playerButton) || player.classList.contains('ytp-autohide')) return false;
          for (let node = playerButton; node; node = node.parentElement) {
            const style = getComputedStyle(node);
            if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' ||
              Number.parseFloat(style.opacity) === 0 || node.getAttribute('aria-disabled') === 'true') return false;
            if (node === player) break;
          }
          return true;
        }

        function dismissPlayerTooltipOnPointerMove(event) {
          if (!playerButton?.contains(event.target)) hidePlayerTooltip();
        }
        function dismissPlayerTooltipOnPointerOut(event) {
          if (!event.relatedTarget) hidePlayerTooltip();
        }
        function dismissHiddenPlayerTooltip() {
          if (document.visibilityState === 'hidden') hidePlayerTooltip();
        }
        function dismissPlayerTooltipOnEscape(event) {
          if (event.key === 'Escape') hidePlayerTooltip();
        }

        function showPlayerTooltip(event) {
          if (!isPlayerTooltipOwnerVisible() ||
            (event.type === 'focus' && !playerButton.matches(':focus-visible'))) { hidePlayerTooltip(); return; }
          if (!playerTooltip) {
            const player = playerTarget.player;
            const tooltip = document.createElement('div');
            tooltip.id = TOOLTIP_ID; tooltip.setAttribute('role', 'tooltip'); tooltip.textContent = 'Suite settings';
            playerTooltip = player.appendChild(tooltip);
            playerButton.setAttribute('aria-describedby', TOOLTIP_ID);
            // Observe only the visible tooltip's owner chain, never the page subtree.
            for (let node = playerButton; node; node = node.parentElement) {
              tooltipVisibilityObserver.observe(node, { attributes: true, attributeFilter: ['class', 'style', 'hidden', 'aria-hidden', 'aria-disabled', 'disabled'] });
              if (node === player) break;
            }
            document.addEventListener('pointermove', dismissPlayerTooltipOnPointerMove, true);
            document.addEventListener('pointerout', dismissPlayerTooltipOnPointerOut, true);
            document.addEventListener('pointerdown', hidePlayerTooltip, true);
            document.addEventListener('pointercancel', hidePlayerTooltip, true);
            document.addEventListener('scroll', hidePlayerTooltip, true);
            document.addEventListener('visibilitychange', dismissHiddenPlayerTooltip);
            document.addEventListener('keydown', dismissPlayerTooltipOnEscape, true);
          }
          positionPlayerTooltip();
        }

        function positionPlayerTooltip() {
          const player = playerTarget?.player, tooltip = playerTooltip;
          if (!isPlayerTooltipOwnerVisible() || !tooltip?.isConnected ||
            !player?.contains(playerButton) || !player.contains(tooltip)) { hidePlayerTooltip(); return; }
          const playerRect = player.getBoundingClientRect(), buttonRect = playerButton.getBoundingClientRect();
          if (!playerRect.width || !playerRect.height || !buttonRect.width || !buttonRect.height) { hidePlayerTooltip(); return; }
          const width = player.offsetWidth || playerRect.width, height = player.offsetHeight || playerRect.height;
          const scaleX = playerRect.width / width, scaleY = playerRect.height / height;
          const left = (buttonRect.left + buttonRect.width / 2 - playerRect.left) / scaleX - tooltip.offsetWidth / 2;
          const progress = player.querySelector('.ytp-progress-bar-container');
          const progressRect = isRendered(progress) ? progress.getBoundingClientRect() : null;
          const aboveControls = progressRect?.width > 0 && progressRect.height > 0 &&
            progressRect.top >= playerRect.top && progressRect.bottom <= buttonRect.top + 1 &&
            progressRect.left >= playerRect.left - 1 && progressRect.right <= playerRect.right + 1;
          const bottom = aboveControls ? (progressRect.top - playerRect.top) / scaleY - 8 : (buttonRect.top - playerRect.top) / scaleY - 20;
          tooltip.style.left = `${Math.round(Math.max(8, Math.min(left, width - tooltip.offsetWidth - 8)))}px`;
          tooltip.style.top = `${Math.round(Math.max(8, bottom - tooltip.offsetHeight))}px`;
        }

        function refreshPlayerTooltip() {
          if (!playerTooltip) return;
          if (playerButton?.matches(':hover') || (document.activeElement === playerButton && playerButton.matches(':focus-visible'))) positionPlayerTooltip();
          else hidePlayerTooltip();
        }

        function installPlayerButton(target) {
          if (playerTarget?.player !== target?.player || playerTarget?.controls !== target?.controls) hidePlayerTooltip();
          playerTarget = target;
          const controls = target?.controls;
          if (!controls) { playerButton?.remove(); hidePlayerTooltip(); return; }
          if (!playerButton) {
            playerButton = document.createElement('button');
            playerButton.id = PLAYER_BUTTON_ID; playerButton.type = 'button'; playerButton.className = 'ytp-button';
            playerButton.setAttribute('aria-label', 'Suite settings');
            playerButton.setAttribute('aria-haspopup', 'dialog'); playerButton.setAttribute('aria-controls', DIALOG_ID);
            const image = document.createElement('img');
            image.src = settings.initial.playerSettingsIcon === 'colour' ? suite.settingsAssets.logo : suite.settingsAssets.playerLogo;
            image.alt = ''; image.width = 36; image.height = 36;
            image.setAttribute('aria-hidden', 'true'); playerButton.append(image);
            playerButton.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); openSettings(); });
            playerButton.addEventListener('mouseenter', showPlayerTooltip);
            playerButton.addEventListener('focus', showPlayerTooltip);
            playerButton.addEventListener('mouseleave', hidePlayerTooltip);
            playerButton.addEventListener('blur', hidePlayerTooltip);
          }
          const anchor = controls.querySelector('#ytppl-video-mirror-button') || controls.querySelector('.ytp-size-button, .ytp-fullscreen-button');
          const parent = anchor?.parentElement || controls;
          if (playerButton.parentElement !== parent || playerButton.nextElementSibling !== anchor) {
            hidePlayerTooltip(); parent.insertBefore(playerButton, anchor || null);
          }
          refreshPlayerTooltip();
        }

        function installButton() {
          frame = 0;
          if (suspended) return;
          const masthead = settings.initial.headerSettingsIcon === 'off' ? null : document.querySelector("ytd-masthead");
          const app = document.querySelector("ytd-app");
          const mastheadContainer = app?.querySelector('#masthead-container') || null;
          const target = settings.initial.playerSettingsIcon === 'off' ? null : getPlayerTarget();
          const playerBranch = new Set();
          for (let node = target?.controls || target?.player || target?.root; node && node !== document.body; node = node.parentElement) playerBranch.add(node);
          if (target && !target.controls) {
            const scope = target.player || target.root;
            for (const node of scope.querySelectorAll('#player, #player-container, #player-container-inner, #single-column-container, #full-bleed-container, #player-full-bleed-container, .ytp-chrome-bottom, .ytp-chrome-controls')) playerBranch.add(node);
          }
          const pageManager = app?.querySelector('ytd-page-manager, #page-manager');
          if (pageManager) playerBranch.add(pageManager);
          const branch = Array.from(playerBranch);
          if (!discoveryActive || app !== watchedApp || masthead !== watchedMasthead || mastheadContainer !== watchedMastheadContainer ||
            branch.length !== watchedPlayerBranch.length || branch.some((node, index) => node !== watchedPlayerBranch[index])) {
            const registrations = [[document.documentElement, { childList: true }]];
            if (document.body) registrations.push([document.body, { childList: true }]);
            if (app) registrations.push([app, { childList: true }]);
            if (mastheadContainer) registrations.push([mastheadContainer, { childList: true }]);
            if (masthead) registrations.push([masthead, { childList: true, subtree: true }]);
            for (const node of branch) registrations.push([node, { childList: true, ...(node === target?.controls ? { subtree: true } : {}) }]);
            discovery.replaceRegistrations(registrations);
            watchedApp = app; watchedMasthead = masthead;
            watchedMastheadContainer = mastheadContainer; discoveryActive = true;
            watchedPlayerBranch = branch;
          }
          installPlayerButton(target);
          if (!masthead) { button?.remove(); return; }
          const avatar = masthead.querySelector("#avatar-btn, button[aria-label*='Account'], button[aria-label*='account']");
          if (!avatar) { button?.remove(); return; }
          const anchor = avatar.closest("ytd-topbar-menu-button-renderer, ytd-topbar-menu-button-view-model") || avatar;
          if (!button) {
            button = document.createElement("button");
            button.id = BUTTON_ID; button.type = "button";
            button.setAttribute("aria-label", "Suite settings");
            button.setAttribute("aria-haspopup", "dialog");
            button.setAttribute("aria-controls", DIALOG_ID);
            button.title = "Suite settings";
            const image = document.createElement("img");
            button.dataset.icon = settings.initial.headerSettingsIcon;
            image.src = settings.initial.headerSettingsIcon === 'monochrome' ? suite.settingsAssets.playerLogo : suite.settingsAssets.logo;
            image.alt = "";
            image.width = 32; image.height = 32; image.setAttribute("aria-hidden", "true");
            button.append(image);
            button.addEventListener("click", openSettings);
          }
          if (button.parentNode !== anchor.parentNode || button.nextElementSibling !== anchor) {
            anchor.before(button);
          }
        }

        function scheduleInstall() {
          if (!suspended && !frame) frame = requestAnimationFrame(installButton);
        }
        const discovery = new MutationObserver(records => {
          // Text and comment updates cannot replace a player, control or header
          // anchor. Keep discovery for structural changes, not native label churn.
          for (const record of records) {
            for (const nodes of [record.addedNodes, record.removedNodes]) {
              for (const node of nodes) {
                if (node.nodeType === 1) { scheduleInstall(); return; }
              }
            }
          }
        });
        const themeObserver = new MutationObserver(syncTheme);
        const tooltipVisibilityObserver = new MutationObserver(refreshPlayerTooltip);
        function start() {
          suspended = false;
          watchedApp = null; watchedMasthead = null;
          themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["dark"] });
          syncTheme(); installButton();
        }
        function stop() {
          suspended = true;
          if (frame) cancelAnimationFrame(frame);
          frame = 0;
          discovery.disconnect(); themeObserver.disconnect();
          discoveryActive = false;
          hidePlayerTooltip();
          document.getElementById(DIALOG_ID)?.close();
          channelAgeDialog?.close();
        }
        suite.addWindowListener("pagehide", stop);
        suite.addWindowListener("pageshow", start);
        suite.addWindowListener("yt-navigate-start", () => { hidePlayerTooltip(); document.getElementById(DIALOG_ID)?.close(); channelAgeDialog?.close(); });
        suite.addWindowListener("yt-navigate-finish", scheduleInstall);
        suite.addWindowListener("yt-page-data-updated", scheduleInstall);
        suite.addWindowListener('yt-master-channel-age-changed', () => panel?.updateChannels());
        suite.addWindowListener('storage', event => {
          if (event.key === null || event.key === settings.key || event.key === 'yt-master-suite.scroll-miniplayer.corner.v1') panel?.reconcileSaved();
          if (event.key === null || event.key === suite.channelAge.key) window.dispatchEvent(new CustomEvent('yt-master-channel-age-changed'));
        });
        document.addEventListener('loadedmetadata', event => { if (event.target?.matches?.('video.html5-main-video')) scheduleInstall(); }, true);
        document.addEventListener('fullscreenchange', () => { hidePlayerTooltip(); scheduleInstall(); }, true);
        suite.addWindowListener('resize', refreshPlayerTooltip);
        suite.addWindowListener('blur', hidePlayerTooltip);
        start();
    },
  );

  if (!publishHealthMarker()) {
    document.addEventListener("readystatechange", publishHealthMarker, {
      once: true,
    });
  }
  startIdleModules();
})();
