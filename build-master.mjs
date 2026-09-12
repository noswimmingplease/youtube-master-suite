import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const MASTER_VERSION = "0.1.48";
const suiteDirectory = dirname(fileURLToPath(import.meta.url));
const outputPath = join(suiteDirectory, "youtube-master-suite.user.js");
const releaseManifestPath = join(suiteDirectory, "release-manifest.json");
const sourceLockPath = join(suiteDirectory, "sources.lock.json");

const BUILD_USAGE =
  "Usage: node build-master.mjs [--check | --self-test]";

function parseBuildArguments(arguments_) {
  const allowedArguments = new Set(["--check", "--self-test"]);
  if (
    arguments_.some((argument) => !allowedArguments.has(argument)) ||
    new Set(arguments_).size !== arguments_.length ||
    arguments_.length > 1
  ) {
    throw new Error(BUILD_USAGE);
  }

  return {
    checkOnly: arguments_[0] === "--check",
    selfTestMode: arguments_[0] === "--self-test",
  };
}

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

const { checkOnly, selfTestMode } = parseBuildArguments(
  process.argv.slice(2),
);
const sourceLock = JSON.parse(readFileSync(sourceLockPath, "utf8"));
if (sourceLock.schemaVersion !== 2) {
  throw new Error(`Unsupported source-lock schema ${sourceLock.schemaVersion}`);
}

const modules = [
  {
    id: "commentCleaner",
    label: "Comment Cleaner",
    phase: "document-idle",
  },
  {
    id: "feedUiCleaner",
    label: "Feed UI Cleaner",
    phase: "document-idle",
  },
  {
    id: "miniplayerButtonRestorer",
    label: "Miniplayer Button Restorer",
    phase: "document-idle",
  },
  {
    id: "pageCoherence",
    label: "Page Coherence Guard",
    phase: "document-idle",
  },
  {
    id: "playerPreferencesLite",
    label: "Player Preferences Lite",
    phase: "document-idle",
  },
  {
    id: "scrollMiniplayer",
    label: "Scroll Miniplayer",
    phase: "document-idle",
  },
  {
    id: "watchLayoutCleaner",
    label: "Watch Layout Cleaner",
    phase: "document-start",
  },
];

function canonicalSourcePaths() {
  return readdirSync(join(suiteDirectory, "sources", "modules"), {
    withFileTypes: true,
  })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".user.js"))
    .map((entry) => `sources/modules/${entry.name}`)
    .sort();
}

function assertSameValues(actualValues, expectedValues, description) {
  const actual = [...actualValues].sort();
  const expected = [...expectedValues].sort();
  if (
    actual.length !== expected.length ||
    actual.some((value, index) => value !== expected[index])
  ) {
    throw new Error(
      `${description}: expected [${expected.join(", ")}], ` +
        `found [${actual.join(", ")}]`,
    );
  }
}

function validateCanonicalInventory() {
  const moduleIds = modules.map(({ id }) => id);
  if (new Set(moduleIds).size !== moduleIds.length) {
    throw new Error("The build module registry contains duplicate IDs");
  }

  const lockedModules = Object.entries(sourceLock.modules || {});
  const lockedIds = lockedModules.map(([id]) => id);
  assertSameValues(
    lockedIds,
    moduleIds,
    "Build registry and source-lock IDs differ",
  );

  const lockedPaths = lockedModules.map(([, lockedSource]) => lockedSource.path);
  if (new Set(lockedPaths).size !== lockedPaths.length) {
    throw new Error("The source lock contains duplicate canonical source paths");
  }
  assertSameValues(
    lockedPaths,
    canonicalSourcePaths(),
    "Source lock and canonical module directory differ",
  );
}

validateCanonicalInventory();

function normaliseNewlines(value) {
  return value.replace(/\r\n/g, "\n");
}

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function getLockedSource(moduleDefinition) {
  const lockedSource = sourceLock.modules?.[moduleDefinition.id];
  if (!lockedSource) {
    throw new Error(`Missing source lock for ${moduleDefinition.id}`);
  }
  if (!/^sources\/modules\/[a-z0-9-]+\.user\.js$/.test(lockedSource.path)) {
    throw new Error(`Invalid source path for ${moduleDefinition.id}`);
  }
  return lockedSource;
}

