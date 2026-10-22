---
lang: en-GB
---

# YouTube Master Suite

YouTube Master Suite combines a focused collection of YouTube userscripts into
one maintainable Tampermonkey installation. It preserves each script as an
isolated feature module while sharing the browser infrastructure that would
otherwise be duplicated across separate scripts.

[Installation and manual updates](#installation)

This repository is the definitive source for the suite. The former standalone
component repositories are superseded and are not required to build, maintain
or install it.

## Included functionality

Optional YouTube cookie consent is rejected automatically using YouTube's own
visible **Reject all** action. The handler is restricted to the recognised
YouTube consent panel and `consent.youtube.com`; it never accepts consent,
fabricates cookies or blocks essential sign-in/playback cookies. It makes at
most one attempt and stops after ten seconds if the interface is missing,
ambiguous or unsupported. Unrecognised/non-English consent layouts remain
visible for a manual choice. Install Tampermonkey and this suite in each profile
where this behaviour is required; a newly created empty browser profile does
not inherit extensions or scripts. Existing consent preferences are not reset.

| Module | Source version | Purpose |
| --- | ---: | --- |
| Comment Cleaner | 1.26 | Hides comment engagement and composer clutter, prevents stale comments from appearing during queue or autoplay navigation, compacts spacing, and distinguishes uploader and commenter names. Legacy and current comment components receive the same control, spacing and badge treatment. Uploader-link cache changes and comment freshness checks are batched per mutation delivery. A current permalink cannot certify a container while any retained pre-navigation renderer lacks destination provenance during the bounded recovery window. Comment Cleaner relinquishes its stale-content guard after a bounded eight-second deadline, armed even before a destination is known, preventing ambiguous recycled nodes from leaving comments permanently blank. |
| Feed UI Cleaner | 2.13 | Removes unwanted feed shelves, chips, advertisements, mixes, members-only cards, podcasts, and resulting gaps while preserving YouTube search. Filtering is route-profiled, reconciles recycled cards, targets the nearest genuine card rather than an enclosing shelf, and provides a temporary `Filtered: N` reveal control without counting or exposing advertisements. Its broad mutation observer is disconnected on watch, live and Shorts playback routes and across suspended-page transitions. |
| Miniplayer Button Restorer | 1.14 | Restores the native-style miniplayer control when YouTube omits it, selects the active watch container, cancels redundant retries after installation, and reinstalls after either control insertion or removal, including a back/forward-cache restore. It yields to a usable native button and reconciles native visibility and availability without duplicating controls during toolbar auto-hide. Its tooltip matches the mirror control and displays the existing native I shortcut. |
| Page Coherence Guard | 1.15 | Detects incomplete queue and autoplay navigation, including a new URL whose player and metadata both remain on the previous video. It makes one bounded native refresh attempt for positively identified previous-video comments even when the title and controller are current, and publishes lightweight identity diagnostics without hiding YouTube's native page content. It follows the rendered current player and watch container, including a reparented scroll player, rejects hidden duplicate players, and resolves retained ended-video data only when the URL and active player confirm YouTube's live watch identity. A narrow identity observer recovers updates arriving after the bounded navigation checks. Metadata events from feed previews and inactive videos remain ignored. |
| Player Preferences Lite | 1.76 | Applies player, feed, description, live-chat, volume, quality, Shorts, captions, horizontal mirroring, fullscreen-comment scrolling, and watch-page preferences without taking over YouTube's queue or native miniplayer. Optionally hides the fullscreen quick-action strip without changing the main playback controls; the setting is off by default. Native fullscreen action buttons are left untouched by the watch-page icon fallback. Native watch-player and inline-preview captions use readable yellow glyphs with a black shadow while retaining YouTube's positioning, size, typeface, background and opacity preferences. Hides both legacy and current grid-model Shorts shelves, including search results, while leaving ordinary result cards and search filter chips untouched; converted Shorts links retain an ID-scoped marker that is cleared when YouTube recycles the card. Keeps native like and Return YouTube Dislike counts vertically aligned. Feed filters use route profiles and module-owned markers; watched-video filtering deliberately excludes Watch History. Expanded descriptions remain responsive without repeated fixed-height writes, and live-chat hiding targets only chat surfaces rather than shared panel containers. On watch pages, rich mutation tracking is limited to the masthead, metadata and popup action surfaces while a child-list-only discovery observer retains late YouTube replacements; feed routes retain their existing full reconciliation. Active-player and scroll-placeholder ownership avoid stale duplicate watch containers. Pending animation work is cancelled across navigation and page suspension. Repeated watch-action visibility writes are avoided. Info cards, recommendation tiles, and the single autoplay up-next card have independent settings; individual end-screen recommendation tiles are visually hidden without removing YouTube's native autoplay geometry from layout. Layout refresh retries are coalesced. The known-working volume listener remains registered, while ordinary wheel events are rejected before player lookup unless the configured right-button gesture is active. Its one-shot context-menu suppression is time-bounded and cleared on navigation, window blur or the start of a fresh right-button gesture, so a later ordinary right-click is not swallowed. |
| Scroll Miniplayer | 5.27 | Floats the active watch or live player when it leaves the viewport and shows compact current-title and queue-position context at the top, clear of native playback controls, while the full queue remains hidden. YouTube-style SVG controls close it or open a direct three-corner position chooser while preserving accessible labels, keyboard focus and the stored valid position; corner changes synchronise across already-open YouTube windows. Queue context follows panel creation, removal and selection changes, preferring an exact current-video match before safe visible or selected fallbacks. Navigation stays locked after YouTube's finish event until the destination URL and active player identify the same video, while existing bounded recovery still handles cancelled or incomplete transitions. Player restoration remains non-destructive and is deferred while the player or its video owns native fullscreen; off-route live players use event-driven finalisation instead of indefinite polling, animation work is reset across page suspension, and observation stops off eligible routes. Queue labels are created using native DOM operations compatible with Trusted Types enforcement. |
| Watch Layout Cleaner | 1.46 | Adds a native-style Play next in queue action immediately above Add to queue. Play next uses the verified current queue index rather than stale playing flags and closes its menu after selection, including when the queue is not ready. Corrects stale playing markers only when the active player, queue ID and current queue index agree. Expands watch-page content, keeps an active queue rail at the SponsorBlock-friendly `374px` width, widens metadata and comments, and provides late-loading queue-thumbnail fallbacks for both legacy and current playlist panels. Queue drag assistance reuses native edge scrolling with current visible bounds and bounded speed, and animates only inner row contents without changing native drop targets or ordering. DeArrow queue logos occupy a fixed slot to avoid hover reflow and can be hidden independently of replacement titles and thumbnails. It releases an otherwise empty rail only when related content and chat are hidden, no usable queue exists and neither SponsorBlock nor a visible engagement panel needs the space. Removed offscreen queue rows are unobserved promptly. |
| Suite Settings | 1.31 | Opens a native-style settings dialogue beside the profile button, with a 32px embedded vector logo inside a 40px click target, validated local preferences and a dark/light in-panel colour picker. Uses the existing shared observer and stylesheet; builds the dialogue only when opened using native DOM operations compatible with Trusted Types enforcement and has no polling. |

The former standalone SponsorBlock Queue Width script remains superseded. Its
required layout rules are owned directly by Watch Layout Cleaner, avoiding a
redundant source artefact, event listener and style element.

The native player context menu's **Copy video URL** action copies a clean
`https://youtu.be/VIDEO_ID` link without playlist, queue, tracking or timestamp
parameters. **Copy video URL at current time** and the other native copy actions
remain unchanged. This applies to the English menu label; unrecognised labels
or clipboard implementations retain YouTube's native behaviour. It uses the
native action's freshly generated URL, with no clipboard monitoring or polling.

**Play next in queue** appears directly above **Add to queue** in recognised video
menus, using YouTube's own menu renderer, icon and keyboard navigation. Both the
legacy popup renderer and the current contextual sheet/list view models are
supported. Sheet updates use the native reactive data accessor and setter;
activation is bound to that exact sheet model and its owned target ID, because
current native rows do not expose their data through `.data`. It adds
the selected video once, then uses the native queue reorder handler to place it
immediately after the playing video. An existing queued video is moved rather
than duplicated; choosing the playing video does nothing. The original **Add to
queue** action remains unchanged. Saved playlists are not reordered.

New additions use a callable native resolver when exposed, or YouTube's native
command-action route when newer clients omit that method. Each command is sent
once; an ambiguous result never triggers a second dispatch route. Existing queued
items do not depend on an add-command resolver. Preflight failures close the menu
without starting an add or move; reopen it to try again. An attempted operation
cannot be repeated accidentally from that same menu entry.

The action does not reload playback, maintain a separate queue or continuously
poll. Reordering requires one unambiguous visible player. An existing queue's ID
must match that player. On Home and search, where the native miniplayer can
report no playlist ID, its own queue panel must instead match the player's exact
ordered video IDs. A collapsed queue is expanded through its native header and
given at most two seconds to become ready, without adding anything first.
Existing queue rows and their native reorder bindings are checked before a new
video is added. A known miniplayer queue ID without a verified panel or usable
playlist data is treated as still updating; Play next does not send an append
command in that state. A valid matching native panel remains a supported fallback.
The subsequent add/move operation waits at most eight seconds,
cancelling if navigation, the playing video or the active queue changes. If a
native operation becomes unverifiable after an add was accepted, the video may
remain at the end; a status message explains this. Ambiguous native operations
are not retried.
When native data and rows are ready, Play next coalesces its move before the
next paint instead of deliberately waiting for another animation frame. This
avoids an unnecessary visible tail position; the native add and reorder are
still separate operations, not an atomic insertion API.
Stale playing markers are corrected through native display-data bindings only
when one active player, its temporary queue ID and the panel's current index
identify the same unique video. Reused row bindings are refreshed if necessary;
queue order, playback and saved playlists are not changed. Corrections run on
native queue/render events and the existing rail observer, without polling or
another persistent observer. Incomplete panels and active drags are left alone.
Automated browser fixtures cover insertion, existing items, cancellation and
unsupported contracts. The live signed-out check confirms native menu rendering;
reordering still needs testing in a signed-in YouTube session.

Queue drag assistance applies to recognised native reorderable queues in both
the watch page and YouTube's native miniplayer. A trusted primary-button drag
temporarily adjusts YouTube's existing edge-scroll calculation to the visible
list area, including viewport and ancestor clipping, and limits its speed. It
does not create a second scrolling timer or write queue data. Surrounding rows'
inner contents animate briefly while native row geometry, the dragged clone and
the existing placeholder remain untouched. Reduced-motion preferences suppress
row animation. Temporary handlers, animation and marker styling are released
when the gesture finishes, is cancelled, loses its page or queue, or becomes
hidden. Same-size synthetic player-layout resize hints do not terminate an
active drag; genuine window resizing still releases assistance. Unrecognised
native implementations retain their original behaviour.

DeArrow's original/custom-title toggle has a reserved 25px slot in queue rows,
including native drag clones. Hovering over its 20px logo no longer changes the
title's available width. This is limited to recognised DeArrow queue markup;
watch-page titles and rows without DeArrow are untouched. It adds no observer,
timer or runtime extension dependency. Under **Interface**, disable **Show DeArrow
logo in queues** to hide only this control and remove the reserved space.
DeArrow's title and thumbnail replacements remain active. Like other suite
preferences, this choice applies on the next reload.

The separate **Interface → Show DeArrow icon beside video title** switch controls
DeArrow's watch-title button container. It is hidden by default; enabling it
restores DeArrow's own display rules after reload. This does not remove or
rewrite the title, disable thumbnail replacements, or change the queue-icon
preference. Late-inserted and replaced containers follow the same CSS rule.
Remove a separate uBlock cosmetic rule for `.cbTitleButtonContainer` when using
this preference: enabling the Suite switch cannot override another extension's
independent block rule.

Under **Interface**, **Show Return YouTube Dislike tooltip bar** is off by
default. This hides only `.ryd-tooltip-bar-container`, including tooltips
inserted outside the watch-page container; dislike counts and voting controls
are unchanged. Enable it and reload to restore the extension's own display
rules. Remove any separate uBlock cosmetic rule for the same selector if you
want this switch to restore the bar.

### Channel upload filters and video context menus

Under **Channels → Channel upload filters**, select **Manage filters** to add a channel
ID or a canonical `/channel/UC…` URL. Give each channel a maximum upload age
using a number and days, weeks, months or years, or select **Hide this channel —
all uploads** to hide its supported feed cards regardless of upload date.
Rules start empty: channels without a rule are unaffected. The Channels tab
shows each saved name, ID, age limit and status, with **Edit filter** and **Remove
filter** controls. In the manager, **Add filter** or **Update filter** collapses
the current entry into a summary without saving it. **Add another channel**
opens a new entry and collapses the previous valid one. **Save filters** applies
the whole list immediately and closes the dialogue; validation, storage or
conflicting-edit errors keep it open.
Removal is staged in the manager and requires **Save filters**; Cancel leaves
the saved rule unchanged. Each rule can also be disabled independently.
These limits are separate from **Hide watched videos** and its existing
threshold; an unwatched upload can still be hidden because it is too old.

Age filtering uses channel identity and publication metadata already present
on supported Home, Subscriptions, Search and channel video cards. It does not
download videos, look up every thumbnail, match channel display names or use
years in titles. Missing, conflicting or rounded dates that cannot establish
an upload as definitely too old are left visible by age-only rules, as are
live/upcoming uploads. A whole-channel rule also hides recent, undated and live
cards. Neither rule type filters queues, Watch History, saved playlists or
directly opened playback. The existing **Filtered · Show** control temporarily
reveals filtered cards. Rule changes apply without restarting playback.
Current lockups expose their canonical channel ID through `componentProps.data()`
even when their visible byline links to a handle. These records are read afresh;
conflicting channel IDs remain unfiltered rather than guessing from a name.
History lockups may keep that endpoint on their channel avatar instead of the
plain-text byline; both sources must agree when present.

These rules are saved locally in this browser profile, under the existing
`yt-master-suite.channel-age.v1` storage key. They are not synced to a Google
account. Saved or cleared rules refresh other open YouTube windows in the same
profile without restarting playback. An editor opened before another window's
save keeps its draft but refuses to overwrite the newer filters; Cancel and
reopen it to use the current rules. Earlier age-only rules remain valid and do
not become whole-channel blocks. YouTube's own **Don't recommend channel** feedback is separate and is
not imported, edited or cleared here. The Channels tab links to
[YouTube's official recommendation controls guidance](https://support.google.com/youtube/answer/6342839?hl=en&co=GENIE.Platform%3DDesktop).

Video-card menus offer **Filter channel uploads…** at the bottom by default. In the
compact layout, **Channel tools** opens an in-place submenu containing this
action alongside YouTube's **Don't recommend channel** and **Report** actions.
The same controls are available on History, individual playlist videos and
queue/playlist-panel video rows, as well as Home, Search, Subscriptions and
channel-video cards. This does not apply age filters to History or saved
playlists, or add recommendation/report actions which YouTube does not offer.
Those actions retain their original native handlers; opening the submenu does
not submit either action. If the card does not expose a reliable channel ID,
the shortcut cannot identify the channel automatically; use the Channels editor
with an explicit channel ID instead.

Under **Interface**, expand **Video context menu** to choose a compact or flat
menu and show or hide Download, Not interested, Don't recommend channel,
Report and the channel-upload filter action,
and use **Video context menu order** to rearrange recognised actions with
Move up/Move down controls.
Download is hidden by default. These preferences apply after reload, like the
other Interface settings. Unrecognised menus keep their native behaviour;
unrecognised actions are not removed.
Mouse opening and submenu changes leave actions neutral until hovered. Keyboard
opening focuses the first available action; arrow navigation follows the displayed
order and skips hidden, inert or unfocusable rows. Switching input methods does
not activate an action. From a neutral menu, Enter or Space first selects an
action rather than executing YouTube's previous default.
Stale native hover backgrounds are neutralised only in Suite-managed menus
when the row is neither actually hovered nor focus-containing. Native hover
classes, selection state and action handlers are not modified.
Playlist movement, playlist removal and History-removal actions remain native;
generic removal icons in these menus are not classified as channel feedback.
Menus without Add to queue require an exact, size-bounded match to the native
menu model belonging to the clicked video. A missing or changed match leaves
that menu untouched, rather than guessing which video it belongs to.
These checks cover the observed legacy and current layouts, not arbitrary
future YouTube changes. Unknown card types, conflicting video IDs, unsupported
row wrappers and ambiguous popups keep their native menus until support is
updated. No account, playlist or recommendation action is submitted on open.
Injected labels use the measured native text column in both layouts. Native
dropdown fitting is repeated once on the next frame after a submenu change,
then cancelled on dismissal, so legacy popups do not retain an intermediate
small size. This adds no continuous sizing or polling work.
This group starts collapsed each time settings opens. Current lockup-card menu
buttons use their dedicated semantic wrapper; no English label or decorative
touch-feedback class is required to identify the trigger. Both native popup
layouts still require the same card/video-ID ownership checks before changing
their displayed actions.
Recognised video-menu clicks also start a short, bounded lookup for reused
popups which open without another native opening event. This is cancelled on
dismissal or navigation and does not add permanent polling. Automatic
theatre-mode clicks do not dismiss the Suite's menu customisations.
Modern Download actions retain their native `yt-download-list-item-view-model`
wrapper and nested row. The wrapper counts as one action when hiding or
reordering the menu; its original button and event handlers are preserved.

**Restore this section** resets only the current settings tab in the draft;
**Restore all settings** resets all Suite preferences in the draft. Neither
changes saved preferences until **Save** is selected. Informational tabs have
no section defaults to restore. Saved channel-filter rules are managed in
their own editor and are not deleted by either reset.

The Ask-button filter also recognises YouTube's `you-chat-entrypoint-button`
class inside menu renderers or carrying the menu-renderer scope class. It does
not depend on decorative style classes or English button text, and does not
hide unrelated buttons or live-chat panels.

Hashtag cleanup preserves watch-page heading links and their native run nodes.
Removing these nodes can truncate a title and leave stale fragments when YouTube
reuses its formatted-string bindings for the next queue video. Title descendants
are excluded from both removal and hashtag-hiding CSS; description and chip
cleanup remains unchanged. This prevents further damage rather than guessing
replacement titles. A page already damaged by an older build needs a reload to
rebuild its native title nodes.

Under **Layout**, enable **Disable hashtag links in titles** to keep the title’s
hashtag text without the blue link styling or mouse/Enter activation. It is off
by default and applies after reload. This changes only watch-title link styling
and activation: native title runs, their links and DeArrow replacements remain
intact. No observer or polling is added.

Under **Player**, **Preferred video quality** leaves YouTube in control by default.
Choose **Highest available** or a resolution from 144p to 2160p (4K) to request
that quality for each new watch/live video, including queue changes. A missing
resolution falls back to the nearest available lower resolution; if none is
recognised, native selection remains unchanged. Unplayable quality entries are
excluded when the player exposes that information. Higher quality uses more
bandwidth and may buffer on a slow connection.

The preference uses the current website player's quality-range control rather
than the unsupported legacy quality setter. It checks the active video's identity,
skips advertisements and makes at most six startup attempts within eight seconds.
Attempts stop as soon as the player confirms the quality or you open/interact
with native player settings. Later page-data or metadata events cannot restart
attempts for that same video. Navigation and page suspension cancel pending work;
there is no continuous polling or extra observer. This requests a starting
quality, not a permanent override of later manual choices. Unsupported native
player contracts remain untouched. Changes apply after reload.

## Suite settings

Use the red cog/play button immediately before your YouTube profile button,
or its white monochrome counterpart immediately before **Mirror video** in the
watch/live player controls. Both open the same lazily built settings dialogue.
The header button remains available on pages without a watch player. When Mirror
is disabled, the player shortcut sits before Default view (or Full screen).
The supplied vector logo lives in `assets/YouTube_Master_Suite_Logo.svg`; the
builder embeds it, along with the panel assets, into the single userscript.
No remote icon request, GitHub authentication or extra runtime dependency is
required.

The player variant lives in `assets/YouTube_Master_Suite_Logo_Monochrome.svg`.
It retains the original geometry, with a transparent video panel and a white
play triangle. Its centred 36px icon canvas includes 4px padding and inherits
YouTube's button sizing and hover treatment. Its native-style tooltip reads
**Suite settings**; no new player keyboard shortcut is claimed. Mouse and
keyboard activation open the panel without forwarding a playback click. Layout
refreshes reposition an open tooltip without reopening a dismissed one.
The existing shared discovery observer watches the player container chain and
control subtree, not comment descendants. There is no new observer or polling.

The **Interface** tab independently sets each button to **Off**, **Colour** or
**Monochrome**. Defaults retain the colour header button and monochrome player
button. A monochrome header icon becomes black in light mode for readability;
the player icon stays white against the video. At least one settings button must
remain enabled. With the header button off, open a video to access the panel.
Button choices apply after reload, like the other saved preferences. Older
settings records retain their existing choices and receive these new defaults.

The logo is 32px inside an unchanged 40px click target. The dialogue is built
with native DOM operations, without raw HTML assignments or a Trusted Types
policy bypass. This supports YouTube's enforced HTML security policy.

The panel stays at 760px by 720px when space permits and fits inside smaller
viewports. All section tabs fit without a horizontal scrollbar at the standard
width; narrower windows retain scrollable tabs. Only the content area scrolls
vertically. Changing tabs, showing the colour picker, validation messages or Save
status does not resize the outer dialogue. Status messages sit between Cancel
and Save in the footer. Controls use red accents in both themes; disabled Save
is neutral and only enables when the draft differs from the saved settings.
Descriptions explain each feature without being used as layout spacers. The
**Credits** tab shows the embedded colour logo, author, installed suite version,
licence and a GitHub profile link opened with `noopener noreferrer`. It contains
no local build paths or profile data.

- Comments: current blue/orange defaults, three theme-adaptive palettes,
  custom six-digit hex colours and an in-panel RGB picker. **Off** restores
  native author/badge styling without disabling comment-loading safeguards.
  Compact spacing and hidden comment controls can be switched independently.
- Feed: Shorts, watched videos, mixes, podcasts and members-only filtering,
  plus the watched threshold. Watch History remains excluded from watched-video
  filtering.
- Channels: saved Suite-owned upload-age rules and whole-channel hiding, shown
  by name and channel ID with editable status and explicit-save removal. Native
  YouTube recommendation feedback is managed separately.
- Player: yellow captions, mirror-button visibility, preferred video quality,
  automatic theatre mode, right-button wheel-volume control and step, and optional
  fullscreen action-strip hiding (off by default).
- Layout: related videos, live chat, info cards, end-screen tiles and scrollable
  fullscreen comments.
- Miniplayer: enable/disable, preferred corner and compact title/queue context.
  Sizing remains automatic. The corner uses the existing synchronised storage,
  so the panel and the miniplayer's corner chooser cannot diverge.
- Interface: independently choose each settings button's visibility and icon,
  and separately show or hide Return YouTube Dislike's tooltip bar, DeArrow's
  watch-title controls and queue toggle logo.
- Extensions: four optional recommendations with bundled project logos,
  descriptions and official links: Return YouTube Dislike, SponsorBlock, DeArrow
  and uBlock Origin. This is an informational list, not an installation-status
  check; it does not install or enable anything, contact the router or scan the
  browser. The uBlock Origin entry notes the difference from Origin Lite and
  Chrome's lack of full uBlock Origin support. Only the panel content scrolls.
- Credits: logo, author, version, licence and GitHub profile link.
- Support: local backup/restore and an on-demand, privacy-safe troubleshooting
  report. Neither tool sends information anywhere or reloads playback.

Edits are drafts until **Save**. Cancel discards unsaved edits; Restore defaults
changes the draft only. Saved settings are local to YouTube in this browser
profile, not a YouTube account or GitHub. They apply on the next reload. The
primary button shows **Save** for unsaved changes, then **Reload now** when
saved preferences differ from those running in the page. Further edits return
it to **Save**; reverting them restores the appropriate state. With no changes
to save or apply, **Save** is disabled. Reloading still requires confirmation
because it restarts the page and video. Corner changes also
synchronise with other open YouTube windows, retaining the miniplayer's existing
behaviour. No automatic page refresh occurs when opening or saving the panel.
If another YouTube window changes saved preferences while the panel is open,
an unchanged draft refreshes to those values. An edited or invalid draft is
kept without overwriting the newer settings; Cancel and reopen to resolve it.
Invalid or unavailable stored settings fall back to the existing defaults;
storage write failures are displayed instead of reporting a successful save.

### Backup and restore

In **Support**, **Download backup** exports saved Suite preferences and channel
upload filters as versioned JSON. Unsaved edits, account data and browsing
history are excluded. Channel names and IDs are included deliberately; treat
the file as private. The backup is local to this browser profile and is not a
copy of YouTube's own recommendation choices.

Choose a backup to preview the setting changes and filter additions, updates
and removals. Restoring replaces both saved settings and the complete filter
list; it is not a merge. Confirmation is required and unsaved settings drafts
must first be saved or discarded. Unsupported fields, invalid values, duplicate
channels and files larger than 128 KiB are rejected before writing. A changed
storage baseline invalidates the preview. Writes are checked and partial
failures attempt to restore the previous records; any incomplete recovery is
reported explicitly. Channel filters refresh after success; settings retain
the existing explicit **Reload now** workflow. Restoring never reloads the page
automatically.

### Troubleshooting and compatibility

The **Support** tab shows a local, manually refreshed health report. **Copy
report** requests clipboard access only when clicked, with selectable text if
access is denied. Reports include allowlisted module states, bounded error
counts and fixed compatibility/navigation flags. They exclude raw error
messages, stack traces, timestamps, URLs, video/channel IDs, titles, search
terms, account data and performance traces. Timing diagnostics stay disabled.

Module initialisation is not proof that every feature works. Video-menu
compatibility is checked only after a menu is requested: not checked, loading,
not applicable, recognised and unsupported are distinct states. Unrecognised
layouts retain native actions. This helps identify layout changes; it cannot
prevent YouTube from changing its private components or guarantee support for
every experiment or language.

The isolated `examples/settings-preview.html` is a design reference only. The
functional panel is covered by the complete-suite Firefox checks in
`tests/browser/suite-settings.test.mjs`, including opening the panel, using its
colour picker and displaying the compact queue label under enforced Trusted
Types with no default policy.

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
- Irrelevant mutation types and attribute names are rejected before DOM
  containment checks. Logical subscription and queued-record ordering stay unchanged.
- Comment controls and author styling share one descendant/open-shadow-root
  discovery per application. Each later application rediscovers the current DOM.
- Channel upload filtering evaluates each normalised card once per reconciliation
  and shares one renderer snapshot within that evaluation, never between passes.
- Miniplayer control discovery skips verified comment-only mutations while its
  toolbar is connected. Unknown or structural changes retain the existing
  discovery path; shallow watch-state observation preserves visibility changes.
- Page Coherence selects one active player per snapshot. Later snapshots and
  recovery attempts still select afresh; no cross-navigation cache is introduced.
  Off-watch navigation events share their synchronous diagnostic snapshot with
  the immediate check, avoiding a second scan of retained comment permalinks.
- Watch-action matching reads each row's labels at most once in a synchronous
  reconciliation, sharing that read across configured menu and inline rules.
  Disabled rules do not trigger label reads, and later passes read the row afresh.
- Native preview progress, captions and controls do not trigger card filtering
  when they are inside a recognised preview player. Real thumbnail progress,
  metadata and outer renderer changes remain observed; unknown layouts retain
  the existing path.
- Miniplayer discovery ignores internal edits to the two native Suite settings
  dialogues. Mounting, removal, mixed native changes and player topology still
  take the recovery path. Settings avoid rewriting unchanged labels, colours
  and tab state; Support reports are collected only when that tab is used.
- Comment, feed and preference work queues coalesce roots against the current DOM when
  their animation frame runs, avoiding pairwise containment checks during large
  card bursts. Reparented and disconnected roots are handled without retaining
  an ancestry cache or crossing shadow-root boundaries.
- Feed-count summaries refresh for actual filter-state, membership and external
  marker changes, not unchanged view-count text. Real date/channel changes still
  run filtering, and initial loads, navigation and temporary reveal stay current.
- Mirror tooltips register their complete ancestor observation set in one
  transaction using the existing shared observer API, with the same standalone
  fallback and cleanup. No observation scope or native recovery is removed.
- Settings-button discovery ignores text/comment-only changes while retaining
  element replacement and removal recovery.
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

1. Install [Tampermonkey](https://www.tampermonkey.net/). On Chromium browsers,
   enable its **Allow User Scripts** permission where available, or Developer Mode
   where required. Tampermonkey Editors is optional and is only needed for the
   connected-editor workflow below.
2. Open the [latest released userscript](https://github.com/noswimmingplease/youtube-master-suite/releases/latest/download/youtube-master-suite.user.js)
   and approve installation in Tampermonkey. No GitHub sign-in is needed.
3. If the browser downloads the file instead, open **YouTube Master Suite** in
   Tampermonkey's editor (or create a new script), replace its contents with the
   complete generated file and save. Update the existing script rather than
   creating a second copy.
4. Disable the individual scripts listed above, including YouTube SponsorBlock
   Queue Width, to prevent duplicated observers, styles, controls and DOM work.
5. Reload YouTube so the master starts at `document-start`.

Do not enable the master and its component userscripts together.

## Updates

Updates remain manual in this version. Both `@updateURL` and
`@downloadURL` are set to `none`; Tampermonkey documents `@downloadURL none` as
[disabling update checks](https://www.tampermonkey.net/documentation.php?locale=en&q=update_url).
Use the latest release asset rather than a development copy from `main`.
Publishing the repository does not change this setting, and no authentication
token belongs in userscript metadata.

Use the installation steps above or the TampermonkeyFS workflow below for each
update. Keep the script name and use the `youtube.master-suite` namespace,
verify the saved source, then reload YouTube to activate it. Committing, pushing
or creating a release does not update an installed copy automatically.

If an older installation uses `Citizen.youtube.master-suite`, replace its source
in the existing Tampermonkey editor so the namespace changes without creating a
duplicate installation. This is a metadata-only correction within v1.0.0;
runtime behaviour and stored preferences are unchanged.

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

After two persistent checks confirm an identity mismatch, the guard marks it in
the published state and continues its bounded recovery checks. It does not hide
titles, channel details, descriptions, comments or native actions: YouTube's
normal SPA update order can briefly produce the same mismatch while a healthy
page is still settling. Comment Cleaner remains the sole, time-bounded owner of
stale-comment visibility.

For a watch page stuck loading after receiving its current response, or whose
native watch controller still owns a different video's response after loading
finishes, the existing checks can call YouTube's native `updatePageData_`
completion method once per
navigation, after at least 3.2 seconds. Recovery requires a visible active watch
component, a matching URL/player/app response identity, and the exact response
object already assigned to that component. Missing or changed native APIs fail
closed. A bounded set of follow-up checks remains armed while native loading is
unresolved, even when the video identities already match. If the finish event
is missing, recovery additionally requires a changed video URL and a subsequent
page-data or active-video metadata event. There is no continuous polling, new
mutation observer, network request or page reload. `loadingRecoveryStatus`
records the attempt in the state snapshot.
Completed native watch identity is accepted only when the response, component,
URL and player agree, even if YouTube retains an old `video-id` attribute. The
controller response identity is checked separately; title changes made by other
extensions are not used to trigger recovery.

### Scroll-miniplayer position

While the scroll miniplayer is active, hovering over, focusing or clicking the
Move button beside Close reveals the other three corners. Each arrow selects
its indicated corner directly, so no repeated cycling is required. The chooser
expands leftwards inside the player, remains keyboard accessible and closes
after a selection or when focus and the pointer leave it. Only the four valid
corner values are accepted from local storage; invalid or unavailable storage
falls back to the configured top-right position.

### Comments while staying fullscreen

When YouTube fullscreens the document root, ordinary vertical scrolling over the
video now scrolls the fullscreen page to its existing metadata and comments.
The video keeps its native fullscreen height. Comments are not copied, moved or
reloaded, and the native end-screen geometry is left intact.

This is controlled by Player Preferences' `enableFullscreenComments` setting.
It does not change player-only fullscreen, browser-only F11 mode, Shorts or
non-watch pages. Right-button volume gestures, modifier keys, horizontal
gestures, menus, dialogs and nested scrolling surfaces retain their existing
handling. Normal scrolling below the player remains browser-managed. The
fullscreen styles are removed on navigation start or page suspension and stop
applying immediately when native fullscreen ends.

### Horizontal video mirror

The **Mirror video horizontally** toggle sits between Settings and Default view
in the watch/live player controls, including after YouTube rebuilds them. Its
centred 36px icon matches the suite's restored miniplayer control. It flips
only the main video image. Captions, controls and the rest of the page remain
unchanged. Click again to restore the normal orientation; the button exposes its
on/off state to assistive technology as well as visually.

Hover or focus the button for a near-black YouTube-style tooltip above the seek
bar, with a compact outlined **H** key badge. Press **H** while the player has keyboard focus to toggle
mirroring. Modified shortcuts (including Ctrl+H), held-key repeats, text entry,
menus and dialogs are left alone. The tooltip replaces the browser's default
popup and is removed on blur, navigation, resizing and fullscreen changes.
The restored miniplayer button uses the same tooltip style and spacing, with an
**I** badge for YouTube's existing miniplayer shortcut; no extra I handler is added.

Mirroring is temporary for the current video, not a saved global preference.
It resets on navigation and page suspension, and follows the same video's player
through fullscreen and scroll-miniplayer changes or rebuilt controls. Home-page
previews, Shorts and inactive duplicate players are excluded. Text already baked
into the video image is necessarily mirrored along with the image.

Player Preferences' `enableVideoMirrorButton` setting controls this feature.
It uses the existing mutation and navigation handling with coalesced work rather
than adding a polling loop. The mirror style does not overwrite the video's
existing `transform` or change playback state, volume, captions or queue data.

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
`main` and on pull requests. The repository verifier runs the behavioural
tests once; CI does not repeat the same test suite in a separate step.
Release-tag pushes are deliberately excluded
because the identical commit has already passed on `main`; this avoids a
redundant tag run and duplicate failure notifications. The version check
compares the generated artefact with the push-before commit or pull-request
base rather than the already checked-out commit.

### Firefox browser regression checks

The development-only [Playwright library](https://playwright.dev/docs/library)
is pinned in `package-lock.json`. It is not bundled into the userscript and is
not needed for ordinary builds or the dependency-free repository verifier.

```powershell
npm ci --ignore-scripts
npx --no-install playwright install firefox
npm run test:browser
```

These checks load the complete generated userscript into headless Firefox,
with a fresh disposable browser context for each test. All page requests are
intercepted: the tests use a controlled YouTube-shaped fixture, not a live
YouTube account, browser profile or the running YouTube app. Browser startup,
DOM mutation delivery, trusted mouse/keyboard events, native copying, layout
and fullscreen transitions are exercised without replacing those browser APIs.
Only the fixture's YouTube page/player contracts are supplied locally.

Coverage includes clean versus timestamp copying, native keyboard activation,
queue comment replacement and mirror reset, retained watch-controller recovery,
fullscreen scrolling to comments and player-only fullscreen isolation.
Native queue drag fixtures cover both watch and miniplayer views, end-to-end
reordering, visible edge bounds, scroll anchoring, inner-only row animation,
reduced motion and cancellation. They model the inspected native drag contract;
they do not change a live queue or establish the cause of a production incident.
The checks fail rather than skip if Firefox is missing or cannot launch.
They are a browser regression layer, not proof of live YouTube compatibility
or long-session memory stability. Manual live-site checks remain necessary.

CI installs the pinned dependency and its matching Firefox build, including
Linux system dependencies, then runs these checks separately from the unit
tests. No script reinstall or version increase is needed for test-only changes.

On Windows, the same fixtures can explicitly target an already installed
browser. Set `YT_SUITE_TEST_BROWSER` to `chrome`, `edge`, `installed-firefox` or
`zen`, then run `npm run test:browser`. Unset it to retain the default patched
Firefox checks. The helper requires one expected executable in the standard
installation locations and verifies its product metadata before launching it.
It does not download a browser or connect to existing browser sessions.
Installed Firefox and Zen use the pinned library's native WebDriver BiDi path;
unsupported protocol features fail the checks rather than silently falling
back or skipping them.

All checks remain headless, with disposable profiles, fresh contexts and the
same intercepted fixture requests. Playwright closes and removes its temporary
profiles on normal teardown. For caller-controlled cleanup, optionally set
`YT_SUITE_TEST_ROOT` to an existing absolute local directory whose final component
matches the selected browser, for example a dedicated test run's `chrome`
subdirectory. Reparse-point ancestors are rejected. Each launch creates unique
`profile-<UUID>` and `artifacts-<UUID>` children; the helper does not delete these
explicit directories. The caller must confirm the test browsers have exited
before deleting that exact per-browser subtree.

This verifies the generated script's browser behaviour, not Tampermonkey
installation, extension approvals, account sign-in, live-site compatibility or
long-session memory stability.

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
- The suite targets `https://www.youtube.com/*`; on `https://consent.youtube.com/*`
  it runs only the optional-cookie rejection handler. It does not run in frames.
- The static Premium masthead-logo preference can only be fully validated when
  YouTube serves an event or animated logo.
- The script does not attempt to control SponsorBlock itself; it only preserves
  the right-rail width needed for its notice and queue alignment.
- This version uses manual updates; each browser profile must be
  updated separately.

## Licence

The generated userscript is published under GNU GPLv3, consistent with the
licence metadata carried by its GPL-covered source components.
