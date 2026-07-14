# Okay Karaoke Studio — Roadmap

The version 0.1 product-acceptance gate in [`MVP.md`](./MVP.md) remains open until
the user makes and accepts a karaoke video for a new song with the Studio. This
roadmap holds capabilities that are deliberately deferred from that active
contract. Ordering is intentional, but a roadmap item is not a commitment until
it passes the decision gates below and is assigned to a release.

If the real-song attempt exposes a blocker, a capability may move into the MVP;
if an MVP behavior does not serve that gate, it may be revised or removed. Record
the observed blocker and contract change rather than treating this roadmap as a
fixed post-MVP boundary. These product-scope decisions do not relax the
requirement to keep `main` technically green and releasable.

Okay Karaoke Studio is a karaoke editor. Automatic media preparation, live-show
operation, and collaboration are not core-product goals. A future plugin could
hand work to external transcription, alignment, or source-separation tools, but
no such integration is currently planned.

## Next: safer and faster editing

- Crash-safe autosave snapshots and project recovery.
- Ripple timing, range retime, quantize, and nudge presets.
- Additional independently timed singer-track authoring, including track naming,
  styling, synchronization, and editing. Separate tracks are the mechanism for
  intentional overlapping vocals; timing within each track remains ordered and
  non-overlapping.
- Line, phrase, and arbitrary group dragging with magnetic snapping.
- Loop ranges, markers, count-in, metronome, and configurable keyboard shortcuts.
- Separate **reference audio** for lyric synchronization from **export audio**
  for the final render. Both use one project timebase, with an alignment offset,
  preview source switching, duration-drift warnings, and an explicit export-source
  check so a lead-vocal reference is not exported accidentally.
- Apply timing anchors from an LRC to the current project lyrics without replacing
  corrected spelling. Show unmatched lines and words, and require confirmation
  before applying any inferred mapping. Prototype this before scheduling it.
- Multiple lyric revisions and side-by-side source and synchronized lyrics.
- Command-based editing history with named operations and a visual history panel.

## Next: reusable visual production

- Curated theme packs built on the MVP stage-style model.
- Alternative sync-aid animations that preserve the MVP timing and phrase-
  eligibility rules.
- Rich effects and layout controls beyond the MVP editor, including lyric
  outline and shadow effects, advanced gradient geometry, arbitrary positioning,
  and reusable per-track themes.

Named creator-preference templates are now part of the active MVP contract. The
MVP stage-style model is the shared foundation, so every later extension must
keep the editor preview and exported result aligned. Curated theme packs remain
a high-priority post-MVP product milestone.

## Next: CD+G and MP3+G interoperability

- CD+G packet authoring with a standards-constrained preview.
- Packet validation and golden conformance fixtures.
- MP3+G export as matching `.cdg` and `.mp3` files, with optional ZIP packaging.

CD+G is a separate constrained renderer, not a reduced version of the richer video
theme system. The first release may require or copy an existing MP3 without
transcoding; changing the source audio format is a separate quality and licensing
decision.

## Later: visual production

- Standards-aware ASS import that preserves unknown sections and column formats.
- Portable embedding or managed copying of static background images. Any font-
  portability design must respect font licensing and must not silently
  redistribute installed font files.
- Scheduled still images, animated backgrounds, and per-section scenes.
- Aspect-ratio presets, title-safe/action-safe overlays, and multiple preview
  devices.
- Advanced video controls for codec, background scenes, and subtitle-safe-area
  presets. Resolution and frame-rate presets are part of the active MVP contract.

## Later: additional interchange formats

These have no current priority and should not delay CD+G/MP3+G:

- MP3 ID3 synchronized-lyrics (SYLT) import/export.
- MIDI/KAR import, playback, and lyric-event export.
- Lead Vocal Track note display and note-to-word synchronization.
- UltraStar TXT and additional enhanced-LRC variants.

Any promoted adapter includes interchange fixtures and conformance tests in its
definition of done.

## Platform and distribution

- Linux packaging and Linux-specific media verification. Unsigned Windows x64
  packaging and its platform media gates are part of the MVP contract.
- Signed Windows releases, signed and notarized macOS releases, and automatic
  updates.
- Validate the guided FFmpeg setup flow through WinGet, an existing Homebrew, and
  platform instructions with nontechnical users. Reconsider a bundled companion
  executable only if that flow remains a material distribution barrier.
- Optional Tauri shell evaluation after the editor contracts stabilize.
- Performance telemetry that is opt-in, local-first, and privacy-preserving.

Okay Karaoke Studio currently invokes a system-installed FFmpeg as a separate
command-line process and does not redistribute that encoder executable. Bundling
it remains possible, but is not required for Windows MVP acceptance and the
selected build determines the obligations. The final public project license and
FFmpeg redistribution policy are separate user-held MVP decisions; implementation
work must not silently choose or close them.
FFmpeg is LGPL 2.1-or-later by default, while GPL components and external libraries
can make the resulting build GPL. The current exporter uses `libx264`, which the
[FFmpeg license documentation](https://ffmpeg.org/doxygen/trunk/md_LICENSE.html)
identifies as GPL and requires in a GPL-enabled FFmpeg build. Encoder provisioning
therefore needs an explicit codec, redistribution, source-notice, patent, and
security-update decision; it is a distribution gate rather than a visual-editor
feature. See FFmpeg's [legal checklist](https://ffmpeg.org/legal.html) and
[security advisories](https://ffmpeg.org/security.html). This is project-planning
guidance, not legal advice.

## Not planned in the core product

### Automatic media preparation

- Local speech transcription or word-timestamp generation.
- Offline stem separation for instrumental, lead-vocal, or backing-vocal stems.
- Waveform or onset analysis as resumable background jobs.
- Confidence scoring and review queues for automatically inferred words.
- Pluggable lyrics providers or lyrics acquisition.

### Audio production and rehearsal

- A multi-stem mixer or automatic sample alignment.
- Vocal-guide ducking, pitch reference, pan, EQ, or limiter controls.
- Tempo or pitch transformation.
- Proxy generation or a long-media waveform cache.
- Low-latency input monitoring.

The two-audio-role editing workflow above does not mix stems: only one source plays
at a time, and the project retains one authoritative clock.

### Live and collaborative workflows

- Singer or audience displays.
- Set lists, singer rotation, remote requests, or QR join flows.
- Shared review links or timestamped comments.
- Cloud sync, team roles, change attribution, or approval states.
- Project bundles designed for collaboration between machines.

### Creator-driven stage elements

- Automatic Instrumental words, countdowns, or graphics between lyric sections.
- Creator-authored placement of optional stage elements, including the retained
  dormant instrumental-break graphic source. The source remains available for
  future exploration, but no arbitrary stage-element authoring workflow is
  planned. Styling the built-in MVP title card, footer, and Stage frame does not
  create such a workflow.

## Decision gates

Before assigning a roadmap item to a release, document:

1. The editing problem it solves and evidence that the problem is real.
2. The minimum interaction that solves it.
3. Project-format impact and compatibility or migration requirements.
4. Export-format, codec, rights, and licensing implications.
5. Automated and hands-on acceptance checks.
6. Packaging, security-update, and ongoing maintenance burden.

`Later` means a feature remains eligible for evaluation. `Not planned` means it is
outside the core product boundary and requires an explicit scope decision before
implementation.