async function readModuleSource(moduleDefinition) {
  const lockedSource = getLockedSource(moduleDefinition);
  if (!/^[0-9a-f]{64}$/.test(lockedSource.sha256)) {
    throw new Error(`${moduleDefinition.id}: invalid locked source hash`);
  }

  const source = normaliseNewlines(
    readFileSync(join(suiteDirectory, lockedSource.path), "utf8"),
  );
  if (sha256(source) !== lockedSource.sha256) {
    throw new Error(
      `${moduleDefinition.id}: canonical source does not match its locked hash; ` +
        "run refresh-source-lock.mjs after reviewing the source change",
    );
  }
  if (extractMetadata(source, "version") !== lockedSource.version) {
    throw new Error(
      `${moduleDefinition.id}: canonical source version does not match its lock`,
    );
  }

  return {
    sourcePath: lockedSource.path,
    source,
  };
}

function extractMetadata(source, field) {
  const match = source.match(new RegExp(`^//\\s+@${field}\\s+(.+)$`, "m"));
  if (!match) throw new Error(`Missing @${field} metadata`);
  return match[1].trim();
}

function extractModuleBody(source, sourcePath) {
  const metadataEnd = "// ==/UserScript==";
  const metadataEndIndex = source.indexOf(metadataEnd);
  if (metadataEndIndex === -1) {
    throw new Error(`${sourcePath}: userscript metadata end not found`);
  }

  let body = source.slice(metadataEndIndex + metadataEnd.length).trim();
  const openingPatterns = ["(function () {", "(() => {"];
  const opening = openingPatterns.find((pattern) => body.startsWith(pattern));
  if (!opening) throw new Error(`${sourcePath}: unsupported outer wrapper`);

  body = body.slice(opening.length).trimStart();
  if (!body.endsWith("})();")) {
    throw new Error(`${sourcePath}: unsupported wrapper ending`);
  }

  return body.slice(0, -5).trimEnd();
}

function replaceExactly(source, before, after, description) {
  const firstIndex = source.indexOf(before);
  if (firstIndex === -1) throw new Error(`Missing transform: ${description}`);
  if (source.indexOf(before, firstIndex + before.length) !== -1) {
    throw new Error(`Ambiguous transform: ${description}`);
  }
  return source.slice(0, firstIndex) + after + source.slice(firstIndex + before.length);
}

const simpleEnsureStyles = `  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = buildCss();
    (document.head || document.documentElement).appendChild(style);
  }`;

const scrollEnsureStyles = `  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = buildCss();

    (document.head || document.documentElement).appendChild(style);
  }`;

const playerPreferencesEnsureStyles = `  function ensureStyles() {
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
  }`;

const watchLayoutStyles = `  function ensureStyle() {
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
  }`;

const watchLayoutSidebarCss = [
  '@media (min-width: ${px(CONFIG.queueLayoutBreakpointPx + 1)}) {',
  '  ${TWO_COLUMN_WATCH_FLEXY_SELECTOR}{',
  '    --ytd-watch-flexy-sidebar-width: ${px(CONFIG.sidebarWidthPx)} !important;',
  "  }",
  "}",
].join("\n");

const consolidatedWatchLayoutSidebarCss = [
  '@media (min-width: ${px(CONFIG.queueLayoutBreakpointPx + 1)}) {',
  '  ${WATCH_FLEXY_SELECTOR}{',
  '    --tm-yw-sidebar-width: ${px(CONFIG.sidebarWidthPx)} !important;',
  '    --ytd-watch-flexy-sidebar-width: ${px(CONFIG.sidebarWidthPx)} !important;',
  "  }",
  "",
  '  ${watchFlexyChildSelector("#secondary.ytd-watch-flexy")}{',
  '    flex: 0 0 ${px(CONFIG.sidebarWidthPx)} !important;',
  '    width: ${px(CONFIG.sidebarWidthPx)} !important;',
  '    min-width: ${px(CONFIG.sidebarWidthPx)} !important;',
  '    max-width: ${px(CONFIG.sidebarWidthPx)} !important;',
  "  }",
  "",
  '  ${TWO_COLUMN_WATCH_FLEXY_SELECTORS.map((watchSelector) => `${watchSelector}[${EMPTY_SECONDARY_RAIL_ATTRIBUTE}="1"] #secondary.ytd-watch-flexy`).join(",\\n  ")}{',
  "    flex: 0 0 0 !important;",
  "    width: 0 !important;",
  "    min-width: 0 !important;",
  "    max-width: 0 !important;",
  "  }",
  "}",
].join("\n");

