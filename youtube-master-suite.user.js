// ==UserScript==
// @name         YouTube Master Suite
// @namespace    Citizen.youtube.master-suite
// @version      0.1.38
// @description  Consolidates Citizen YouTube userscripts with shared SPA event, mutation-observer, and stylesheet infrastructure.
// @author       Citizen
// @license      GNU GPLv3
// @homepageURL  https://github.com/Ci303/youtube-master-suite
// @supportURL   https://github.com/Ci303/youtube-master-suite/issues
// @updateURL    https://raw.githubusercontent.com/Ci303/youtube-master-suite/main/youtube-master-suite.user.js
// @downloadURL  https://raw.githubusercontent.com/Ci303/youtube-master-suite/main/youtube-master-suite.user.js
// @match        https://www.youtube.com/*
// @run-at       document-start
// @grant        none
// @noframes
// ==/UserScript==

(() => {
  "use strict";

  const MASTER_VERSION = "0.1.38";
  const EXPECTED_MODULE_COUNT = 7;
  const HEALTH_ATTRIBUTE = "data-yt-master-suite";
  const ENABLED_MODULES = Object.freeze({
    commentCleaner: true,
    feedUiCleaner: true,
    miniplayerButtonRestorer: true,
    pageCoherence: true,
    playerPreferencesLite: true,
    scrollMiniplayer: true,
    watchLayoutCleaner: true,
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
      if (
        mutation.target !== target &&
        (!options.subtree || !target.contains(mutation.target))
      ) {
        continue;
      }

      if (mutation.type === "childList" && options.childList) return true;
      if (mutation.type === "characterData" && options.characterData) return true;
      if (
        mutation.type === "attributes" &&
        options.attributes &&
        (!options.attributeFilter ||
          options.attributeFilter.includes(mutation.attributeName))
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
      styleElement = document.createElement("style");
      styleElement.id = "yt-master-suite-style";
      (document.head || document.documentElement).appendChild(styleElement);
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

  const suite = {
    SharedMutationObserver,
    addWindowListener,
    registerModule,
    removeStyle,
    setStyle,
  };

  installDiagnostics();

  suite.registerModule(
    "commentCleaner",
    "Comment Cleaner v1.18",
    "document-idle",
    () => {
      const MutationObserver = suite.SharedMutationObserver;
      const GM_addStyle = (css) => suite.setStyle("commentCleaner", css);

      "use strict";

        const COMMENTER_BLUE = "#82a3e6";
        const UPLOADER_ORANGE = "#ff9f1c";
        const CONFIG = {
          hideCommentControls: true,
          colourCommenters: true,
          compactComments: true,
        };

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
        let preNavigationCommentNodes = new Set();
        const pendingStaleCommentContainers = new Set();
        const commentsVideoGuardRecoveryTimers = new Map();
        const commentsVideoGuardScheduledDelays = new Set();

        const isWatchPath = () =>
          location.pathname === "/watch" || location.pathname.startsWith("/live/");

        const queryAllDeep = (sel, root = document) => {
          const out = [];

          const crawl = (node) => {
            if (!node || !node.querySelectorAll) return;

            if (node.matches && node.matches(sel)) out.push(node);

            node.querySelectorAll(sel).forEach((n) => out.push(n));
            node.querySelectorAll("*").forEach((el) => {
              if (el.shadowRoot) crawl(el.shadowRoot);
            });
          };

          crawl(root);
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
          const destinationVideoId = commentsVideoGuardDestinationVideoId;
          if (
            !commentsVideoGuardPending ||
            !isWatchPath() ||
            !destinationVideoId ||
            getCurrentVideoId() !== destinationVideoId
          ) {
            return;
          }

          const generation = commentsVideoGuardGeneration;
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
          preNavigationCommentNodes = new Set();
          pendingStaleCommentContainers.clear();
          getCommentContainers(document).forEach((comments) => {
            getRenderedCommentNodes(comments).forEach((node) =>
              preNavigationCommentNodes.add(node),
            );
            comments.setAttribute(STALE_COMMENTS_ATTRIBUTE, "1");
            pendingStaleCommentContainers.add(comments);
          });
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

        const colourCommentAuthorLinks = (root = document) => {
          if (uploaderPathsReadyVideoKey !== getVideoKey()) return;

          const uploaderPaths = getUploaderPaths();

          queryAllDeep(COMMENT_AUTHOR_SELECTOR, root).forEach((link) => {
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

        const hideCommentControls = (root = document) => {
          queryAllDeep(COMMENT_CONTROL_SELECTOR, root).forEach(hideNode);

          queryAllDeep(COMMENT_OVERFLOW_BUTTON_SELECTOR, root).forEach((button) => {
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

          if (CONFIG.hideCommentControls) hideCommentControls(applyRoot);
          if (CONFIG.colourCommenters) colourCommentAuthorLinks(applyRoot);
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

      /* Compact comments header */
      ytd-comments-header-renderer {
        margin-top:2px !important;
        margin-bottom:2px !important;
      }

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

          for (const pendingRoot of Array.from(pendingApplyRoots)) {
            if (pendingRoot === root || pendingRoot.contains(root)) return;
            if (root.contains(pendingRoot)) pendingApplyRoots.delete(pendingRoot);
          }

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
            const roots = Array.from(pendingApplyRoots);
            pendingApplyRoots.clear();
            roots.forEach((pendingRoot) => {
              if (pendingRoot.isConnected !== false) applyAll(pendingRoot);
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
    "Feed UI Cleaner v2.6",
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

        const CARD_FILTERS = [
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
          if (isInsideExcludedSurface(el) || !filter.matches(el)) return;

          const container = getCardContainer(el);
          if (!container || isInsideExcludedSurface(container)) return;

          const current = matchesByContainer.get(container) || {
            permanent: false,
            reasons: new Set(),
          };
          current.permanent ||= Boolean(filter.permanent);
          current.reasons.add(filter.reason);
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
          const profile = getFilterProfile();

          CARD_FILTERS.forEach((filter) => {
            if (!filter.permanent && profile[filter.key] === false) return;

            collectMatchingElements(root, filter.selector).forEach((el) =>
              addContainerMatch(matchesByContainer, el, filter),
            );
          });

          matchesByContainer.forEach((_match, container) => containers.add(container));
          addPreviouslyFilteredContainers(containers, root);

          containers.forEach((container) => {
            const match = matchesByContainer.get(container);
            if (!match) {
              container.removeAttribute(HIDDEN_FLAG);
              container.removeAttribute(HIDDEN_REASON_ATTRIBUTE);
              container.removeAttribute(PERMANENT_HIDDEN_FLAG);
              return;
            }

            const reasons = [...match.reasons].sort().join(', ');
            if (match.permanent) {
              container.setAttribute(PERMANENT_HIDDEN_FLAG, '1');
              container.removeAttribute(HIDDEN_FLAG);
            } else {
              container.setAttribute(HIDDEN_FLAG, '1');
              container.removeAttribute(PERMANENT_HIDDEN_FLAG);
            }
            container.setAttribute(HIDDEN_REASON_ATTRIBUTE, reasons);
          });
        }

        function cleanUp(root = document) {
          const rootElement =
            root && root.nodeType === Node.ELEMENT_NODE ? root : null;
          if (rootElement && rootElement.closest(FEED_SURFACE_SELECTOR)) {
            reconcileFilteredCards(rootElement);
            scheduleFilterToggleUpdate();
            return;
          }

          collectMatchingElements(root, FEED_SURFACE_SELECTOR).forEach((surface) => {
            reconcileFilteredCards(surface);
          });
          scheduleFilterToggleUpdate();
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

          for (const pendingRoot of Array.from(pendingCleanUpRoots)) {
            if (pendingRoot === root || pendingRoot.contains?.(root)) return;
            if (root.contains?.(pendingRoot)) pendingCleanUpRoots.delete(pendingRoot);
          }

          pendingCleanUpRoots.add(root);
        }

        function scheduleCleanUp(root) {
          addPendingCleanUpRoot(root);
          if (!pendingCleanUpRoots.size) return;
          if (cleanUpFrame) return;

          cleanUpFrame = requestAnimationFrame(() => {
            cleanUpFrame = 0;
            const roots = Array.from(pendingCleanUpRoots);
            pendingCleanUpRoots.clear();
            roots.forEach((pendingRoot) => {
              if (pendingRoot.isConnected !== false) cleanUp(pendingRoot);
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

        function mutationCanAffectFiltering(mutation) {
          if (mutation.type === 'childList') return true;

          const element =
            mutation.target?.nodeType === Node.ELEMENT_NODE
              ? mutation.target
              : mutation.target?.parentElement;
          if (!element) return false;

          if (
            mutation.type === 'attributes' &&
            mutation.attributeName?.startsWith('data-ytppl-')
          ) {
            return true;
          }

          return Boolean(element.closest(FILTER_MUTATION_TRIGGER_SELECTOR));
        }

        GM_addStyle(buildCss());
        cleanUp(document);

        const observer = new MutationObserver((mutations) => {
          for (const mutation of mutations) {
            if (!mutationCanAffectFiltering(mutation)) continue;

            if (mutation.type !== 'childList') {
              const cleanUpRoot = getMutationCleanUpRoot(mutation);
              if (cleanUpRoot) scheduleCleanUp(cleanUpRoot);
              continue;
            }

            const mutationRoot = getMutationCleanUpRoot(mutation);
            if (mutationRoot) scheduleCleanUp(mutationRoot);
            if (!mutation.addedNodes || !mutation.addedNodes.length) continue;

            mutation.addedNodes.forEach((node) => {
              const cleanUpRoot = getAddedNodeCleanUpRoot(node);
              if (cleanUpRoot) scheduleCleanUp(cleanUpRoot);
            });
          }
        });

        const OBSERVER_OPTIONS = {
          attributeFilter: [
            'href',
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
        suite.addWindowListener('pagehide', () => {
          stopMutationObservation();
          resetScheduledWork();
        }, true);
        suite.addWindowListener('pageshow', reconcileRoute, true);
    },
  );

  suite.registerModule(
    "miniplayerButtonRestorer",
    "Miniplayer Button Restorer v1.6",
    "document-idle",
    () => {
      const MutationObserver = suite.SharedMutationObserver;
      const GM_addStyle = (css) => suite.setStyle("miniplayerButtonRestorer", css);

      "use strict";

        const BTN_ID = "tmk-miniplayer-button";
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

        let observing = false;
        let installedButton = null;

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
          if (clickNativeMiniplayerIfPresent()) return;
          synthKeyToPlayer("i", "KeyI");
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
          btn.title = "Miniplayer (i)";
          btn.setAttribute("aria-label", "Miniplayer");
          btn.setAttribute("aria-keyshortcuts", "i");
          btn.appendChild(buildIcon());
          btn.addEventListener("click", triggerMiniplayer);
          return btn;
        }

        function removeButton() {
          const btn = installedButton?.isConnected
            ? installedButton
            : document.getElementById(BTN_ID);
          if (btn) btn.remove();
          installedButton = null;
        }

        function isButtonInstalled() {
          const button = installedButton;
          if (!button?.isConnected) return false;

          const controls = button.parentElement;
          const player = getPlayerEl();
          return Boolean(
            player &&
            controls?.matches(RIGHT_CONTROLS_SELECTOR) &&
            player.contains(controls)
          );
        }

        function installOnce() {
          if (!isEligiblePath()) {
            removeButton();
            return true;
          }

          const controls = getRightControls();
          if (!controls) return false;

          const existing = document.getElementById(BTN_ID);
          if (existing && existing.parentElement === controls) {
            installedButton = existing;
            return true;
          }

          const fullscreenBtn = controls.querySelector(FULLSCREEN_BUTTON_SELECTOR);
          const btn = existing || makeButton();

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

        const mo = new MutationObserver((muts) => {
          if (isButtonInstalled()) return;

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
          if (!observing) return;

          mo.disconnect();
          observing = false;
        }

        function onNavigate() {
          if (!isEligiblePath()) {
            clearInstallAttempts();
            stopObserve();
            clearPoll();
            removeButton();
            return;
          }

          beginObserve();
          scheduleInstallAttempts(CONFIG.navRetryDelays);
        }

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
    "Page Coherence Guard v1.7",
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

        suite.addWindowListener("yt-navigate-start", handleNavigateStart, true);
        suite.addWindowListener("yt-navigate-finish", handleNavigationUpdate, true);
        suite.addWindowListener("yt-page-data-updated", handleNavigationUpdate, true);
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
    "Player Preferences Lite v1.44",
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
        const WATCH_ACTION_MUTATION_SELECTOR = [
          "ytd-watch-flexy ytd-menu-renderer",
          WATCH_ACTION_MENU_ITEM_SELECTOR,
        ].join(",");
        const DYNAMIC_MUTATION_SURFACE_SELECTOR = [
          FEED_CARD_CONTAINER_SELECTOR,
          "ytd-rich-grid-media",
          "ytd-rich-grid-slim-media",
          "yt-lockup-view-model",
          "yt-lockup-view-model-wiz",
          SHORTS_LINK_SELECTOR,
          SHORTS_CONVERTED_LINK_SELECTOR,
          TOPBAR_LOGO_RENDERER_SELECTOR,
          WATCH_ACTION_MUTATION_SELECTOR,
          "ytd-watch-flexy ytd-video-owner-renderer",
          "ytd-watch-flexy ytd-watch-metadata",
          "ytd-watch-flexy ytd-video-primary-info-renderer",
        ].join(",");
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
            container.dataset[datasetKey] = "1";
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
          button.classList.remove(
            "ytSpecButtonShapeNextIconButton",
            "yt-spec-button-shape-next--icon-button",
          );
          button.classList.add(
            "ytSpecButtonShapeNextIconLeading",
            "yt-spec-button-shape-next--icon-leading",
          );
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
            icon.setAttribute(EMPTY_RYD_ICON_ATTRIBUTE, "1");
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
            expanded.dataset[DESCRIPTION_EXPANDED_COLLAPSED_DATASET_KEY] = "1";
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
            nativeContainer.setAttribute(WATCH_INFO_NATIVE_HIDDEN_ATTRIBUTE, "1");
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
          const nextVolume = clamp(video.volume + direction * step, 0, 1);

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

        function applyDynamicPreferences(root = document) {
          useStandardMastheadLogo(root);
          clearLegacyHiddenWatchActionButtons(root);
          rewriteShortsLinks(root);
          hideUpcomingStreams(root);
          hidePayToWatchCards(root);
          hideWatchedVideos(root);
          normaliseReturnYoutubeLikeButtons(root);
          normaliseReturnYoutubeDislikeButtons(root);
          normaliseWatchInfoText(root);
          runDescriptionCleanup(root);
          hideWatchActionButtons(root);
          hideWatchActionMenuItems(root);
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
          if (!closestElement(event.target, DESCRIPTION_TEXT_ROOT_SELECTOR)) {
            return;
          }

          [0, 100, 300, 800, 1500].forEach((delay) => {
            setTimeout(() => runDescriptionCleanup(document), delay);
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

        function addAddedNodeMutationRoot(roots, node) {
          if (addScopedMutationRoot(roots, node)) {
            return true;
          }

          const applyRoot = getApplyRoot(node);
          if (
            applyRoot &&
            applyRoot.querySelector &&
            applyRoot.querySelector(DYNAMIC_MUTATION_SURFACE_SELECTOR)
          ) {
            addMutationRoot(roots, applyRoot);
            return true;
          }

          return false;
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

        suite.addWindowListener("blur", handleWindowBlur, true);
        suite.addWindowListener("yt-navigate-start", handleNavigateStart, true);
        suite.addWindowListener("yt-navigate-finish", handleNavigateFinish, true);
        suite.addWindowListener(
          "yt-page-data-updated",
          () => {
            configureDynamicMutationObserver();
            scheduleApply(document);
            scheduleLiveChatCollapseAttempts();
          },
          true,
        );

        suite.addWindowListener(
          "pagehide",
          () => {
            cancelScheduledAnimationWork();
            clearLiveChatCollapseAttempts();
            clearPlayerLayoutRefreshAttempts();
          },
          true,
        );

        suite.addWindowListener(
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
    },
  );

  suite.registerModule(
    "scrollMiniplayer",
    "Scroll Miniplayer v5.20",
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
    "Watch Layout Cleaner v1.27",
    "document-start",
    () => {
      const MutationObserver = suite.SharedMutationObserver;
      const GM_addStyle = (css) => suite.setStyle("watchLayoutCleaner", css);

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

          suite.setStyle("watchLayoutCleaner", buildCss());
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
            const railIsEmpty =
              eligible && relatedHidden && !chatVisible && !queueVisible;

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

  if (!publishHealthMarker()) {
    document.addEventListener("readystatechange", publishHealthMarker, {
      once: true,
    });
  }
  startIdleModules();
})();
