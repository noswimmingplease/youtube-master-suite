import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const suiteDirectory = dirname(fileURLToPath(import.meta.url));
const userscriptPath = join(suiteDirectory, "youtube-master-suite.user.js");
const manualCopyPath = join(suiteDirectory, "youtube-master-suite.txt");
const releaseManifestPath = join(suiteDirectory, "release-manifest.json");
const sourceLockPath = join(suiteDirectory, "sources.lock.json");

const VERIFY_USAGE =
  "Usage: node verify-master.mjs [--release] [--base <git-ref>] | --self-test";

function parseVerifyArguments(arguments_) {
  let releaseMode = false;
  let selfTestMode = false;
  let explicitBaseRef = null;

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--release") {
      if (releaseMode) throw new Error(VERIFY_USAGE);
      releaseMode = true;
      continue;
    }
    if (argument === "--self-test") {
      if (selfTestMode) throw new Error(VERIFY_USAGE);
      selfTestMode = true;
      continue;
    }
    if (argument === "--base") {
      if (explicitBaseRef !== null) throw new Error(VERIFY_USAGE);
      const baseRef = arguments_[index + 1];
      if (!baseRef || baseRef.startsWith("-")) {
        throw new Error(VERIFY_USAGE);
      }
      explicitBaseRef = baseRef;
      index += 1;
      continue;
    }
    throw new Error(VERIFY_USAGE);
  }

  if (selfTestMode && (releaseMode || explicitBaseRef !== null)) {
    throw new Error("--self-test cannot be combined with other verification modes");
  }

  return { explicitBaseRef, releaseMode, selfTestMode };
}

const { explicitBaseRef, releaseMode, selfTestMode } = parseVerifyArguments(
  process.argv.slice(2),
);

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: suiteDirectory,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  }).trim();
}

function git(repositoryPath, ...args) {
  return run("git", ["-C", repositoryPath, ...args]);
}

function metadata(source, field) {
  const match = source.match(new RegExp(`^//\\s+@${field}\\s+(.+)$`, "m"));
  assert(match, `Missing @${field} metadata`);
  return match[1].trim();
}

function occurrences(source, value) {
  return source.split(value).length - 1;
}

function compareDottedVersions(left, right) {
  assert.match(left, /^\d+(?:\.\d+)+$/, `Invalid dotted version: ${left}`);
  assert.match(right, /^\d+(?:\.\d+)+$/, `Invalid dotted version: ${right}`);
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  assert(
    [...leftParts, ...rightParts].every(Number.isSafeInteger),
    "Dotted version components must be safe integers",
  );
  const partCount = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < partCount; index += 1) {
    const difference = (leftParts[index] || 0) - (rightParts[index] || 0);
    if (difference) return difference;
  }
  return 0;
}

function compareVersions(left, right) {
  assert.match(left, /^\d+\.\d+\.\d+$/, `Invalid version: ${left}`);
  assert.match(right, /^\d+\.\d+\.\d+$/, `Invalid version: ${right}`);
  return compareDottedVersions(left, right);
}

function assertChangedModuleVersionsIncreased(
  currentSourceLock,
  comparisonSourceLock,
  comparisonRef,
) {
  const currentModules = currentSourceLock.modules || {};
  const comparisonModules = comparisonSourceLock.modules || {};
  for (const [moduleId, currentModule] of Object.entries(currentModules)) {
    const comparisonModule = comparisonModules[moduleId];
    if (!comparisonModule || currentModule.sha256 === comparisonModule.sha256) {
      continue;
    }
    assert(
      compareDottedVersions(currentModule.version, comparisonModule.version) > 0,
      `${moduleId}: source changes since ${comparisonRef} require a component version increase ` +
        `(comparison ${comparisonModule.version}, current ${currentModule.version})`,
    );
  }
}

function assertReleaseVersionAboveStableTags(currentVersion, stableTags) {
  const currentTag = `v${currentVersion}`;
  for (const tag of stableTags) {
    assert.match(tag, /^v\d+\.\d+\.\d+$/, `Invalid stable version tag: ${tag}`);
    if (tag === currentTag) continue;
    assert(
      compareVersions(currentVersion, tag.slice(1)) > 0,
      `Release version ${currentVersion} must be greater than stable tag ${tag}`,
    );
  }
}

function runSelfTests() {
  assert.deepEqual(
    parseVerifyArguments(["--release", "--base", "HEAD^"]),
    {
      explicitBaseRef: "HEAD^",
      releaseMode: true,
      selfTestMode: false,
    },
  );
  assert.throws(
    () => parseVerifyArguments(["--relase"]),
    /Usage: node verify-master\.mjs/,
  );
  assert.throws(
    () => parseVerifyArguments(["--release", "--self-test"]),
    /cannot be combined/,
  );
  assert.throws(
    () => parseVerifyArguments(["--base"]),
    /Usage: node verify-master\.mjs/,
  );

  assert(compareVersions("1.10.0", "1.9.9") > 0);
  assert(compareVersions("2.0.0", "2.0.1") < 0);
  assert.equal(compareVersions("3.4.5", "3.4.5"), 0);
  assert.doesNotThrow(() =>
    assertReleaseVersionAboveStableTags("1.2.0", ["v1.0.0", "v1.1.9"]),
  );
  assert.throws(
    () => assertReleaseVersionAboveStableTags("1.2.0", ["v1.3.0"]),
    /must be greater than stable tag/,
  );
  const comparisonSourceLock = {
    modules: {
      fixture: { version: "1.9", sha256: "a".repeat(64) },
    },
  };
  assert.doesNotThrow(() =>
    assertChangedModuleVersionsIncreased(
      {
        modules: {
          fixture: { version: "1.10", sha256: "b".repeat(64) },
        },
      },
      comparisonSourceLock,
      "fixture-base",
    ),
  );
  assert.throws(
    () =>
      assertChangedModuleVersionsIncreased(
        {
          modules: {
            fixture: { version: "1.9", sha256: "b".repeat(64) },
          },
        },
        comparisonSourceLock,
        "fixture-base",
      ),
    /require a component version increase/,
  );
  console.log("Verified master-version comparison safeguards");
}