function transformModuleBody(moduleDefinition, body) {
  let transformed = body.replace(
    /\bwindow\s*\.\s*addEventListener\s*\(/g,
    "suite.addWindowListener(",
  );

  if (moduleDefinition.id === "miniplayerButtonRestorer") {
    transformed = replaceExactly(
      transformed,
      simpleEnsureStyles,
      `  function ensureStyles() {
    suite.setStyle("${moduleDefinition.id}", buildCss());
  }`,
      "Miniplayer Button Restorer stylesheet",
    );
  }

  if (moduleDefinition.id === "playerPreferencesLite") {
    transformed = replaceExactly(
      transformed,
      playerPreferencesEnsureStyles,
      `  function ensureStyles() {
    const css = buildCss();
    if (!css.trim()) {
      suite.removeStyle("${moduleDefinition.id}");
      return;
    }

    if (suite.setStyle("${moduleDefinition.id}", css)) {
      schedulePlayerLayoutRefreshAttempts();
    }
  }`,
      "Player Preferences Lite stylesheet",
    );
  }

  if (moduleDefinition.id === "scrollMiniplayer") {
    transformed = replaceExactly(
      transformed,
      scrollEnsureStyles,
      `  function ensureStyles() {
    suite.setStyle("${moduleDefinition.id}", buildCss());
  }`,
      "Scroll Miniplayer stylesheet",
    );
  }

  if (moduleDefinition.id === "watchLayoutCleaner") {
    transformed = replaceExactly(
      transformed,
      watchLayoutStyles,
      `  function ensureStyle() {
    if (!isWatchPath()) {
      removeStyle();
      return;
    }

    suite.setStyle("${moduleDefinition.id}", buildCss());
  }

  function removeStyle() {
    suite.removeStyle("${moduleDefinition.id}");
  }`,
      "Watch Layout Cleaner stylesheet",
    );
    transformed = replaceExactly(
      transformed,
      watchLayoutSidebarCss,
      consolidatedWatchLayoutSidebarCss,
      "SponsorBlock queue width consolidation",
    );
  }

  if (/\bwindow\s*\.\s*addEventListener\s*\(/.test(transformed)) {
    throw new Error(`${moduleDefinition.source}: window listener transform failed`);
  }
  if (
    /\bdocument\s*\.\s*createElement\s*\(\s*["']style["']\s*\)/.test(
      transformed,
    )
  ) {
    throw new Error(`${moduleDefinition.source}: stylesheet transform incomplete`);
  }

  return transformed;
}

function runTransformSelfTests() {
  const checkArguments = parseBuildArguments(["--check"]);
  if (!checkArguments.checkOnly || checkArguments.selfTestMode) {
    throw new Error("Build argument parsing self-test failed");
  }
  for (const invalidArguments of [
    ["--chek"],
    ["--check", "--self-test"],
    ["--check", "--check"],
  ]) {
    let rejected = false;
    try {
      parseBuildArguments(invalidArguments);
    } catch (error) {
      rejected = String(error?.message || error) === BUILD_USAGE;
    }
    if (!rejected) {
      throw new Error(
        `Build argument rejection self-test failed: ${invalidArguments.join(" ")}`,
      );
    }
  }

  const fixtureDefinition = {
    id: "fixture",
    source: "fixture.user.js",
  };
  const transformedListener = transformModuleBody(
    fixtureDefinition,
    'window \n  . addEventListener ( "pageshow", callback );',
  );
  if (
    transformedListener !==
    'suite.addWindowListener( "pageshow", callback );'
  ) {
    throw new Error("Window-listener transform self-test failed");
  }

  let rejectedStyleCreation = false;
  try {
    transformModuleBody(
      fixtureDefinition,
      "const style = document \n  . createElement ( 'style' );",
    );
  } catch (error) {
    rejectedStyleCreation = /stylesheet transform incomplete/.test(
      String(error?.message || error),
    );
  }
  if (!rejectedStyleCreation) {
    throw new Error("Stylesheet residual-guard self-test failed");
  }

  const descendantTarget = { contains: () => false };
  const unrelatedTarget = { contains: () => false };
  const rootTarget = {
    contains: (target) => target === descendantTarget,
  };
  const atomicObserverRegistry = new Set();
  const atomicObserver = {
    active: true,
    generation: 4,
    registrations: new Map([
      [rootTarget, normaliseMutationOptions({ attributes: true })],
    ]),
  };
  atomicObserverRegistry.add(atomicObserver);
  let atomicRefreshes = 0;
  const nextAtomicAttributeFilter = ["class"];
  replaceLogicalMutationRegistrations(
    atomicObserver,
    atomicObserverRegistry,
    [
      [rootTarget, {
        attributes: true,
        attributeFilter: nextAtomicAttributeFilter,
      }],
      [descendantTarget, { childList: true }],
    ],
    () => {
      atomicRefreshes += 1;
    },
  );
  nextAtomicAttributeFilter.push("style");
  if (
    atomicRefreshes !== 1 ||
    !atomicObserver.active ||
    atomicObserver.generation !== 4 ||
    !atomicObserverRegistry.has(atomicObserver) ||
    atomicObserver.registrations.size !== 2 ||
    atomicObserver.registrations
      .get(rootTarget)
      ?.attributeFilter?.join(",") !== "class" ||
    !atomicObserver.registrations.get(descendantTarget)?.childList
  ) {
    throw new Error("Mutation atomic replacement self-test failed");
  }
  const unrestrictedAttributeOptions = normaliseMutationOptions({
    attributes: true,
  });
  const emptyAttributeFilterOptions = normaliseMutationOptions({
    attributes: true,
    attributeFilter: [],
  });
  const orderedAttributeFilterOptions = normaliseMutationOptions({
    attributes: true,
    attributeFilter: ["class", "style", "class"],
  });
  const reorderedAttributeFilterOptions = normaliseMutationOptions({
    attributes: true,
    attributeFilter: ["style", "class"],
  });
  if (
    logicalMutationOptionsEqual(
      unrestrictedAttributeOptions,
      emptyAttributeFilterOptions,
    ) ||
    !logicalMutationOptionsEqual(
      orderedAttributeFilterOptions,
      reorderedAttributeFilterOptions,
    )
  ) {
    throw new Error("Mutation logical option equality self-test failed");
  }
  replaceLogicalMutationRegistrations(
    atomicObserver,
    atomicObserverRegistry,
    [
      [rootTarget, {
        attributes: true,
        attributeFilter: ["class"],
      }],
      [descendantTarget, { childList: true }],
    ],
    () => {
      atomicRefreshes += 1;
    },
  );
  if (atomicRefreshes !== 1 || atomicObserver.generation !== 4) {
    throw new Error("Mutation equivalent replacement self-test failed");
  }

  const rollbackRegistrations = atomicObserver.registrations;
  let replacementFailureCaught = false;
  try {
    replaceLogicalMutationRegistrations(
      atomicObserver,
      atomicObserverRegistry,
      [[unrelatedTarget, { childList: true }]],
      () => {
        throw new Error("simulated native replacement failure");
      },
    );
  } catch (error) {
    replacementFailureCaught =
      error.message === "simulated native replacement failure";
  }
  if (
    !replacementFailureCaught ||
    atomicObserver.registrations !== rollbackRegistrations ||
    !atomicObserver.active ||
    atomicObserver.generation !== 4 ||
    !atomicObserverRegistry.has(atomicObserver)
  ) {
    throw new Error("Mutation replacement rollback self-test failed");
  }

  let pendingRefreshState = true;
  let pendingRefreshFailureCaught = false;
  try {
    refreshImmediatelyPreservingPendingState(
      () => pendingRefreshState,
      (pending) => {
        pendingRefreshState = pending;
      },
      () => {
        pendingRefreshState = false;
        throw new Error("simulated pending refresh failure");
      },
    );
  } catch (error) {
    pendingRefreshFailureCaught =
      error.message === "simulated pending refresh failure";
  }
  if (!pendingRefreshFailureCaught || !pendingRefreshState) {
    throw new Error("Mutation pending refresh rollback self-test failed");
  }

  let invalidReplacementCaught = false;
  try {
    replaceLogicalMutationRegistrations(
      atomicObserver,
      atomicObserverRegistry,
      [[unrelatedTarget, { attributes: false }]],
      () => {
        atomicRefreshes += 1;
      },
    );
  } catch (error) {
    invalidReplacementCaught = error instanceof TypeError;
  }
  if (
    !invalidReplacementCaught ||
    atomicObserver.registrations !== rollbackRegistrations ||
    atomicRefreshes !== 1
  ) {
    throw new Error("Mutation replacement validation self-test failed");
  }

  replaceLogicalMutationRegistrations(
    atomicObserver,
    atomicObserverRegistry,
    [],
    () => {
      atomicRefreshes += 1;
    },
  );
  if (
    atomicRefreshes !== 2 ||
    atomicObserver.active ||
    atomicObserver.generation !== 5 ||
    atomicObserver.registrations.size ||
    atomicObserverRegistry.has(atomicObserver)
  ) {
    throw new Error("Mutation empty replacement self-test failed");
  }

  const replacementOrder = [];
  class FixtureNativeObserver {
    observe() {
      replacementOrder.push("replacement-observe");
    }

    disconnect() {
      replacementOrder.push("replacement-disconnect");
    }
  }
  const fixtureCurrentObserver = {
    takeRecords() {
      replacementOrder.push("current-take-records");
      return ["record"];
    },
    disconnect() {
      replacementOrder.push("current-disconnect");
    },
  };
  const installedReplacement = installReplacementMutationObserver(
    FixtureNativeObserver,
    () => {},
    {
      registrations: new Map([
        [rootTarget, normaliseMutationOptions({ childList: true })],
      ]),
    },
    fixtureCurrentObserver,
    (records) => {
      if (records.join(",") !== "record") {
        throw new Error("Mutation replacement record self-test failed");
      }
      replacementOrder.push("current-records-preserved");
    },
  );
  if (
    !(installedReplacement instanceof FixtureNativeObserver) ||
    replacementOrder.join(",") !==
      "replacement-observe,current-take-records,current-records-preserved,current-disconnect"
  ) {
    throw new Error("Mutation replacement ordering self-test failed");
  }

  const failureOrder = [];
  class FailingFixtureNativeObserver {
    observe() {
      failureOrder.push("replacement-observe");
      throw new Error("simulated observe failure");
    }

    disconnect() {
      failureOrder.push("replacement-disconnect");
    }
  }
  let nativeReplacementFailureCaught = false;
  try {
    installReplacementMutationObserver(
      FailingFixtureNativeObserver,
      () => {},
      {
        registrations: new Map([
          [rootTarget, normaliseMutationOptions({ childList: true })],
        ]),
      },
      fixtureCurrentObserver,
      () => {
        failureOrder.push("current-records-preserved");
      },
    );
  } catch (error) {
    nativeReplacementFailureCaught = error.message === "simulated observe failure";
  }
  if (
    !nativeReplacementFailureCaught ||
    failureOrder.join(",") !==
      "replacement-observe,replacement-disconnect"
  ) {
    throw new Error("Mutation replacement failure-order self-test failed");
  }


  const preservationFailureOrder = [];
  class PreservationFailureFixtureNativeObserver {
    observe() {
      preservationFailureOrder.push("replacement-observe");
    }

    disconnect() {
      preservationFailureOrder.push("replacement-disconnect");
    }
  }
  let preservationFailureCaught = false;
  try {
    installReplacementMutationObserver(
      PreservationFailureFixtureNativeObserver,
      () => {},
      {
        registrations: new Map([
          [rootTarget, normaliseMutationOptions({ childList: true })],
        ]),
      },
      {
        takeRecords() {
          preservationFailureOrder.push("current-take-records");
          return ["record"];
        },
        disconnect() {
          preservationFailureOrder.push("current-disconnect");
        },
      },
      () => {
        preservationFailureOrder.push("current-preserve-failed");
        throw new Error("simulated preservation failure");
      },
    );
  } catch (error) {
    preservationFailureCaught =
      error.message === "simulated preservation failure";
  }
  if (
    !preservationFailureCaught ||
    preservationFailureOrder.join(",") !==
      "replacement-observe,current-take-records,current-preserve-failed,replacement-disconnect"
  ) {
    throw new Error("Mutation preservation rollback self-test failed");
  }

  const broadOptions = {
    attributes: true,
    childList: true,
    characterData: true,
    subtree: true,
  };
  const broadCoverage = {
    registrations: new Map([
      [rootTarget, broadOptions],
      [descendantTarget, broadOptions],
    ]),
  };
  const equivalentCoverage = {
    registrations: new Map([
      [rootTarget, { ...broadOptions }],
      [descendantTarget, { ...broadOptions }],
    ]),
  };
  const narrowerCoverage = {
    registrations: new Map([
      [rootTarget, {
        attributes: true,
        attributeFilter: ["class", "style"],
        childList: true,
        characterData: false,
        subtree: true,
      }],
    ]),
  };
  if (!mutationCoverageCovers(broadCoverage, equivalentCoverage)) {
    throw new Error("Mutation equivalent coverage self-test failed");
  }
  if (
    mutationCoverageCovers(broadCoverage, {
      registrations: new Map([[rootTarget, broadOptions]]),
    })
  ) {
    throw new Error("Mutation target shrink self-test failed");
  }
  if (mutationCoverageCovers(broadCoverage, narrowerCoverage)) {
    throw new Error("Mutation coverage shrink self-test failed");
  }
  if (
    mutationCoverageCovers(
      {
        registrations: new Map([
          [rootTarget, {
            attributes: true,
            attributeFilter: ["class"],
            childList: true,
            characterData: false,
            subtree: true,
          }],
        ]),
      },
      narrowerCoverage,
    )
  ) {
    throw new Error("Mutation attribute expansion self-test failed");
  }
  if (
    mutationCoverageCovers(broadCoverage, {
      registrations: new Map([
        [unrelatedTarget, narrowerCoverage.registrations.get(rootTarget)],
      ]),
    })
  ) {
    throw new Error("Mutation target expansion self-test failed");
  }

  const registrations = new Map();
  const rootAttributeFilter = ["class"];
  setLogicalMutationRegistration(registrations, rootTarget, {
    attributes: true,
    attributeFilter: rootAttributeFilter,
    subtree: true,
  });
  setLogicalMutationRegistration(registrations, descendantTarget, {
    childList: true,
  });
  rootAttributeFilter.push("style");
  if (
    registrations.size !== 2 ||
    registrations.get(rootTarget)?.attributeFilter?.join(",") !== "class" ||
    !registrations.get(descendantTarget)?.childList
  ) {
    throw new Error("Mutation multi-target registration self-test failed");
  }
  if (
    !mutationMatchesRegistrations(
      registrations,
      {
        type: "attributes",
        target: descendantTarget,
        attributeName: "class",
      },
      "data-runtime-errors",
    ) ||
    !mutationMatchesRegistrations(
      registrations,
      { type: "childList", target: descendantTarget },
      "data-runtime-errors",
    ) ||
    mutationMatchesRegistrations(
      registrations,
      {
        type: "attributes",
        target: descendantTarget,
        attributeName: "style",
      },
      "data-runtime-errors",
    )
  ) {
    throw new Error("Mutation per-target filtering self-test failed");
  }

  const replacementAttributeFilter = ["style"];
  setLogicalMutationRegistration(registrations, rootTarget, {
    attributes: true,
    attributeFilter: replacementAttributeFilter,
    subtree: true,
  });
  replacementAttributeFilter.push("title");
  if (
    registrations.size !== 2 ||
    registrations.get(rootTarget)?.attributeFilter?.join(",") !== "style" ||
    !registrations.get(descendantTarget)?.childList ||
    mutationMatchesRegistrations(
      registrations,
      {
        type: "attributes",
        target: descendantTarget,
        attributeName: "class",
      },
      "data-runtime-errors",
    ) ||
    !mutationMatchesRegistrations(
      registrations,
      {
        type: "attributes",
        target: descendantTarget,
        attributeName: "style",
      },
      "data-runtime-errors",
    )
  ) {
    throw new Error("Mutation target option-update self-test failed");
  }

  const registrationCoverage = buildMutationCoverage([
    { registrations },
  ]);
  const rootCoverageOptions = registrationCoverage.registrations.get(rootTarget);
  const descendantCoverageOptions =
    registrationCoverage.registrations.get(descendantTarget);
  if (
    registrationCoverage.registrations.size !== 2 ||
    !rootCoverageOptions?.attributes ||
    rootCoverageOptions.childList ||
    !rootCoverageOptions.subtree ||
    rootCoverageOptions.attributeFilter?.join(",") !== "style" ||
    descendantCoverageOptions?.attributes ||
    !descendantCoverageOptions?.childList ||
    descendantCoverageOptions.subtree
  ) {
    throw new Error("Mutation multi-target coverage self-test failed");
  }

  const mergedExactTargetCoverage = buildMutationCoverage([
    {
      registrations: new Map([
        [rootTarget, {
          attributes: true,
          attributeFilter: ["class"],
          subtree: true,
        }],
      ]),
    },
    {
      registrations: new Map([
        [rootTarget, {
          attributes: true,
          attributeFilter: ["style"],
          childList: true,
        }],
      ]),
    },
  ]);
  const mergedExactTargetOptions =
    mergedExactTargetCoverage.registrations.get(rootTarget);
  if (
    mergedExactTargetCoverage.registrations.size !== 1 ||
    !mergedExactTargetOptions?.attributes ||
    !mergedExactTargetOptions?.childList ||
    !mergedExactTargetOptions?.subtree ||
    mergedExactTargetOptions.attributeFilter?.join(",") !== "class,style"
  ) {
    throw new Error("Mutation exact-target option merge self-test failed");
  }

  const unfilteredExactTargetCoverage = buildMutationCoverage([
    {
      registrations: new Map([
        [rootTarget, {
          attributes: true,
          attributeFilter: ["class"],
        }],
      ]),
    },
    {
      registrations: new Map([[rootTarget, { attributes: true }]]),
    },
  ]);
  if (
    "attributeFilter" in
    unfilteredExactTargetCoverage.registrations.get(rootTarget)
  ) {
    throw new Error("Mutation unrestricted attribute merge self-test failed");
  }

  const registrationSnapshot =
    cloneLogicalMutationRegistrations(registrations);
  registrations.get(rootTarget).attributeFilter.push("class");
  if (
    registrationSnapshot.get(rootTarget)?.attributeFilter?.join(",") !==
    "style"
  ) {
    throw new Error("Mutation registration snapshot self-test failed");
  }
  clearLogicalMutationRegistrations(registrations);
  if (registrations.size || registrationSnapshot.size !== 2) {
    throw new Error("Mutation registration disconnect self-test failed");
  }

  const observerRegistry = new Set();
  const logicalObserver = {};
  setSharedMutationObserverRegistryState(
    observerRegistry,
    logicalObserver,
    true,
  );
  if (
    observerRegistry.size !== 1 ||
    !observerRegistry.has(logicalObserver)
  ) {
    throw new Error("Mutation observer registration self-test failed");
  }
  setSharedMutationObserverRegistryState(
    observerRegistry,
    logicalObserver,
    false,
  );
  if (observerRegistry.size || observerRegistry.has(logicalObserver)) {
    throw new Error("Mutation observer release self-test failed");
  }
  setSharedMutationObserverRegistryState(
    observerRegistry,
    logicalObserver,
    true,
  );
  if (
    observerRegistry.size !== 1 ||
    !observerRegistry.has(logicalObserver)
  ) {
    throw new Error("Mutation observer re-registration self-test failed");
  }
  setSharedMutationObserverRegistryState(
    observerRegistry,
    logicalObserver,
    false,
  );
  if (observerRegistry.size || observerRegistry.has(logicalObserver)) {
    throw new Error("Mutation observer final release self-test failed");
  }

  const impliedAttributeOptions = normaliseMutationOptions({
    attributeFilter: ["class"],
  });
  if (
    !impliedAttributeOptions.attributes ||
    impliedAttributeOptions.attributeFilter.join(",") !== "class"
  ) {
    throw new Error("Mutation option normalisation self-test failed");
  }
  let rejectedInvalidMutationOptions = false;
  try {
    normaliseMutationOptions({
      attributes: false,
      attributeFilter: [],
      childList: true,
    });
  } catch (error) {
    rejectedInvalidMutationOptions = error instanceof TypeError;
  }
  if (!rejectedInvalidMutationOptions) {
    throw new Error("Mutation option validation self-test failed");
  }

  console.log("Verified build transform safeguards");
}

if (selfTestMode) {
  runTransformSelfTests();
  process.exit(0);
}

const sourceModules = await Promise.all(
  modules.map(async (moduleDefinition) => {
    const { sourcePath, source } = await readModuleSource(moduleDefinition);
    const canonicalDefinition = {
      ...moduleDefinition,
      source: sourcePath,
    };
    const body = transformModuleBody(
      canonicalDefinition,
      extractModuleBody(source, sourcePath),
    );

    return {
      ...canonicalDefinition,
      version: extractMetadata(source, "version"),
      body,
    };
  }),
);

const moduleSwitches = sourceModules
  .map(({ id }) => `    ${id}: true,`)
  .join("\n");

const moduleInitialisers = sourceModules
  .map(
    ({ id, label, phase, version, body }) => `
  suite.registerModule(
    ${JSON.stringify(id)},
    ${JSON.stringify(`${label} v${version}`)},
    ${JSON.stringify(phase)},
    () => {
      const MutationObserver = suite.SharedMutationObserver;
      const GM_addStyle = (css) => suite.setStyle(${JSON.stringify(id)}, css);

${body
  .split("\n")
  .map((line) => (line ? `      ${line}` : ""))
  .join("\n")}
    },
  );`,
  )
  .join("\n");

const runtimeMutationCoverageHelpers = [
  mutationOptionsCover,
  mergeMutationOptions,
  mutationCoverageCovers,
  normaliseMutationOptions,
  setLogicalMutationRegistration,
  clearLogicalMutationRegistrations,
  setSharedMutationObserverRegistryState,
  logicalMutationOptionsEqual,
  logicalMutationRegistrationsEqual,
  refreshImmediatelyPreservingPendingState,
  replaceLogicalMutationRegistrations,
  installReplacementMutationObserver,
  cloneLogicalMutationRegistrations,
  mutationMatchesRegistrations,
  buildMutationCoverage,
]
  .map((helper) =>
    helper
      .toString()
      .split("\n")
      .map((line) => (line ? `  ${line}` : ""))
      .join("\n"),
  )
  .join("\n\n");

const output = `// ==UserScript==
// @name         YouTube Master Suite
// @namespace    Citizen.youtube.master-suite
// @version      ${MASTER_VERSION}
// @description  Consolidates Citizen YouTube userscripts with shared SPA event, mutation-observer, and stylesheet infrastructure.
// @author       Citizen
// @license      GNU GPLv3
// @homepageURL  https://github.com/noswimmingplease/youtube-master-suite
// @supportURL   https://github.com/noswimmingplease/youtube-master-suite/issues
// @updateURL    https://raw.githubusercontent.com/noswimmingplease/youtube-master-suite/main/youtube-master-suite.user.js
// @downloadURL  https://raw.githubusercontent.com/noswimmingplease/youtube-master-suite/main/youtube-master-suite.user.js
// @match        https://www.youtube.com/*
// @run-at       document-start
// @grant        none
// @noframes
// ==/UserScript==

(() => {
  "use strict";

  const MASTER_VERSION = ${JSON.stringify(MASTER_VERSION)};
  const EXPECTED_MODULE_COUNT = ${sourceModules.length};
  const HEALTH_ATTRIBUTE = "data-yt-master-suite";
  const ENABLED_MODULES = Object.freeze({
${moduleSwitches}
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
${sourceModules.map(({ id }) => `    ${JSON.stringify(id)},`).join("\n")}
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

${runtimeMutationCoverageHelpers}

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
      \`[YouTube Master Suite] [\${ownerId}] \${label} failed\`,
      error,
    );
    recordRuntimeError(ownerId, label, error);
  }

  function now() {
    return globalThis.performance?.now?.() ?? Date.now();
  }

  function recordDiagnosticMeasurement(moduleId, operation, units, elapsedMs) {
    const key = \`\${moduleId}:\${operation}\`;
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
            runWithDiagnostics(ownerId, \`event:\${type}\`, 1, () =>
              invokeEventListener(listener, event),
            )
        : listener;
      globalThis.addEventListener(type, registeredListener, options);
      return;
    }

    const capture = getCapture(options);
    const key = \`\${type}|\${capture ? "capture" : "bubble"}\`;
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
                  \`event:\${type}\`,
                  1,
                  () => invokeEventListener(registeredListener.listener, event),
                );
              } catch (error) {
                reportModuleError(
                  registeredListener.ownerId,
                  \`\${type} event listener\`,
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
                \`\${type} batch finalisation\`,
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
      .map((id) => \`/* \${id} */\\n\${styleParts.get(id)}\`)
      .join("\\n\\n");
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
      throw new Error(\`Unknown module registration: \${id}\`);
    }
    if (registeredModuleIds.has(id)) {
      throw new Error(\`Duplicate module registration: \${id}\`);
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
${moduleInitialisers}

  if (!publishHealthMarker()) {
    document.addEventListener("readystatechange", publishHealthMarker, {
      once: true,
    });
  }
  startIdleModules();
})();
`;

const releaseManifest = `${JSON.stringify(
  {
    schemaVersion: 1,
    name: "YouTube Master Suite",
    version: MASTER_VERSION,
    source: "youtube-master-suite.user.js",
    sha256: sha256(output),
    bytes: Buffer.byteLength(output, "utf8"),
    characters: output.length,
    registeredModules: sourceModules.length,
  },
  null,
  2,
)}\n`;

if (checkOnly) {
  const existingOutput = readFileSync(outputPath, "utf8");
  if (existingOutput !== output) {
    throw new Error(
      `${outputPath} is stale; run node build-master.mjs before publishing`,
    );
  }
  const existingReleaseManifest = readFileSync(releaseManifestPath, "utf8");
  if (existingReleaseManifest !== releaseManifest) {
    throw new Error(
      `${releaseManifestPath} is stale; run node build-master.mjs before publishing`,
    );
  }
  console.log(`Verified ${outputPath}`);
} else {
  writeFileSync(outputPath, output, "utf8");
  writeFileSync(releaseManifestPath, releaseManifest, "utf8");
  console.log(`Wrote ${outputPath}`);
  console.log(`Wrote ${releaseManifestPath}`);
}
console.log(`SHA-256 ${sha256(output)}`);
