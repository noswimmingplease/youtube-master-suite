# YouTube Master Suite

YouTube Master Suite combines a focused collection of YouTube userscripts into
one maintainable Tampermonkey installation. It preserves each script as an
isolated feature module while sharing the browser infrastructure that would
otherwise be duplicated across separate scripts.

[Install or update YouTube Master Suite](https://raw.githubusercontent.com/Ci303/youtube-master-suite/main/youtube-master-suite.user.js)

This repository is the definitive source for the suite. The former standalone
component repositories are superseded and are not required to build, maintain
or install it.

## Included functionality

| Module | Source version | Purpose |
| --- | ---: | --- |
| Comment Cleaner | 1.17 | Hides comment engagement and composer clutter, prevents stale comments from appearing after queue or autoplay navigation, compacts spacing, and distinguishes uploader and commenter names. Legacy and current comment components receive the same control, spacing and badge treatment. Uploader-link cache changes and comment freshness checks are batched per mutation delivery. A current permalink cannot certify a container while any retained pre-navigation renderer lacks destination provenance; no-permalink surfaces are released only after page identity is coherent and old nodes detach. |
| Feed UI Cleaner | 2.6 | Removes unwanted feed shelves, chips, advertisements, mixes, members-only cards, podcasts, and resulting gaps while preserving YouTube search. Filtering is route-profiled, reconciles recycled cards, targets the nearest genuine card rather than an enclosing shelf, and provides a temporary `Filtered: N` reveal control without counting or exposing advertisements. Its broad mutation observer is disconnected on watch, live and Shorts playback routes and across suspended-page transitions. |
| Miniplayer Button Restorer | 1.6 | Restores the native-style miniplayer control when YouTube omits it, selects the active watch container, cancels redundant retries after installation, and reinstalls after either control insertion or removal, including a back/forward-cache restore. |
| Page Coherence Guard | 1.6 | Detects incomplete queue and autoplay navigation, including a new URL whose player and metadata both remain on the previous video. It hides confirmed stale title, owner, description and comment content, preserves YouTube's native action controls, and publishes lightweight identity diagnostics. It follows the active watch container, including a reparented scroll player, and uses bounded generation-safe recovery checks when YouTube finishes updating after the normal navigation window. Metadata events from feed previews and inactive videos remain ignored. |
| Player Preferences Lite | 1.44 | Applies player, feed, description, live-chat, volume, quality, Shorts, captions, and watch-page preferences without taking over YouTube's queue or native miniplayer. Native watch-player and inline-preview captions use readable yellow glyphs with a black shadow while retaining YouTube's positioning, size, typeface, background and opacity preferences. Hides both legacy and current grid-model Shorts shelves, including search results, while leaving ordinary result cards and search filter chips untouched; converted Shorts links retain an ID-scoped marker that is cleared when YouTube recycles the card. Keeps native like and Return YouTube Dislike counts vertically aligned. Feed filters use route profiles and module-owned markers; watched-video filtering deliberately excludes Watch History. Expanded descriptions remain responsive without repeated fixed-height writes, and live-chat hiding targets only chat surfaces rather than shared panel containers. On watch pages, rich mutation tracking is limited to the masthead, metadata and popup action surfaces while a child-list-only discovery observer retains late YouTube replacements; feed routes retain their existing full reconciliation. Active-player and scroll-placeholder ownership avoid stale duplicate watch containers. Pending animation work is cancelled across navigation and page suspension. Repeated watch-action visibility writes are avoided. Info cards, recommendation tiles, and the single autoplay up-next card have independent settings; individual end-screen recommendation tiles are visually hidden without removing YouTube's native autoplay geometry from layout. Layout refresh retries are coalesced. The known-working volume listener remains registered, while ordinary wheel events are rejected before player lookup unless the configured right-button gesture is active. Its one-shot context-menu suppression is time-bounded and cleared on navigation, window blur or the start of a fresh right-button gesture, so a later ordinary right-click is not swallowed. |
| Scroll Miniplayer | 5.20 | Floats the active watch or live player when it leaves the viewport and shows compact current-title and queue-position context while the full queue remains hidden. YouTube-style SVG controls close it or open a direct three-corner position chooser while preserving accessible labels, keyboard focus and the stored valid position; corner changes synchronise across already-open YouTube windows. Queue context follows panel creation, removal and selection changes, preferring an exact current-video match before safe visible or selected fallbacks. Navigation stays locked after YouTube's finish event until the destination URL and active player identify the same video, while existing bounded recovery still handles cancelled or incomplete transitions. Player restoration remains non-destructive; off-route live players use event-driven finalisation instead of indefinite polling, animation work is reset across page suspension, and observation stops off eligible routes. |
| Watch Layout Cleaner | 1.27 | Expands watch-page content, keeps an active queue rail at the SponsorBlock-friendly `374px` width, widens metadata and comments, and provides late-loading queue-thumbnail fallbacks for both legacy and current playlist panels. It releases an otherwise empty rail only when related content and chat are hidden and no usable queue exists. |

The former standalone SponsorBlock Queue Width script remains superseded. Its
required layout rules are owned directly by Watch Layout Cleaner, avoiding a
redundant source artefact, event listener and style element.

## Consolidation and performance design

The master is generated from the canonical module inventory declared by
`sources.lock.json` and matched exactly against `sources/modules/`. It
deliberately avoids concatenating independent userscripts unchanged.

- One native `MutationObserver` dispatches only the mutation records requested
  by each isolated module. Observation options are merged per target rather
  than globally, so a child-list discovery root does not inherit rich
  attribute and text tracking from a narrower page surface. Queued records are
  drained before an unavoidable rebuild. Multi-target logical observers replace
  their complete registration set with one synchronous native refresh, avoiding
  both repeated rebuilds and a gap before newly observed targets become active.
  Disconnected logical observers are removed from the shared registry so
  discarded queue panels and their callback closures are not retained.
- YouTube SPA lifecycle events are grouped so modules share native listeners
  while retaining their original capture or bubble phase. Each lifecycle
  delivery batches observer and stylesheet refreshes across all modules.
- Scroll Miniplayer disconnects its mutation observer and rejects scroll work
  outside settled watch and live routes.
- Player Preferences coalesces overlapping layout-refresh retries, reconciles
  only its own feed-card markers, narrows rich watch-page mutation tracking to
  relevant stable surfaces, and rejects ordinary wheel events before querying
  the player unless the configured right-button gesture is active.
- All module CSS is rendered through one ordered stylesheet element.
- Document-start and document-idle modules retain their original execution
  phases.
- A failing module is caught and reported with its module ID without preventing
  the other modules from starting.
- Each module keeps its original configuration, selectors, functions, timers,
  and state scope.
- Top-level `ENABLED_MODULES` switches allow one module to be isolated during
  debugging without rebuilding the individual scripts.

Canonical paths, input versions and SHA-256 hashes remain in
`sources.lock.json` instead of being repeated in the installed userscript. The
build fails when a module differs from its lock or when a guarded integration
point changes, preventing an unreviewed source edit from being silently
included while keeping the Tampermonkey source concise.

## Installation

1. Install Tampermonkey and the Tampermonkey Editors helper extension.
2. Open the [raw userscript](https://raw.githubusercontent.com/Ci303/youtube-master-suite/main/youtube-master-suite.user.js).
3. Confirm the Tampermonkey installation prompt.
4. Disable the individual scripts listed above, including YouTube SponsorBlock
   Queue Width, to prevent duplicated observers, styles, controls and DOM work.
5. Reload YouTube so the master starts at `document-start`.

Do not enable the master and its component userscripts together.

## Automatic updates

The userscript metadata points both `@updateURL` and `@downloadURL` at the raw
`main` userscript. Tampermonkey can therefore discover a release after its
`@version` is increased and the new generated file is committed and pushed.

Publishing a commit without increasing `@version` will not trigger a normal
Tampermonkey update.

## Runtime health marker

Every successful injection publishes a small JSON health marker on the root
document element:

```javascript
JSON.parse(document.documentElement.getAttribute("data-yt-master-suite"))
```

It reports the loaded master version; registered and expected module counts;
the enabled, initialised, pending and disabled module IDs; any failed module
IDs and bounded error messages; and `ready` and `healthy` states. `ready` is
false while an enabled module is pending. `healthy` is true only after every
module is registered, no enabled module is pending and no module failed. The
marker is always enabled and does not collect timings or observe additional
DOM changes. A missing marker means the userscript did not reach its
registration-complete stage. This is injection and initialisation health;
errors raised later by lifecycle or mutation callbacks do not retroactively
change the marker.

Later runtime errors remain console-reported and are also exposed separately as
a bounded list of the latest 20 errors:

```javascript
JSON.parse(
  document.documentElement.getAttribute("data-yt-master-runtime-errors"),
)
```

Each entry contains the module ID, operation, shortened error message and
timestamp; stack traces and page snapshots are not published. A missing
attribute means that no post-initialisation runtime error has been recorded.

## Configuration and fault isolation

The generated userscript contains an `ENABLED_MODULES` object near the top:

```javascript
const ENABLED_MODULES = Object.freeze({
  commentCleaner: true,
  feedUiCleaner: true,
  miniplayerButtonRestorer: true,
  pageCoherence: true,
  playerPreferencesLite: true,
  scrollMiniplayer: true,
  watchLayoutCleaner: true,
});
```

Set one entry to `false` only when isolating a fault. Feature-specific settings
remain inside their corresponding generated module and originate from the
component source scripts.

### Feed filtering and temporary reveal

Feed UI Cleaner and Player Preferences each own separate data attributes for
the cards they filter. They do not share the generic `hidden` property or an
inline `display` declaration, so one module cannot accidentally reveal a card
still filtered by the other. YouTube's recycled renderers are re-evaluated and
stale module-owned markers are removed when their content changes.

The canonical module configuration contains profiles for Home, Subscriptions,
Search, History and other feed routes. Current defaults preserve the existing
filters, including the deliberate decision to show watched entries in Watch
History. A small `Filtered: N · Show` control appears only when revealable items
are present. It temporarily reveals mixes, members-only, podcast, upcoming,
pay-to-watch and watched cards for inspection. Advertisements remain hidden.
The reveal state is never persisted and resets on navigation or BFCache restore.

### Optional diagnostics

Runtime diagnostics are compiled into the master but disabled by default:

```javascript
const DIAGNOSTICS = Object.freeze({
  enabled: false,
  reportIntervalMs: 30000,
});
```

When enabled for a temporary investigation, the master records module
initialisation time, shared lifecycle-event time, shared mutation dispatch and
filter time, mutation callback time and the number of mutation records
processed. It reports periodically in the developer console, sorted by total
execution time, and exposes:

```javascript
__YT_MASTER_DIAGNOSTICS__.snapshot()
__YT_MASTER_DIAGNOSTICS__.report()
__YT_MASTER_DIAGNOSTICS__.clear()
```

Firefox may keep that API inside the userscript sandbox. The same snapshot is
therefore published every 30 seconds as a diagnostic document attribute and
can be retrieved from the page console with:

```javascript
JSON.parse(
  document.documentElement.getAttribute("data-yt-master-diagnostics"),
)
```

Leave diagnostics disabled during normal use.

### Lightweight navigation state

The Page Coherence Guard always publishes a small current-state snapshot and a
bounded history of the last 20 navigation events. It performs no continuous
polling and collects no performance timings:

```javascript
JSON.parse(document.documentElement.getAttribute("data-yt-master-state"))
JSON.parse(document.documentElement.getAttribute("data-yt-master-events"))
```

When accessible from the page console, the equivalent API is:

```javascript
__YT_MASTER_STATE__.snapshot()
__YT_MASTER_STATE__.events()
__YT_MASTER_STATE__.check()
```

After two persistent checks confirm that the URL and player have advanced but
`ytd-watch-flexy` still belongs to the previous video, stale title, owner,
description and comment content is hidden. YouTube's native action row remains
available, including like, dislike, Save/queue and overflow controls. The guard
continues to publish its bounded diagnostic state without adding a replacement
warning or action bar to the page.

### Scroll-miniplayer position

While the scroll miniplayer is active, hovering over, focusing or clicking the
Move button beside Close reveals the other three corners. Each arrow selects
its indicated corner directly, so no repeated cycling is required. The chooser
expands leftwards inside the player, remains keyboard accessible and closes
after a selection or when focus and the pointer leave it. Only the four valid
corner values are accepted from local storage; invalid or unavailable storage
falls back to the configured top-right position.

## Repository layout

```text
youtube-master-suite/
|-- build-master.mjs
|-- refresh-source-lock.mjs
|-- verify-installed-master.mjs
|-- verify-master.mjs
|-- release-manifest.json
|-- sources.lock.json
|-- youtube-master-suite.user.js
|-- sources/
|   |-- modules/
|   |   `-- <pinned component userscripts>
|-- .gitignore
`-- README.md
```

- `build-master.mjs` is the consolidation logic and build entry point.
- `sources.lock.json` pins every canonical module to its version and SHA-256
  hash.
- `release-manifest.json` records the generated version, SHA-256 hash, byte and
  character lengths, and exact module-registration count.
- `refresh-source-lock.mjs` refreshes those values from the reviewed canonical
  files in `sources/modules/`.
- `verify-installed-master.mjs` compares an installed or exported userscript
  file against the release manifest.
- `verify-master.mjs` checks reproducibility, syntax, metadata, source locks,
  shared infrastructure, route exclusions, diagnostics defaults and the local
  manual-install copy.
- `youtube-master-suite.user.js` is the generated, installable artefact.
- `sources/modules/` contains the definitive, directly maintained feature
  module sources. The build rejects missing, orphaned or duplicate inventory
  entries.
- `youtube-master-suite.txt` is a local manual-install copy and is deliberately
  ignored because the `.user.js` file is the canonical published artefact.

## Building and verification

A normal build uses the committed source lock and canonical sources contained
in this repository, so a clean clone is sufficient:

```powershell
node .\build-master.mjs
node .\verify-master.mjs
node .\verify-installed-master.mjs .\youtube-master-suite.user.js
```

`node .\build-master.mjs --check` verifies that the generated userscript is
current without writing it. The build, source-lock refresher and both
verifiers also expose dependency-free `--self-test` checks, which CI executes.
`node .\verify-master.mjs --release` additionally requires a clean `main`
checkout tracking and exactly matching `origin/main`, a version newer than all
other stable tags, a correctly placed current-version tag if one already
exists, and a matching local `.txt` copy.

Identical locked inputs produce an identical userscript and SHA-256 hash.
GitHub Actions runs the build check, verifier and syntax checks on pushes to
`main` and on pull requests. Release-tag pushes are deliberately excluded
because the identical commit has already passed on `main`; this avoids a
redundant tag run and duplicate failure notifications. The version check
compares the generated artefact with the push-before commit or pull-request
base rather than the already checked-out commit.

### Editing module sources

Edit the relevant canonical userscript in `sources/modules/`, increase that
module's metadata version, then refresh the lock and rebuild:

```powershell
node .\refresh-source-lock.mjs
node .\build-master.mjs
Copy-Item .\youtube-master-suite.user.js .\youtube-master-suite.txt -Force
node .\verify-master.mjs
```

The refresh command only updates module versions and hashes. It refuses a
changed canonical source unless that module's dotted numeric metadata version
has increased, and it validates every module before writing the lock. Review
its diff before building. A normal build refuses any canonical source whose
content or version differs from the lock.

## TampermonkeyFS workflow

The recommended permanent local link is the generated file in the repository
checkout:

```text
<repository checkout>\youtube-master-suite.user.js
```

In VS Code, connect TampermonkeyFS to Tampermonkey, open **YouTube Master
Suite** from the virtual Tampermonkey folder, select **Link With Local File...**,
and choose the generated `.user.js` file.

TampermonkeyFS is editor-centred. A permanent change should follow this flow:

1. Edit and validate the relevant source in `sources/modules/`.
2. Run `node .\refresh-source-lock.mjs`.
3. Increase the master version and run `node .\build-master.mjs`.
4. Run `node .\verify-master.mjs`.
5. Let TampermonkeyFS load the changed linked file into its virtual editor.
6. Save the virtual editor to send the same source to Tampermonkey.
7. Read the saved script back from Tampermonkey and require its canonical prefix
   to equal `youtube-master-suite.user.js` exactly. Tampermonkey Editors appends
   a separate `---` / `Last modified: <ISO timestamp>` synchronisation footer;
   validate that footer independently, then verify the canonical prefix's hash,
   length and module registrations against `release-manifest.json` before
   committing.

For a file-backed or exported installed copy, run:

```powershell
node .\verify-installed-master.mjs <installed-source-path>
```

Direct edits to the generated userscript can be overwritten by the next build.

## Validation checklist

Before publishing a new version:

1. Increase the master `@version` in `build-master.mjs`.
2. Refresh and review `sources.lock.json` after editing canonical module
   sources.
3. Rebuild and run `node .\verify-master.mjs`.
4. Confirm the route-policy checks cover any new exclusions.
5. Test YouTube Home, Search, History and subscription feeds; filtered-card
   reveal/reset and recycled cards; watch-page SPA navigation;
   comment/video-ID parity during queue changes; coherence stale-content and
   native-action behaviour; the restored miniplayer button; all four scroll-miniplayer corners;
   fullscreen transitions; live pages; and the `374px` SponsorBlock queue.
6. Commit and push, then run `node .\verify-master.mjs --release`.
7. Confirm the installed Tampermonkey source matches
   `release-manifest.json`, including its declared module registrations.

## Compatibility and limitations

- YouTube is a continuously changing single-page application. Selectors and
  lifecycle timing may require updates without warning.
- The suite targets `https://www.youtube.com/*` and does not run in frames.
- The static Premium masthead-logo preference can only be fully validated when
  YouTube serves an event or animated logo.
- The script does not attempt to control SponsorBlock itself; it only preserves
  the right-rail width needed for its notice and queue alignment.
- Automatic updates require access to the public raw GitHub URL.

## Licence

The generated userscript is published under GNU GPLv3, consistent with the
licence metadata carried by its GPL-covered source components.
