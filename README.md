---
lang: en-GB
---

<p align="center">
  <img src="assets/YouTube_Master_Suite_Logo.svg" width="512" height="512" alt="YouTube Master Suite logo">
</p>

# YouTube Master Suite

One Tampermonkey userscript for cleaner YouTube feeds, better playback controls
and a more useful queue.

[Install](#installation) · [Settings](#suite-settings) ·
[Channel filters](#channel-upload-filters) · [Help](#troubleshooting) ·
[Technical reference](docs/technical-reference.md)

## What it does

| Area | Features |
| --- | --- |
| Playback | Mirror videos, adjust volume with right-click + wheel, choose a preferred starting quality and customise captions. |
| Queue | Play next in queue, improved native dragging and clearer queue labels. |
| Feeds | Hide watched videos, Shorts and other unwanted cards; set upload-age limits for individual channels. |
| Comments | Reduce clutter, distinguish creator names and guard against stale comments after video changes. |
| Layout | Wider watch-page content, a floating scroll miniplayer and optional fullscreen-strip hiding. |
| Menus | Group, reorder or hide recognised video-menu actions, and copy cleaner video links. |
| Consent | Reject optional cookies through YouTube's visible **Reject all** action on supported consent screens. |

Eight isolated feature modules share common browser infrastructure. The Suite
uses YouTube's native playback and queue rather than maintaining replacements.

## Installation

1. Install [Tampermonkey](https://www.tampermonkey.net/) and follow its
   browser-specific setup instructions.
2. Open the [latest released userscript](https://github.com/noswimmingplease/youtube-master-suite/releases/latest/download/youtube-master-suite.user.js)
   and approve installation. No GitHub sign-in is needed.
3. Disable any old standalone Suite component scripts, including **YouTube
   SponsorBlock Queue Width**, to avoid duplicate controls and processing.
   Leave companion extensions such as SponsorBlock enabled.
4. Reload YouTube to start the Suite. This restarts the current video.

If the file downloads instead of opening an installation prompt, paste its
complete contents into Tampermonkey's script editor and save. When updating,
replace the existing **YouTube Master Suite** script rather than adding a copy.

## Suite settings

Open the Suite logo beside your profile picture or in the player controls.
Settings are stored per browser profile, not synchronised through your Google
account.

- Edit your preferences, then select **Save**. Returning a setting to its saved
  value removes that unsaved change.
- Most changes take effect after reloading. **Reload now** restarts the current
  video; saving alone does not reload it.
- **Cancel** discards unsaved changes. **Restore this section** and **Restore all
  settings** change the draft until you save; they do not delete channel filters.
- Channel upload filters have their own **Save filters** button and apply
  immediately, without reloading.

Useful starting points:

| Setting | Where to find it |
| --- | --- |
| Hide the extra fullscreen action strip | **Player** — off by default; the main playback bar stays unchanged. |
| Preferred starting video quality | **Player** — YouTube chooses by default; later manual choices remain yours. |
| Watched-video threshold | **Feed** — choose how much counts as watched. |
| Group, hide or reorder menu actions | **Interface → Video context menu** — the settings group starts collapsed. Download is hidden by default. |
| View, edit or remove channel rules | **Channels → Channel upload filters**. |
| Extension-icon visibility | **Interface** — control DeArrow icons and the Return YouTube Dislike tooltip bar separately. |

## Channel upload filters

Keep recent uploads from news or daily channels without hiding their new videos.

1. Open **Channels → Channel upload filters → Manage filters**, or choose
   **Filter channel uploads…** in a supported video's menu.
2. Use the channel's `UC…` ID or full `youtube.com/channel/UC…` URL, not its
   `@handle`. Add a recognisable name.
3. Set a maximum age in **days, weeks, months or years**, or choose **Hide this
   channel — all uploads**.
4. Use **Add filter** / **Update filter** to collapse an entry, or **Add another
   channel** to create another. Select **Save filters** to apply the list and
   close the dialogue.

The **Channels** tab lists saved rules with **Edit filter** and **Remove filter**
buttons. Each rule can also be disabled without deleting it.

Filters affect supported Home, Search, Subscriptions and channel video cards.
They leave **Watch History, queues, saved playlists and directly opened videos**
unchanged. Age-only rules keep live/upcoming videos and uploads whose dates
cannot reliably establish their age; whole-channel rules also hide those cards.

Watched-video filtering remains separate. These rules neither import nor change
YouTube's own **Don't recommend channel** choices. **Filtered · Show** temporarily
reveals filtered cards without exposing advertisements.

## Play next in queue

Choose **Play next in queue** above **Add to queue** in a supported video menu.
An existing queued video is moved, not duplicated; choosing the playing video
does nothing. Saved playlists are not reordered.

YouTube's native add and reorder actions are separate. A new video can briefly
appear at the end before moving. If an error says the video was added but could
not be moved, **check the queue before retrying**. If the queue is still updating,
the Suite closes the menu without adding it; reopen the menu once it is ready.

## Updates

**Updates are manual.** Use the [latest release](https://github.com/noswimmingplease/youtube-master-suite/releases/latest),
replace the existing script, then reload YouTube when convenient. Publishing a
release does not update an installed copy automatically.

Use release assets rather than development copies from `main`. Install and
update the script separately in each browser profile where you use it.

## Companion extensions

The Suite includes compatibility options for **SponsorBlock**, **DeArrow** and
**Return YouTube Dislike**. **Extensions** in settings also lists uBlock Origin,
with descriptions and official links.

These recommendations do not detect, install or enable extensions. Independent
uBlock cosmetic filters can still hide elements even when a Suite setting shows
them. DeArrow's title and thumbnail replacements are independent of the Suite's
icon-visibility settings.

## Backup and support

Open **Support** in settings to:

- **Download a backup** of saved preferences and channel filters. Backups include
  channel names and IDs; keep them private. Unsaved drafts are not included.
- **Restore a backup** after previewing and confirming it. Restore **replaces**
  the saved settings and entire filter list; it does not merge them.
- **Copy a support report** containing the loaded version, module status and
  limited diagnostics, without video/channel IDs, titles or account details.

These tools do not upload backups or reports. Copying a report writes to the
clipboard only when requested. Restoring does not automatically reload the page.

## Troubleshooting

- **An update or setting seems unchanged:** reload YouTube when ready. Replacing
  the script does not update an already-open page.
- **Controls appear twice:** keep only one Suite installation enabled and disable
  its superseded standalone component scripts.
- **A channel filter misses a video:** check the saved channel ID, enabled state
  and applicable page. Uncertain dates stay visible for age-only rules.
- **A menu or queue action fails:** read its status message before retrying.
  Unsupported or ambiguous native interfaces are left alone.
- **Still a problem:** copy a report from **Support** and
  [report the issue](https://github.com/noswimmingplease/youtube-master-suite/issues),
  including the affected feature and steps to reproduce it.

The Suite targets desktop `www.youtube.com`; only the cookie-consent handler
runs on `consent.youtube.com`. It does not run in frames. YouTube layout
experiments can require updates: automated regression checks cannot guarantee
compatibility with every live layout or extension combination.

## Development

Build commands, testing, runtime diagnostics and the connected-editor workflow
are in the [technical reference](docs/technical-reference.md). Canonical module
versions are recorded in [sources.lock.json](sources.lock.json).

## Licence

The userscript is published under [GNU GPLv3](LICENSE). Bundled artwork includes
[third-party notices](assets/recommended-extensions.NOTICE.txt).