if (selfTestMode) {
  runSelfTests();
  process.exit(0);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function verifySharedRuntimeContracts(moduleId, source) {
  const observerNames = [
    ...source.matchAll(
      /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*new\s+MutationObserver\s*\(/g,
    ),
  ].map((match) => match[1]);
  for (const observerName of observerNames) {
    const escapedName = escapeRegExp(observerName);
    assert(
      !new RegExp(`\\b${escapedName}\\.takeRecords\\s*\\(`).test(source),
      `${moduleId}: shared MutationObserver ${observerName} uses takeRecords()`,
    );
  }

  const sharedWindowEvents = [
    "pageshow",
    "yt-navigate-finish",
    "yt-navigate-start",
    "yt-page-data-updated",
  ];
  for (const eventName of sharedWindowEvents) {
    const unsupportedListenerOptions = new RegExp(
      `window\\.addEventListener\\(\\s*["']${escapeRegExp(eventName)}["']` +
        `[\\s\\S]{0,500}?\\b(?:once|signal)\\s*:`,
    );
    assert(
      !unsupportedListenerOptions.test(source),
      `${moduleId}: shared ${eventName} listener uses once or signal`,
    );
  }
}

run(process.execPath, ["build-master.mjs", "--check"]);
run(process.execPath, ["--test", "tests/navigation-guards.test.mjs"]);
run(process.execPath, ["--check", userscriptPath]);

const userscript = readFileSync(userscriptPath, "utf8");
const releaseManifest = JSON.parse(
  readFileSync(releaseManifestPath, "utf8"),
);
const sourceLock = JSON.parse(readFileSync(sourceLockPath, "utf8"));
const buildSource = readFileSync(
  join(suiteDirectory, "build-master.mjs"),
  "utf8",
);
const refreshSourceLockSource = readFileSync(
  join(suiteDirectory, "refresh-source-lock.mjs"),
  "utf8",
);
const installedVerifierSource = readFileSync(
  join(suiteDirectory, "verify-installed-master.mjs"),
  "utf8",
);
const workflowSource = readFileSync(
  join(suiteDirectory, ".github", "workflows", "verify.yml"),
  "utf8",
);
const expectedUrl =
  "https://raw.githubusercontent.com/Ci303/youtube-master-suite/main/" +
  "youtube-master-suite.user.js";

assert.equal(metadata(userscript, "updateURL"), expectedUrl);
assert.equal(metadata(userscript, "downloadURL"), expectedUrl);
assert.equal(metadata(userscript, "name"), "YouTube Master Suite");
assert.match(metadata(userscript, "version"), /^\d+\.\d+\.\d+$/);
assert.equal(sourceLock.schemaVersion, 2);
const lockedModules = Object.entries(sourceLock.modules || {});
const expectedModuleCount = lockedModules.length;
assert(expectedModuleCount > 0, "The source lock must contain canonical modules");
const lockedSourcePaths = lockedModules.map(
  ([, lockedSource]) => lockedSource.path,
);
assert.equal(
  new Set(lockedSourcePaths).size,
  lockedSourcePaths.length,
  "The source lock contains duplicate canonical source paths",
);
const canonicalSourcePaths = readdirSync(
  join(suiteDirectory, "sources", "modules"),
  { withFileTypes: true },
)
  .filter((entry) => entry.isFile() && entry.name.endsWith(".user.js"))
  .map((entry) => `sources/modules/${entry.name}`)
  .sort();
assert.deepEqual(
  [...lockedSourcePaths].sort(),
  canonicalSourcePaths,
  "Source lock and canonical module directory differ",
);
assert.equal(
  occurrences(userscript, "suite.registerModule("),
  expectedModuleCount,
  "The generated master module count differs from the source lock",
);

assert(
  buildSource.includes(
    String.raw`/\bwindow\s*\.\s*addEventListener\s*\(/g`,
  ),
  "The window-listener transform must tolerate whitespace",
);
assert(
  buildSource.includes(
    String.raw`/\bdocument\s*\.\s*createElement\s*\(\s*["']style["']\s*\)/`,
  ),
  "The stylesheet residual guard must tolerate whitespace and quote variants",
);
assert(
  buildSource.includes("runTransformSelfTests();"),
  "The build transform safeguards must have an executable self-test",
);
assert(
  refreshSourceLockSource.includes(
    "assertVersionIncreaseForChangedSource(",
  ),
  "Source-lock refreshes must require a version increase for changed content",
);
assert(
  installedVerifierSource.includes(
    "Installed-source corruption must be rejected",
  ),
  "The installed-source verifier must exercise its corruption guard",
);
assert.match(
  workflowSource,
  /base_ref="HEAD\^"/,
  "CI must compare against HEAD^ when its event base SHA is empty or zero",
);

const canonicalSources = new Map();
for (const [moduleId, lockedSource] of lockedModules) {
  assert.match(
    lockedSource.path,
    /^sources\/modules\/[a-z0-9-]+\.user\.js$/,
  );
  assert.match(lockedSource.version, /^\d+(?:\.\d+)+$/);
  assert.match(lockedSource.sha256, /^[0-9a-f]{64}$/);
  const canonicalSource = readFileSync(
    join(suiteDirectory, lockedSource.path),
    "utf8",
  ).replace(/\r\n/g, "\n");
  canonicalSources.set(moduleId, canonicalSource);
  verifySharedRuntimeContracts(moduleId, canonicalSource);
  assert.equal(
    metadata(canonicalSource, "version"),
    lockedSource.version,
    `${moduleId}: canonical source version differs from the source lock`,
  );
  assert.equal(
    createHash("sha256").update(canonicalSource).digest("hex"),
    lockedSource.sha256,
    `${moduleId}: canonical source differs from the source lock`,
  );
  assert.match(
    userscript,
    new RegExp(
      `suite\\.registerModule\\(\\s+${JSON.stringify(moduleId).replace(
        /[.*+?^${}()|[\]\\]/g,
        "\\$&",
      )},`,
    ),
    `${moduleId}: generated module registration is missing`,
  );
}

assert(
  !existsSync(
    join(suiteDirectory, "sources/youtube-sponsorblock-queue-width.user.js"),
  ),
  "The vestigial SponsorBlock Queue Width source must not be restored",
);
assert(
  !userscript.includes("SponsorBlock Queue Width (folded"),
  "The generated userscript must not mention the vestigial module",
);
assert(
  userscript.includes("sidebarWidthPx: 374"),
  "Watch Layout Cleaner must retain the SponsorBlock-friendly 374px width",
);
const watchLayoutSource = canonicalSources.get("watchLayoutCleaner") || "";
for (const watchLayoutRequirement of [
  '"ytd-playlist-panel-renderer"',
  '"yt-playlist-panel-renderer"',
  'const EMPTY_SECONDARY_RAIL_ATTRIBUTE = "data-ywlc-empty-secondary-rail"',
  "function reconcileSecondaryRailState()",
  "function getRailMutationTargets()",
  'const secondary = watchFlexy.querySelector("#secondary")',
  "targets.add(secondary || watchFlexy);",
  "if (secondary?.parentElement)",
  "function isSecondaryRailMutationAnchor(target)",
  "function refreshRailMutationObserver()",
  "replaceObserverRegistrations(railMutationObserver, registrations);",
  "const DISCOVERY_MUTATION_ATTRIBUTES = [",
  "const SURFACE_STATE_MUTATION_ATTRIBUTES = [",
  "const railIsEmpty =",
  "eligible && relatedHidden && !chatVisible && !queueVisible",
]) {
  assert(
    watchLayoutSource.includes(watchLayoutRequirement),
    `Missing Watch Layout lifecycle requirement: ${watchLayoutRequirement}`,
  );
}
for (const watchedSurfaceAttribute of [
  '"aria-hidden"',
  '"aria-current"',
  '"aria-selected"',
  '"class"',
  '"collapsed"',
  '"hidden"',
  '"selected"',
  '"style"',
]) {
  assert(
    watchLayoutSource.includes(watchedSurfaceAttribute),
    `Watch Layout must react to rail state attribute: ${watchedSurfaceAttribute}`,
  );
}
for (const emptyRailMasterRequirement of [
  '${watchSelector}[${EMPTY_SECONDARY_RAIL_ATTRIBUTE}="1"] #secondary.ytd-watch-flexy',
  '"    flex: 0 0 0 !important;"',
  '"    width: 0 !important;"',
  '"    min-width: 0 !important;"',
  '"    max-width: 0 !important;"',
]) {
  assert(
    buildSource.includes(emptyRailMasterRequirement),
    `Generated master must preserve empty-rail collapse: ${emptyRailMasterRequirement}`,
  );
}
assert(
  !userscript.includes("'ytd-masthead #center'"),
  "Feed UI Cleaner must preserve the masthead search area",
);
const feedUiCleanerSource = canonicalSources.get("feedUiCleaner") || "";
for (const feedFilteringRequirement of [
  "const FILTER_REVEAL_ATTRIBUTE = 'data-yt-master-show-filtered'",
  "const PERMANENT_HIDDEN_FLAG = 'data-clean-up-youtube-permanent-hidden'",
  "const OUTER_CONTAINER_SELECTORS = [",
  "const INNER_CONTAINER_SELECTORS = [",
  "function reconcileFilteredCards(root = document)",
  "function resetTemporaryReveal()",
  "function syncMutationObservation()",
  "function stopMutationObservation()",
  "window.addEventListener('pagehide'",
  "location.pathname === '/results'",
  '!container.closest(`[${PERMANENT_HIDDEN_FLAG}="1"]`)',
]) {
  assert(
    feedUiCleanerSource.includes(feedFilteringRequirement),
    `Missing Feed UI Cleaner filtering requirement: ${feedFilteringRequirement}`,
  );
}
assert(
  !feedUiCleanerSource.includes("GROUP_CONTAINER_SELECTORS"),
  "Feed filtering must not fall back to hiding a whole shelf or collection",
);
assert.match(
  feedUiCleanerSource,
  /function getCardContainer\(el\) \{[\s\S]{0,220}?closest\?\.\(OUTER_CONTAINER_SELECTORS\)[\s\S]{0,120}?closest\?\.\(INNER_CONTAINER_SELECTORS\)[\s\S]{0,80}?null/,
  "Feed filtering must prefer a genuine outer card, then a modern inner card",
);
assert(
  !feedUiCleanerSource.includes("container.style.setProperty('display'"),
  "Feed UI Cleaner must not share inline display ownership with another module",
);
assert.match(
  userscript,
  /const mo = new MutationObserver\(\(muts\) => \{\s+if \(isButtonInstalled\(\)\) return;/,
  "Miniplayer Button Restorer must skip redundant mutation work once installed",
);

const miniplayerButtonSource =
  canonicalSources.get("miniplayerButtonRestorer") || "";
for (const miniplayerButtonRequirement of [
  'const PLAYER_SELECTORS = ["#movie_player", ".html5-video-player"]',
  "let installedButton = null;",
  "player.querySelectorAll(NATIVE_MINIPLAYER_BUTTON_SELECTOR)",
  "function getActiveWatchFlexy() {",
  "clearInstallAttempts();",
  "m.removedNodes && m.removedNodes.length",
  'window.addEventListener("pagehide"',
  'window.addEventListener("pageshow", onNavigate);',
]) {
  assert(
    miniplayerButtonSource.includes(miniplayerButtonRequirement),
    `Missing Miniplayer Button Restorer lifecycle requirement: ${miniplayerButtonRequirement}`,
  );
}
for (const countAlignmentRequirement of [
  ":is(#segmented-like-button, #segmented-dislike-button)",
  "align-self: center !important;",
  "line-height: 24px !important;",
  "vertical-align: middle !important;",
]) {
  assert(
    userscript.includes(countAlignmentRequirement),
    `Missing like/dislike count alignment requirement: ${countAlignmentRequirement}`,
  );
}
assert(
  userscript.includes("--tm-yw-sidebar-width: ${px(CONFIG.sidebarWidthPx)}"),
  "The consolidated SponsorBlock queue-width variable is missing",
);
assert(
  userscript.includes("flex: 0 0 ${px(CONFIG.sidebarWidthPx)} !important"),
  "The consolidated fixed-width right-rail rule is missing",
);

assert.equal(
  occurrences(userscript, "new NativeObserver(callback)"),
  1,
  "The master must retain exactly one native MutationObserver construction site",
);
assert.equal(
  occurrences(userscript, 'styleElement = document.createElement("style")'),
  1,
  "The master must create exactly one shared stylesheet element",
);

assert(
  userscript.includes('location.pathname === "/feed/history"'),
  "History route exclusion is missing",
);
assert(
  userscript.includes('[data-ytppl-watched-hidden="1"]'),
  "History stale-marker cleanup is missing",
);
for (const staleCommentRequirement of [
  'const STALE_COMMENTS_ATTRIBUTE = "data-iow-stale-video"',
  'const COMMENT_PERMALINK_LINK_SELECTOR =',
  'link.closest?.("#published-time-text")',
  "markCurrentCommentsStale();",
  'attributeFilter: ["href", "video-id"]',
]) {
  assert(
    userscript.includes(staleCommentRequirement),
    `Missing stale-comment guard requirement: ${staleCommentRequirement}`,
  );
}
const commentCleanerSource = canonicalSources.get("commentCleaner") || "";
const playerPreferencesSource =
  canonicalSources.get("playerPreferencesLite") || "";
for (const captionThemeRequirement of [
  "useReadableYellowCaptions: true",
  "function buildCaptionCss()",
  ".html5-video-player .ytp-caption-segment",
  "ytd-video-preview .ytp-caption-segment",
  "color: #ffe36e !important;",
  "0 2px 4px #000 !important;",
  "buildCaptionCss(),",
]) {
  assert(
    playerPreferencesSource.includes(captionThemeRequirement),
    `Missing readable-caption requirement: ${captionThemeRequirement}`,
  );
}
const captionCssBuilder = playerPreferencesSource.match(
  /function buildCaptionCss\(\) \{([\s\S]*?)\n  \}\n\n  function buildShortsCss\(\)/,
)?.[1] || "";
assert(captionCssBuilder, "Missing readable-caption CSS builder body");
const captionCssTemplate = captionCssBuilder.match(
  /return `([\s\S]*?)`;/,
)?.[1] || "";
assert(captionCssTemplate, "Missing readable-caption CSS template");
const captionDeclarationNames = [
  ...captionCssTemplate.matchAll(/^\s*([a-z][a-z-]*)\s*:/gim),
].map((match) => match[1].toLowerCase());
assert.deepEqual(
  captionDeclarationNames,
  ["color", "text-shadow"],
  "Caption theme may declare only colour and text shadow",
);
for (const commentGuardRequirement of [
  "const COMMENTS_VIDEO_GUARD_CHECK_DELAYS_MS = [600, 1600, 3200, 6400]",
  "let preNavigationCommentNodes = new Set();",
  "const pendingStaleCommentContainers = new Set();",
  "const destinationVideoIdentityIsCoherent = (destinationVideoId) => {",
  "const getCommentsVideoIds = (comments) => {",
  "const alignCommentsVideoGuardToCurrentUrl = () => {",
  "preNavigationCommentNodesAreDetached(comments)",
  "preNavigationCommentNodesMatchDestination(",
  "commentsVideoGuardTrackedVideoId = getCurrentVideoId();",
  'document.querySelectorAll(\'[id="movie_player"]\')',
  "urlVideoId === playerVideoId",
  "if (attributeVideoId === urlVideoId) return attributeVideoId;",
  'attributeFilter: ["href", "video-id"]',
  'window.addEventListener("pagehide", () => resetCommentsVideoGuard(""), true);',
]) {
  assert(
    commentCleanerSource.includes(commentGuardRequirement),
    `Missing Comment Cleaner autoplay guard requirement: ${commentGuardRequirement}`,
  );
}
assert.doesNotMatch(
  commentCleanerSource,
  /if \(!commentsVideoGuardDestinationVideoId\) \{\s*commentsVideoGuardDestinationVideoId = currentVideoId;\s*commentsVideoGuardTrackedVideoId = currentVideoId;/,
  "Binding an autoplay destination must not mark it settled before comments are verified",
);
assert(
  playerPreferencesSource.includes(
    "grid-shelf-view-model:has(ytm-shorts-lockup-view-model-v2)",
  ),
  "Current grid-model Shorts shelves must be hidden, including search results",
);
for (const shortsConversionRequirement of [
  'const SHORTS_CONVERTED_ATTRIBUTE = "data-ytppl-shorts-converted"',
  "watchId !== convertedId",
  "link.removeAttribute(SHORTS_CONVERTED_ATTRIBUTE)",
  "link.setAttribute(SHORTS_CONVERTED_ATTRIBUTE, shortId)",
]) {
  assert(
    playerPreferencesSource.includes(shortsConversionRequirement),
    `Missing recycled converted-Shorts requirement: ${shortsConversionRequirement}`,
  );
}
for (const recycledRemovalRequirement of [
  'mutation.type === "childList"',
  "mutation.removedNodes &&",
  "mutation.removedNodes.length",
  "addScopedMutationRoot(roots, mutation.target);",
]) {
  assert(
    playerPreferencesSource.includes(recycledRemovalRequirement),
    `Missing recycled-card removal reconciliation: ${recycledRemovalRequirement}`,
  );
}
assert(
  !playerPreferencesSource.includes("getExpandedDescriptionContentHeight"),
  "Expanded descriptions must not be forced back to a fixed pixel height",
);
assert(
  playerPreferencesSource.includes("function setImportantStyleProperty("),
  "Expanded-description style writes must remain idempotent",
);
assert(
  !playerPreferencesSource.includes("ytd-watch-flexy #panels:has("),
  "Live-chat cleanup must not hide YouTube's shared panels container",
);
for (const commentCleanerRequirement of [
  "const invalidateCachedUploaderPaths = () => {",
  "const commentsVideoGuardRoots = new Set();",
  "invalidateCachedUploaderPaths();",
  "commentsVideoGuardRoots.forEach((comments) =>",
  '"yt-comment-view-model #reply-button-end"',
  '"yt-comment-view-model #action-menu"',
  "yt-comment-view-model #pinned-comment-badge",
  "yt-comment-view-model #header-badge",
]) {
  assert(
    commentCleanerSource.includes(commentCleanerRequirement),
    `Missing Comment Cleaner cache or batching requirement: ${commentCleanerRequirement}`,
  );
}
assert.match(
  commentCleanerSource,
  /if \(mutation\.type === "attributes"\) \{[\s\S]{0,500}?containsUploaderSource\(mutation\.target\)[\s\S]{0,160}?invalidateCachedUploaderPaths\(\);/,
  "Uploader href changes must invalidate Comment Cleaner's cached channel paths",
);
assert.match(
  userscript,
  /ytd-comments\[\$\{STALE_COMMENTS_ATTRIBUTE\}="1"\]\s*\{[\s\S]+?visibility:hidden !important;[\s\S]+?opacity:0 !important;[\s\S]+?pointer-events:none !important;/,
  "Stale comments must be hidden without collapsing the lazy-load area",
);
assert.match(
  userscript,
  /function hideWatchedVideos\(root = document\) \{\s+if \(isHistoryPath\(\)\) \{[\s\S]+?hideMatchingCards\(\s+root,\s+false,\s+WATCHED_VIDEO_SCAN_SELECTOR,\s+"ytpplWatchedHidden",[\s\S]+?return;/,
  "History must clear watched markers and return before filtering",
);
assert(
  !userscript.includes("hideInfoCardsAndEndScreens"),
  "The combined overlay preference must not be reintroduced",
);
assert(
  !userscript.includes("ytd-watch-next-secondary-results-renderer"),
  "The responsive secondary-results renderer must remain available for comments",
);
for (const preference of [
  "hideInfoCards: true",
  "hideEndScreenRecommendationGrid: true",
  "showAutoplayUpNextCard: true",
]) {
  assert(
    userscript.includes(preference),
    `Missing independent overlay preference: ${preference}`,
  );
}
assert.match(
  userscript,
  /function buildAutoplayUpNextCss\(\) \{[\s\S]+?if \(CONFIG\.showAutoplayUpNextCard\) \{\s+return "";\s+\}[\s\S]+?\.ytp-autonav-endscreen-upnext-container/,
  "The autoplay card must only be hidden when explicitly disabled",
);
const endScreenCssStart = playerPreferencesSource.indexOf(
  "function buildEndScreenRecommendationCss()",
);
const autoplayCssStart = playerPreferencesSource.indexOf(
  "function buildAutoplayUpNextCss()",
  endScreenCssStart,
);
assert(
  endScreenCssStart !== -1 && autoplayCssStart > endScreenCssStart,
  "Independent recommendation and autoplay CSS builders are required",
);
const endScreenCssSource = playerPreferencesSource.slice(
  endScreenCssStart,
  autoplayCssStart,
);
for (const recommendationTile of [
  ".ytp-videowall-still",
  ".ytp-modern-videowall-still",
]) {
  assert(
    endScreenCssSource.includes(recommendationTile),
    `End-screen recommendation tile must remain hidden: ${recommendationTile}`,
  );
}
assert(
  !endScreenCssSource.includes(".ytp-fullscreen-grid-stills-container"),
  "Recommendation cleanup must preserve the fullscreen end-screen container",
);
assert(
  !/display:\s*none\s*!important/.test(endScreenCssSource),
  "End-screen recommendation cleanup must preserve native layout for autoplay",
);
assert(
  !/visibility:\s*hidden\s*!important/.test(endScreenCssSource),
  "End-screen recommendation cleanup must preserve native renderer visibility",
);
for (const nonLayoutHidingRule of [
  "opacity: 0 !important",
  "pointer-events: none !important",
]) {
  assert(
    endScreenCssSource.includes(nonLayoutHidingRule),
    `End-screen recommendation cleanup is missing: ${nonLayoutHidingRule}`,
  );
}
for (const autoplayAncestor of [
  ".ytp-endscreen-content",
  ".ytp-endscreen-previous",
  ".ytp-endscreen-next",
  ".ytp-endscreen-paginate",
  ".ytp-autonav-endscreen-upnext-container",
]) {
  assert(
    !endScreenCssSource.includes(autoplayAncestor),
    `Recommendation cleanup must preserve native autoplay ancestor: ${autoplayAncestor}`,
  );
}
const scrollMiniplayerSource = canonicalSources.get("scrollMiniplayer") || "";
for (const queueRequirement of [
  "showCompactQueueInfo: true",
  'const QUEUE_INFO_ID = "ytsmp-compact-queue-info"',
  "function getCompactQueueState()",
  "function syncCompactQueueInfo()",
  '.ytp-playlist-menu',
  '.ytp-queue-menu',
]) {
  assert(
    userscript.includes(queueRequirement),
    `Missing compact queue requirement: ${queueRequirement}`,
  );
}
for (const queueObservationRequirement of [
  "const QUEUE_VISIBILITY_STATE_ATTRIBUTES = [",
  "const QUEUE_PANEL_STATE_ATTRIBUTES = [",
  '"aria-current"',
  '"aria-hidden"',
  '"aria-selected"',
  '"class"',
  '"hidden"',
  '"selected"',
  '"style"',
  "...QUEUE_VISIBILITY_STATE_ATTRIBUTES",
  "attributeFilter: QUEUE_PANEL_STATE_ATTRIBUTES",
  "attributeFilter: QUEUE_VISIBILITY_STATE_ATTRIBUTES",
]) {
  assert(
    scrollMiniplayerSource.includes(queueObservationRequirement),
    `Missing compact queue observation requirement: ${queueObservationRequirement}`,
  );
}
assert.match(
  userscript,
  /const QUEUE_PANEL_SELECTOR = \[\s+"ytd-playlist-panel-renderer",\s+"yt-playlist-panel-renderer",\s+\]\.join\(","\);/,
  "Compact queue must support both playlist panel host names",
);
assert.match(
  userscript,
  /currentItem\.querySelector\(QUEUE_ITEM_TITLE_SELECTOR\) \|\|\s+currentItem\.querySelector\(QUEUE_ITEM_TITLE_FALLBACK_SELECTOR\)/,
  "Compact queue must prefer the explicit video title before its fallback",
);

for (const navigationRequirement of [
  "let navigationInProgress = false;",
  "let navigationFinishPending = false;",
  "if (navigationInProgress || !isEligiblePath() || isFullscreen()) return false;",
  "if (navigationInProgress || !isEligiblePath() || scrollSyncFrame) return;",
  "function beginNavigationLock()",
  "function finishNavigationLock()",
  "function finishNavigationLockIfSettled()",
  "const NAVIGATION_RECOVERY_CHECK_DELAYS_MS = [1500, 5000, 10000];",
  "const NAVIGATION_RECOVERY_HARD_CAP_MS = 20000;",
  "function startMutationObservation()",
  "function stopMutationObservation()",
]) {
  assert(
    scrollMiniplayerSource.includes(navigationRequirement),
    `Missing Scroll Miniplayer navigation requirement: ${navigationRequirement}`,
  );
}
assert.match(
  scrollMiniplayerSource,
  /window\.addEventListener\("yt-navigate-start", \(\) => \{\s+beginNavigationLock\(\);\s+deactivateImmediately\(\);/,
  "Scroll Miniplayer must lock before navigation cleanup",
);
assert.match(
  scrollMiniplayerSource,
  /window\.addEventListener\("yt-navigate-finish", \(\) => \{\s+navigationFinishPending = true;\s+finishNavigationLockIfSettled\(\);/,
  "Scroll Miniplayer must identity-gate its navigation-finish release",
);
assert.match(
  scrollMiniplayerSource,
  /window\.addEventListener\("yt-page-data-updated", \(\) => \{\s+if \(navigationFinishPending\) \{\s+finishNavigationLockIfSettled\(\);\s+return;\s+\}\s+scheduleRouteSync\(\);/,
  "Scroll Miniplayer must retry a pending identity-gated release when page data catches up",
);
assert.match(
  scrollMiniplayerSource,
  /function finishNavigationLockIfSettled\(\) \{\s+if \(!navigationInProgress\) \{\s+navigationFinishPending = false;\s+scheduleRouteSync\(\);\s+return true;\s+\}\s+if \(!navigationHasSettledOrCancelled\(\)\) return false;\s+finishNavigationLock\(\);\s+return true;/,
  "Scroll Miniplayer must verify destination identity before releasing a finished navigation",
);
assert.match(
  scrollMiniplayerSource,
  /window\.addEventListener\("pageshow", \(\) => \{[\s\S]{0,180}?finishNavigationLock\(\);/,
  "Scroll Miniplayer must recover its navigation lock after BFCache restore",
);
const routeSyncIndex = scrollMiniplayerSource.indexOf(
  "function syncRouteState()",
);
const navigationGuardIndex = scrollMiniplayerSource.indexOf(
  "if (navigationInProgress)",
  routeSyncIndex,
);
const ineligibleRouteIndex = scrollMiniplayerSource.indexOf(
  "if (!isEligiblePath())",
  navigationGuardIndex,
);
const stopObservationIndex = scrollMiniplayerSource.indexOf(
  "stopMutationObservation();",
  ineligibleRouteIndex,
);
const startObservationIndex = scrollMiniplayerSource.indexOf(
  "startMutationObservation();",
  stopObservationIndex,
);
assert(
  routeSyncIndex !== -1 &&
    navigationGuardIndex > routeSyncIndex &&
    ineligibleRouteIndex > navigationGuardIndex &&
    stopObservationIndex > ineligibleRouteIndex &&
    startObservationIndex > stopObservationIndex,
  "Scroll Miniplayer mutation observation must be limited to settled eligible routes",
);
const scrollMutationObserverIndex = scrollMiniplayerSource.indexOf(
  "const mutationObserver = new MutationObserver((mutations) => {",
);
const mutationNavigationGuardIndex = scrollMiniplayerSource.indexOf(
  "if (navigationInProgress || !isEligiblePath()) return;",
  scrollMutationObserverIndex,
);
const mutationQueueWorkIndex = scrollMiniplayerSource.indexOf(
  "const queuePanelTopologyChanged",
  mutationNavigationGuardIndex,
);
assert(
  scrollMutationObserverIndex !== -1 &&
    mutationNavigationGuardIndex > scrollMutationObserverIndex &&
    mutationQueueWorkIndex > mutationNavigationGuardIndex,
  "Scroll Miniplayer queue mutation handling must remain inert during navigation",
);
for (const lifecycleRequirement of [
  "function mutationChangesQueuePanelTopology(mutation)",
  "...mutation.removedNodes",
  "function getAuthoritativeReplacementPlayer()",
  "if (!urlVideoId) return null;",
  "if (replacementVideoId !== urlVideoId) return null;",
  "function canDiscardOffRouteOrphan(player)",
  "function isRenderedWatchRoot(root)",
  ".querySelector(`#${PLACEHOLDER_ID}`)",
  'const PLAYER_RECOVERY_HOST_ID = "ytsmp-player-recovery-host"',
  "function ensurePlayerRecoveryHost()",
  "function startPlayerAdoptionObservation()",
  "playerAdoptionObserverTarget === target",
  "canDiscardOffRouteOrphan(candidate)",
  "recoveryHost.appendChild(candidate);",
  "function finaliseOffRouteOrphanIfSafe(candidate = floatedPlayer)",
  'document.addEventListener("emptied"',
  "function cancelScheduledAnimationFrames()",
  'window.addEventListener("pagehide", cancelScheduledAnimationFrames, true);',
]) {
  assert(
    scrollMiniplayerSource.includes(lifecycleRequirement),
    `Missing Scroll Miniplayer lifecycle safeguard: ${lifecycleRequirement}`,
  );
}
assert.match(
  scrollMiniplayerSource,
  /function finaliseOffRouteOrphanIfSafe\(candidate = floatedPlayer\)[\s\S]{0,700}?if \(!canDiscardOffRouteOrphan\(candidate\)\) return false;[\s\S]{0,120}?candidate\.remove\(\);/,
  "Scroll Miniplayer may discard only a confirmed inactive off-route orphan",
);
assert.doesNotMatch(
  scrollMiniplayerSource,
  /recoveryHost\.appendChild\(candidate\);[\s\S]{0,160}?scheduleOffRouteOrphanFinalisation\(\);/,
  "An active off-route orphan must not keep an indefinite polling loop alive",
);
assert(
  scrollMiniplayerSource.includes(
    'url.pathname.match(/^\\/live\\/([^/?#]+)/)',
  ),
  "Compact queue video-ID extraction must support /live/<id> URLs",
);
assert(
  scrollMiniplayerSource.includes("player?.getVideoData?.()?.video_id"),
  "Compact queue matching must consider the active player video ID",
);
for (const exactQueueRequirement of [
  "function getCurrentVideoIds(player)",
  "function getCurrentQueuePanel(currentVideoIds)",
  "getQueueItemVideoId(item) === videoId",
  "const currentVideoIds = getCurrentVideoIds(player);",
  "const entry = getCurrentQueuePanel(currentVideoIds);",
]) {
  assert(
    scrollMiniplayerSource.includes(exactQueueRequirement),
    `Compact queue must retain exact current-video matching: ${exactQueueRequirement}`,
  );
}
const queuePanelSelectionIndex = scrollMiniplayerSource.indexOf(
  "function getCurrentQueuePanel(currentVideoIds)",
);
const visibleExactPanelIndex = scrollMiniplayerSource.indexOf(
  "if (visibleMatchedEntries.length)",
  queuePanelSelectionIndex,
);
const anyExactPanelIndex = scrollMiniplayerSource.indexOf(
  "if (matchedEntries.length)",
  visibleExactPanelIndex,
);
const visibleFallbackPanelIndex = scrollMiniplayerSource.indexOf(
  "if (visibleSelectedEntries.length === 1)",
  anyExactPanelIndex,
);
const hiddenFallbackPanelIndex = scrollMiniplayerSource.indexOf(
  "const hiddenSelectedEntries",
  visibleFallbackPanelIndex,
);
assert(
  queuePanelSelectionIndex !== -1 &&
    visibleExactPanelIndex > queuePanelSelectionIndex &&
    anyExactPanelIndex > visibleExactPanelIndex &&
    visibleFallbackPanelIndex > anyExactPanelIndex &&
    hiddenFallbackPanelIndex > visibleFallbackPanelIndex,
  "Compact queue panel priority must be visible exact, any exact, visible fallback, then sole hidden selected",
);
for (const cornerRequirement of [
  'const CORNER_STORAGE_KEY = "yt-master-suite.scroll-miniplayer.corner.v1"',
  'const VALID_CORNERS = Object.freeze([',
  '"top-right"',
  '"bottom-right"',
  '"bottom-left"',
  '"top-left"',
  'const CLOSE_ICON_PATH =',
  'const MOVE_ICON_PATH =',
  'const CORNER_ICON_PATH =',
  'const SVG_NAMESPACE = "http://www.w3.org/2000/svg"',
  'function createControlIcon(className, pathData)',
  'icon.setAttribute("aria-hidden", "true")',
  'icon.setAttribute("focusable", "false")',
  "function ensureCornerButton()",
  "function renderCornerOptions(control)",
  "function applyCornerSelection(corner, control)",
  '.filter((corner) => corner !== currentCorner)',
  'button.setAttribute("aria-controls", CORNER_MENU_ID)',
  'button.setAttribute("aria-expanded", "false")',
  'menu.setAttribute("role", "group")',
  'setCornerMenuOpen(control, true);',
  "persistCorner(currentCorner);",
  'window.addEventListener("storage", (event) => {',
  "event.key !== CORNER_STORAGE_KEY",
  "!isValidCorner(event.newValue)",
  "currentCorner = event.newValue;",
]) {
  assert(
    scrollMiniplayerSource.includes(cornerRequirement),
    `Missing Scroll Miniplayer corner-control requirement: ${cornerRequirement}`,
  );
}
assert(
  !scrollMiniplayerSource.includes("CORNER_GLYPHS") &&
    !scrollMiniplayerSource.includes('button.textContent = "x"') &&
    !scrollMiniplayerSource.includes("getNextCorner") &&
    !scrollMiniplayerSource.includes("currentCorner = getNextCorner(currentCorner)"),
  "Scroll Miniplayer controls must use direct SVG corner choices instead of glyphs or cycling",
);
assert.match(
  scrollMiniplayerSource,
  /icon\.style\.transform = `rotate\(\$\{CORNER_ICON_ROTATIONS\[corner\]\}deg\)`/,
  "Each corner option icon must point towards its direct destination",
);
assert.match(
  scrollMiniplayerSource,
  /function applyCornerSelection\(corner, control\) \{[\s\S]+?currentCorner = corner;[\s\S]+?persistCorner\(currentCorner\);[\s\S]+?renderCornerOptions\(control\);[\s\S]+?focus\(\{ preventScroll: true \}\);[\s\S]+?setCornerMenuOpen\(control, false\);[\s\S]+?setBodyBoxVars\(\);[\s\S]+?dispatchResize\(\);/,
  "Direct corner selection must persist, retain focus, close the chooser and update the player position",
);
assert.match(
  scrollMiniplayerSource,
  /if \(event\.key !== "Escape"\) return;[\s\S]{0,220}?focus\(\{ preventScroll: true \}\);[\s\S]{0,120}?setCornerMenuOpen\(control, false\);/,
  "Escape must return focus to Move before closing the corner chooser",
);
assert(
  !scrollMiniplayerSource.includes(
    '#${CORNER_CONTROL_ID}:focus-within #${CORNER_MENU_ID}',
  ) &&
    !scrollMiniplayerSource.includes(
      '#${CORNER_CONTROL_ID}:hover #${CORNER_MENU_ID}',
    ),
  "CSS pseudo-classes must not override the corner chooser's explicit open state",
);
assert.match(
  scrollMiniplayerSource,
  /function readStoredCorner\(\) \{[\s\S]+?try \{[\s\S]+?localStorage\.getItem\(CORNER_STORAGE_KEY\)[\s\S]+?\} catch \{/,
  "Scroll Miniplayer corner storage must fail safely",
);

const pageCoherenceSource = canonicalSources.get("pageCoherence") || "";
for (const coherenceRecoveryRequirement of [
  "staleRecoveryDelaysMs: [2000, 5000, 10000]",
  "const getActiveWatchFlexy = () => {",
  '"#ytsmp-player-placeholder"',
  'document.querySelectorAll(\'[id="movie_player"]\')',
  "const getFlexyVideoIdentity = (flexy, urlVideoId, playerVideoId) => {",
  'source = "video-id-attribute-confirmed-by-url-player";',
  "const flexyIdentityObserver = new MutationObserver((mutations) => {",
  'attributeFilter: ["video-id"]',
  "const beginNavigationGeneration = (videoId = \"\") => {",
  "if (stalePageData) scheduleStaleRecoveryChecks(snapshot);",
  "window.addEventListener(\"pagehide\", handlePageHide, true);",
]) {
  assert(
    pageCoherenceSource.includes(coherenceRecoveryRequirement),
    `Missing Page Coherence recovery requirement: ${coherenceRecoveryRequirement}`,
  );
}
assert.doesNotMatch(
  pageCoherenceSource,
  /const handleNavigateStart = \(\) => \{[\s\S]{0,300}?setStalePageData\(false\);/,
  "Navigation start must not reveal metadata already known to be stale",
);
assert.match(
  pageCoherenceSource,
  /const confirmedMismatch = Boolean\([\s\S]{0,260}?urlVideoId !== playerVideoId[\s\S]{0,160}?urlVideoId !== flexyVideoId[\s\S]{0,160}?playerVideoId !== flexyVideoId/,
  "Page Coherence must guard every persistent disagreement between URL, player and active metadata",
);
assert.match(
  pageCoherenceSource,
  /"loadedmetadata",\s+\(event\) => \{\s+if \(!isWatchPath\(\)\) return;[\s\S]{0,180}?const player = getActivePlayer\(\);[\s\S]{0,220}?player\?\.querySelector\("video\.html5-main-video"\)[\s\S]{0,180}?if \(event\.target !== activeVideo\) return;/,
  "Page Coherence must ignore metadata events outside the active watch player",
);

for (const cardOwnershipRequirement of [
  'const FILTER_REVEAL_ATTRIBUTE = "data-yt-master-show-filtered"',
  "const CARD_HIDE_ATTRIBUTES = Object.freeze({",
  "const closestMarkedCard = rootElement?.closest?.(markerSelector);",
  'feedFilterProfiles: {',
]) {
  assert(
    playerPreferencesSource.includes(cardOwnershipRequirement),
    `Missing Player Preferences card-ownership requirement: ${cardOwnershipRequirement}`,
  );
}
assert(
  !playerPreferencesSource.includes("container.hidden ="),
  "Player Preferences must not use the generic hidden property for shared feed cards",
);
assert(
  !playerPreferencesSource.includes(
    'container.style.setProperty("display", "none", "important")',
  ),
  "Player Preferences must not share inline display ownership with another module",
);
for (const layoutRefreshRequirement of [
  "const PLAYER_LAYOUT_REFRESH_DELAYS_MS = [0, 100, 500, 1200];",
  "const playerLayoutRefreshAttemptTimers = new Map();",
  "if (playerLayoutRefreshAttemptTimers.has(delay))",
  "playerLayoutRefreshAttemptTimers.delete(delay);",
  "function clearPlayerLayoutRefreshAttempts()",
  "playerLayoutRefreshAttemptTimers.clear();",
  "function cancelScheduledAnimationWork()",
  'window.addEventListener(\n    "pagehide"',
  "function isRenderedWatchFlexy(flexy)",
  '.querySelector("#ytsmp-player-placeholder")',
]) {
  assert(
    playerPreferencesSource.includes(layoutRefreshRequirement),
    `Missing Player Preferences retry requirement: ${layoutRefreshRequirement}`,
  );
}
assert.match(
  playerPreferencesSource,
  /function handleNavigateStart\(\) \{\s+clearLiveChatCollapseAttempts\(\);\s+clearPlayerLayoutRefreshAttempts\(\);/,
  "Navigation start must cancel pending player-layout retries",
);
for (const mutationAttribute of [
  "aria-label",
  "class",
  "hidden",
  "href",
  "show-yoodle",
  "style",
  "title",
]) {
  assert.match(
    playerPreferencesSource,
    new RegExp(
      `const DYNAMIC_MUTATION_OPTIONS = Object\\.freeze\\(\\{[\\s\\S]{0,400}?"${mutationAttribute}"`,
    ),
    `Player Preferences scoped mutation tracking lost ${mutationAttribute}`,
  );
}
assert.match(
  playerPreferencesSource,
  /const DYNAMIC_MUTATION_DISCOVERY_OPTIONS = Object\.freeze\(\{\s+childList: true,\s+subtree: true,\s+\}\);/,
  "Player Preferences document discovery must remain child-list-only",
);
assert.match(
  playerPreferencesSource,
  /function configureDynamicMutationObserver\(\) \{[\s\S]+?const nextRegistrations = watchMode[\s\S]+?DYNAMIC_MUTATION_DISCOVERY_OPTIONS[\s\S]+?nextWatchRoots[\s\S]+?DYNAMIC_MUTATION_OPTIONS[\s\S]+?replaceObserverRegistrations\(observer, nextRegistrations\);/,
  "Player Preferences must scope rich watch-page mutations while retaining full feed reconciliation",
);
assert.match(
  playerPreferencesSource,
  /function collectWatchDynamicMutationRoots\(\) \{[\s\S]+?possibleAncestor !== candidate &&[\s\S]+?possibleAncestor\.contains\(candidate\)/,
  "Player Preferences must collapse nested watch roots before registering rich mutation tracking",
);
assert.match(
  playerPreferencesSource,
  /CONFIG\.hideRelatedVideos[\s\S]+?WATCH_RELATED_MUTATION_ROOT_SELECTOR/,
  "Player Preferences must retain rich related-rail tracking when related videos are enabled",
);
assert.match(
  playerPreferencesSource,
  /function mutationChangesWatchDynamicRoots\(mutation\) \{[\s\S]+?mutation\.addedNodes,[\s\S]+?mutation\.removedNodes[\s\S]+?nodeContainsWatchDynamicMutationRoot/,
  "Player Preferences must refresh scoped registrations for added and removed YouTube surfaces",
);
assert.match(
  playerPreferencesSource,
  /function handleNavigateFinish\(\) \{[\s\S]+?applyRoutePreferences\(\);\s+configureDynamicMutationObserver\(\);/,
  "Player Preferences must refresh its scoped observer after SPA navigation",
);
assert.match(
  playerPreferencesSource,
  /"yt-page-data-updated",\s+\(\) => \{\s+configureDynamicMutationObserver\(\);\s+scheduleApply\(document\);/,
  "Player Preferences page-data fallback must refresh observation roots and apply the full page",
);
assert.match(
  playerPreferencesSource,
  /function setWatchActionHidden\(actionElement, hidden\) \{[\s\S]+?if \(!actionElement\.hidden\) \{\s+actionElement\.hidden = true;[\s\S]+?if \(actionElement\.hidden\) \{\s+actionElement\.hidden = false;/,
  "Player Preferences watch-action writes must remain idempotent",
);
const wheelHandlerIndex = playerPreferencesSource.indexOf(
  "function handleWheelVolume(event)",
);
const wheelFastRejectIndex = playerPreferencesSource.indexOf(
  "CONFIG.requireRightMouseButtonForWheelVolume &&",
  wheelHandlerIndex,
);
const wheelPlayerLookupIndex = playerPreferencesSource.indexOf(
  "const player = getPlayerFromTarget(event.target);",
  wheelHandlerIndex,
);
assert(
  wheelHandlerIndex !== -1 &&
    wheelFastRejectIndex > wheelHandlerIndex &&
    wheelPlayerLookupIndex > wheelFastRejectIndex,
  "Ordinary wheel events must be rejected before player DOM lookup",
);
assert.equal(
  occurrences(
    playerPreferencesSource,
    'document.addEventListener("wheel", handleWheelVolume',
  ),
  1,
  "The volume-wheel listener must be registered exactly once",
);
assert.match(
  playerPreferencesSource,
  /document\.addEventListener\("wheel", handleWheelVolume, \{\s+capture: true,\s+passive: false,\s+\}\);/,
  "The volume-wheel listener must retain its known-working non-passive capture registration",
);
assert(
  !playerPreferencesSource.includes("addWheelVolumeListener") &&
    !playerPreferencesSource.includes("removeWheelVolumeListener") &&
    !playerPreferencesSource.includes("wheelVolumeListenerInstalled"),
  "Firefox right-button volume must not depend on temporary wheel-listener registration",
);
assert.match(
  playerPreferencesSource,
  /contextMenuSuppressionWindowMs:\s*750,/,
  "Right-button volume context-menu suppression must remain time-bounded",
);
assert.match(
  playerPreferencesSource,
  /contextMenuSuppressionExpiresAt\s*=\s*Date\.now\(\)\s*\+\s*CONFIG\.contextMenuSuppressionWindowMs;/,
  "Each handled right-button wheel step must renew the context-menu suppression deadline",
);
assert.match(
  playerPreferencesSource,
  /function handleContextMenu\(event\) \{[\s\S]*?Date\.now\(\) <= contextMenuSuppressionExpiresAt[\s\S]*?clearContextMenuSuppression\(\);[\s\S]*?event\.preventDefault\(\);/,
  "Context-menu suppression must expire and remain one-shot",
);
assert.match(
  playerPreferencesSource,
  /function handleMouseDown\(event\) \{[\s\S]*?clearContextMenuSuppression\(\);\s+rightButtonHeldOnPlayer = Boolean\(getPlayerFromTarget\(event\.target\)\);/,
  "A fresh right-button gesture must clear stale context-menu suppression before player detection",
);
assert.match(
  playerPreferencesSource,
  /function handleWindowBlur\(\) \{\s+rightButtonHeldOnPlayer = false;\s+clearContextMenuSuppression\(\);\s+\}/,
  "Window blur must clear right-button volume gesture state",
);
assert.match(
  playerPreferencesSource,
  /function handleNavigateStart\(\) \{[\s\S]*?rightButtonHeldOnPlayer = false;\s+clearContextMenuSuppression\(\);\s+\}/,
  "Navigation start must clear right-button volume gesture state",
);
assert(
  !playerPreferencesSource.includes("suppressNextContextMenu"),
  "The unbounded Boolean context-menu guard must not return",
);
for (const selector of [
  "ytd-miniplayer",
  "ytd-playlist-panel-renderer",
  "ytd-engagement-panel-section-list-renderer",
]) {
  assert(
    userscript.includes(`"${selector}"`),
    `Required excluded surface is missing: ${selector}`,
  );
}

assert.match(
  userscript,
  /const DIAGNOSTICS = Object\.freeze\(\{\s+enabled: false,/,
  "Diagnostics must remain disabled by default",
);
assert.match(
  userscript,
  /function reportModuleError\(ownerId, label, error\) \{[\s\S]+?\[\$\{ownerId\}\]/,
  "Shared runtime errors must identify their owning module",
);
assert.match(
  userscript,
  /reportModuleError\(\s+registeredListener\.ownerId,\s+`\$\{type\} event listener`,/,
  "Shared lifecycle listener errors must report their owning module",
);
assert.match(
  userscript,
  /reportModuleError\(\s+observer\.ownerId,\s+"mutation observer callback",/,
  "Shared mutation callback errors must report their owning module",
);
for (const sharedObserverRequirement of [
  'const RUNTIME_ERRORS_ATTRIBUTE = "data-yt-master-runtime-errors"',
  "const MAX_RUNTIME_ERRORS = 20",
  "function normaliseMutationOptions(options = {})",
  "function setLogicalMutationRegistration(registrations, target, options)",
  "function setSharedMutationObserverRegistryState(",
  "function logicalMutationOptionsEqual(",
  "function logicalMutationRegistrationsEqual(",
  "function refreshImmediatelyPreservingPendingState(",
  "function replaceLogicalMutationRegistrations(",
  "function installReplacementMutationObserver(",
  "function cloneLogicalMutationRegistrations(registrations)",
  "function mutationMatchesRegistrations(",
  "function mergeMutationOptions(leftOptions, rightOptions)",
  "function buildMutationCoverage(activeObservers)",
  "const registrations = new Map();",
  "requestedCoverage.registrations.forEach((options, target)",
  "replacementObserver.observe(target, options)",
  "this.registrations = new Map();",
  "replaceRegistrations(registrations) {",
  "replaceLogicalMutationRegistrations(\n        this,\n        sharedMutationObservers,\n        registrations,",
  "setLogicalMutationRegistration(this.registrations, target, options);",
  "setSharedMutationObserverRegistryState(\n        sharedMutationObservers,\n        this,\n        true,",
  "clearLogicalMutationRegistrations(this.registrations);",
  "setSharedMutationObserverRegistryState(\n        sharedMutationObservers,\n        this,\n        false,",
  "nativeMutationObserver.takeRecords()",
  "function preserveNativeMutationRecords(records)",
  "function flushPreservedMutationBatches()",
  "function mutationCoverageCovers(availableCoverage, requestedCoverage)",
  '"mutation:preserved-dispatch"',
]) {
  assert(
    userscript.includes(sharedObserverRequirement),
    `Missing shared-observer hardening requirement: ${sharedObserverRequirement}`,
  );
}
assert.match(
  userscript,
  /function mutationCoverageCovers\(availableCoverage, requestedCoverage\) \{[\s\S]+?availableCoverage\.registrations\.size !==\s+requestedCoverage\.registrations\.size[\s\S]+?mutationOptionsCover\(availableOptions, requestedOptions\)[\s\S]+?mutationOptionsCover\(requestedOptions, availableOptions\)/,
  "Shared mutation coverage must rebuild when targets or per-target options narrow",
);
assert.match(
  userscript,
  /function replaceLogicalMutationRegistrations\([\s\S]+?logicalMutationRegistrationsEqual\([\s\S]+?const previousRegistrations = observer\.registrations;[\s\S]+?if \(wasActive !== nextActive\) observer\.generation \+= 1;[\s\S]+?try \{\s+refresh\(\);\s+\} catch \(error\) \{[\s\S]+?observer\.registrations = previousRegistrations;[\s\S]+?throw error;/,
  "Atomic logical replacement must no-op on equality, retain active generations and roll back failed refreshes",
);
assert.match(
  userscript,
  /function logicalMutationOptionsEqual\([\s\S]+?Object\.hasOwn\(\s+leftOptions,\s+"attributeFilter",[\s\S]+?leftHasAttributeFilter !== rightHasAttributeFilter[\s\S]+?new Set\(leftOptions\.attributeFilter\)[\s\S]+?rightFilter\.has\(attributeName\)/,
  "Logical registration equality must distinguish unrestricted and empty attribute filters while comparing named filters as sets",
);
assert.match(
  userscript,
  /replaceRegistrations\(registrations\) \{[\s\S]+?refreshImmediatelyPreservingPendingState\([\s\S]+?\(\) => mutationRefreshPending,[\s\S]+?mutationRefreshPending = pending;[\s\S]+?refreshNativeMutationObserver/,
  "A failed atomic refresh must restore any previously pending shared reconciliation",
);
assert.match(
  userscript,
  /function installReplacementMutationObserver\([\s\S]+?replacementObserver\.observe\(target, options\)[\s\S]+?preserveRecords\(currentObserver\.takeRecords\(\)\);\s+currentObserver\.disconnect\(\);/,
  "Native replacement coverage must be live before old records are drained and disconnected",
);
assert(
  !userscript.includes("sharedMutationObservers.add(this)"),
  "Inactive logical mutation observers must not remain in the shared registry",
);
assert.match(
  userscript,
  /function dispatchMutations\(mutations\) \{[\s\S]{0,400}?flushPreservedMutationBatches\(\);[\s\S]{0,400}?dispatchMutationsWithDiagnostics\(mutations\)/,
  "Preserved mutation records must be delivered before replacement-observer records",
);
for (const [moduleName, source] of [
  ["Player Preferences", playerPreferencesSource],
  ["Scroll Miniplayer", scrollMiniplayerSource],
  ["Watch Layout", watchLayoutSource],
]) {
  assert.match(
    source,
    /function replaceObserverRegistrations\(targetObserver, registrations\) \{\s+if \(typeof targetObserver\.replaceRegistrations === "function"\) \{\s+targetObserver\.replaceRegistrations\(registrations\);[\s\S]+?targetObserver\.disconnect\(\);[\s\S]+?targetObserver\.observe\(target, options\)/,
    `${moduleName} must use atomic master registrations with a standalone native fallback`,
  );
}
assert.match(
  scrollMiniplayerSource,
  /const registrations = \[[\s\S]+?QUEUE_PANEL_STATE_ATTRIBUTES[\s\S]+?registrations\.push\(\[ancestor,[\s\S]+?QUEUE_VISIBILITY_STATE_ATTRIBUTES[\s\S]+?replaceObserverRegistrations\(observer, registrations\);/,
  "Scroll Miniplayer must register each queue panel and its visibility ancestors atomically",
);
assert.match(
  userscript,
  /function recordRuntimeError\(ownerId, operation, error\) \{[\s\S]+?if \(runtimeErrors\.length > MAX_RUNTIME_ERRORS\)/,
  "Runtime error reporting must remain bounded",
);
assert(
  userscript.includes("globalThis.__YT_MASTER_DIAGNOSTICS__"),
  "Diagnostics console API is missing",
);
assert(
  userscript.includes(
    'const DIAGNOSTICS_ATTRIBUTE = "data-yt-master-diagnostics"',
  ),
  "Diagnostics DOM bridge is missing",
);
assert.match(
  userscript,
  /document\.documentElement\?\.setAttribute\(\s+DIAGNOSTICS_ATTRIBUTE,\s+JSON\.stringify\(snapshot\),/,
  "Diagnostics snapshots must be available outside the userscript sandbox",
);
assert.match(
  userscript,
  /const HEALTH_ATTRIBUTE = "data-yt-master-suite";/,
  "The always-on Master Suite health marker is missing",
);
assert.match(
  userscript,
  /const moduleStates = new Map\(\);/,
  "The health marker must track per-module runtime state",
);
for (const moduleStatus of ["pending", "initialised", "disabled", "failed"]) {
  assert(
    userscript.includes(`status: "${moduleStatus}"`),
    `The health marker never records ${moduleStatus} modules`,
  );
}
for (const healthField of [
  "registeredModules",
  "enabledModules",
  "initialisedModules",
  "pendingModules",
  "disabledModules",
  "failedModules",
  "ready",
]) {
  assert(
    userscript.includes(`${healthField},`),
    `The health marker is missing ${healthField}`,
  );
}
assert(
  userscript.includes("expectedModules: EXPECTED_MODULE_COUNT,"),
  "The health marker is missing its expected module count",
);
assert.match(
  userscript,
  /healthy:\s+registeredModules === EXPECTED_MODULE_COUNT &&\s+ready &&\s+failedModules\.length === 0,/,
  "The health marker must only report healthy after registration and initialisation",
);
assert.match(
  userscript,
  /endBatch\(\);\s+publishHealthMarker\(\);/,
  "The health marker must be republished after idle module initialisation",
);
for (const coherenceRequirement of [
  'const STALE_ATTRIBUTE = "data-yt-master-page-stale"',
  'const STATE_ATTRIBUTE = "data-yt-master-state"',
  'const EVENTS_ATTRIBUTE = "data-yt-master-events"',
  "urlVideoId !== playerVideoId",
  "urlVideoId !== flexyVideoId",
  "playerVideoId !== flexyVideoId",
  "mismatchesBeforeWarning: 2",
  'const LEGACY_NOTICE_ID = "yt-master-page-coherence-notice"',
  "removeLegacyNotice();",
  "globalThis.__YT_MASTER_STATE__",
  '"visibilitychange",',
  'document.visibilityState !== "visible"',
]) {
  assert(
    userscript.includes(coherenceRequirement),
    `Missing page-coherence requirement: ${coherenceRequirement}`,
  );
}
assert.match(
  userscript,
  /:root\[\$\{STALE_ATTRIBUTE\}\] ytd-watch-metadata h1,[\s\S]+?:root\[\$\{STALE_ATTRIBUTE\}\] ytd-comments/,
  "Confirmed stale identity content and comments must remain hidden",
);
for (const staleContentSelector of [
  ":root[${STALE_ATTRIBUTE}] ytd-watch-metadata h1,",
  ":root[${STALE_ATTRIBUTE}] ytd-watch-metadata #owner,",
  ":root[${STALE_ATTRIBUTE}] ytd-watch-metadata #bottom-row,",
  ":root[${STALE_ATTRIBUTE}] ytd-video-primary-info-renderer h1,",
  ":root[${STALE_ATTRIBUTE}] ytd-video-primary-info-renderer #info-text,",
  ":root[${STALE_ATTRIBUTE}] ytd-video-secondary-info-renderer {",
  ":root[${STALE_ATTRIBUTE}] ytd-comments {",
]) {
  assert(
    userscript.includes(staleContentSelector),
    `Missing targeted page-coherence selector: ${staleContentSelector}`,
  );
}
assert.doesNotMatch(
  userscript,
  /:root\[\$\{STALE_ATTRIBUTE\}\] ytd-watch-metadata,\s*\n/,
  "Page Coherence must not hide the metadata component containing native actions",
);
assert.doesNotMatch(
  userscript,
  /:root\[\$\{STALE_ATTRIBUTE\}\] ytd-video-primary-info-renderer,\s*\n/,
  "Page Coherence must not hide the legacy primary-info action component",
);
assert.doesNotMatch(
  userscript,
  /:root\[\$\{STALE_ATTRIBUTE\}\][^\n{]*#actions/,
  "Page Coherence must not hide YouTube's native action row",
);
for (const removedCoherenceUi of [
  'copyQueueButton.textContent = "Copy queue"',
  'copyDiagnosticsButton.textContent = "Copy diagnostics"',
  'reloadButton.textContent = "Reload page data"',
  "const ensureNotice =",
  "const captureQueue =",
  "const buildDiagnosticsExport =",
  "yt-master-page-coherence-actions",
  "yt-master-page-coherence-queue-backup-v1",
]) {
  assert(
    !userscript.includes(removedCoherenceUi),
    `Removed page-coherence UI is still present: ${removedCoherenceUi}`,
  );
}

const userscriptHash = createHash("sha256").update(userscript).digest("hex");
assert.equal(releaseManifest.schemaVersion, 1);
assert.equal(releaseManifest.name, "YouTube Master Suite");
assert.equal(releaseManifest.version, metadata(userscript, "version"));
assert.equal(releaseManifest.source, "youtube-master-suite.user.js");
assert.equal(releaseManifest.sha256, userscriptHash);
assert.equal(releaseManifest.bytes, Buffer.byteLength(userscript, "utf8"));
assert.equal(releaseManifest.characters, userscript.length);
assert.equal(releaseManifest.registeredModules, expectedModuleCount);

if (existsSync(manualCopyPath)) {
  assert.equal(
    readFileSync(manualCopyPath, "utf8"),
    userscript,
    "The manual .txt copy is stale",
  );
} else if (releaseMode) {
  assert.fail("The manual .txt copy is required for a maintainer release check");
}

const versionComparisonRef = explicitBaseRef || "HEAD";
if (explicitBaseRef) {
  try {
    git(suiteDirectory, "rev-parse", "--verify", `${explicitBaseRef}^{commit}`);
  } catch {
    assert.fail(`Unable to resolve --base git ref: ${explicitBaseRef}`);
  }
}

let comparisonSourceLockExists = false;
try {
  git(
    suiteDirectory,
    "cat-file",
    "-e",
    `${versionComparisonRef}:sources.lock.json`,
  );
  comparisonSourceLockExists = true;
} catch {
  // The source lock may not exist in the initial repository commit.
}
if (comparisonSourceLockExists) {
  let comparisonSourceLock;
  try {
    comparisonSourceLock = JSON.parse(
      git(suiteDirectory, "show", `${versionComparisonRef}:sources.lock.json`),
    );
  } catch (error) {
    assert.fail(
      `Unable to read or parse sources.lock.json from ${versionComparisonRef}: ${error.message}`,
    );
  }
  assertChangedModuleVersionsIncreased(
    sourceLock,
    comparisonSourceLock,
    versionComparisonRef,
  );
}

let comparisonUserscript = "";
let comparisonArtifactExists = false;
try {
  git(
    suiteDirectory,
    "cat-file",
    "-e",
    `${versionComparisonRef}:youtube-master-suite.user.js`,
  );
  comparisonArtifactExists = true;
} catch {
  // The generated artefact may not exist in the initial repository commit.
}
if (comparisonArtifactExists) {
  comparisonUserscript = git(
    suiteDirectory,
    "show",
    `${versionComparisonRef}:youtube-master-suite.user.js`,
  );
}
if (
  comparisonUserscript &&
  comparisonUserscript.trimEnd() !== userscript.trimEnd()
) {
  const comparisonVersion = metadata(comparisonUserscript, "version");
  const currentVersion = metadata(userscript, "version");
  assert(
    compareVersions(currentVersion, comparisonVersion) > 0,
    `Generated changes since ${versionComparisonRef} require a master version increase`,
  );
}

if (releaseMode) {
  assert.equal(
    git(suiteDirectory, "status", "--short"),
    "",
    "Release verification requires a clean working tree",
  );
  assert.equal(
    git(suiteDirectory, "branch", "--show-current"),
    "main",
    "Releases must be verified from the main branch",
  );
  assert.equal(
    git(
      suiteDirectory,
      "rev-parse",
      "--abbrev-ref",
      "--symbolic-full-name",
      "@{upstream}",
    ),
    "origin/main",
    "The main branch must track origin/main before release",
  );

  const headCommit = git(suiteDirectory, "rev-parse", "HEAD");
  assert.equal(
    headCommit,
    git(suiteDirectory, "rev-parse", "origin/main"),
    "HEAD must exactly match origin/main before release",
  );

  const currentVersion = metadata(userscript, "version");
  const currentTag = `v${currentVersion}`;
  const stableTags = git(suiteDirectory, "tag", "--list")
    .split(/\r?\n/)
    .filter((tag) => /^v\d+\.\d+\.\d+$/.test(tag));
  assertReleaseVersionAboveStableTags(currentVersion, stableTags);
  if (stableTags.includes(currentTag)) {
    assert.equal(
      git(suiteDirectory, "rev-parse", `${currentTag}^{commit}`),
      headCommit,
      `${currentTag} exists but does not point to HEAD`,
    );
  }
}

console.log(
  `Verified YouTube Master Suite v${metadata(userscript, "version")} ` +
    `(${userscriptHash})`,
);
