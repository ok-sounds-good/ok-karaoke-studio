# Okay Karaoke Studio

Okay Karaoke Studio is a single-window desktop application for editing and
synchronizing karaoke lyrics. It combines a verification-focused stage preview,
transactional lyric editor, waveform TimeBoard, project inspector, and playback
transport in one workspace.

![Status](https://img.shields.io/badge/status-MVP%20acceptance%20open-d7fa4a?labelColor=171e1b)
![Electron](https://img.shields.io/badge/Electron-desktop-58d6de?labelColor=171e1b)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-ff8064?labelColor=171e1b)

## MVP highlights

- Unified viewer, editor, timeline, inspector, and playback controls—no detached
  production windows. Armed synchronization replaces the stage with a
  lightweight current/next-line Sync Focus, then restores it for verification.
- Clean-slate startup with one empty lead-vocal track and no implicit example content.
- One lead-vocal authoring track for the active MVP; adding singer tracks is
  deferred.
- Low-latency Spacebar onset synchronization: each same-line onset closes the
  previous word, while holding the final word of a line extends it. Shift+Space
  controls playback.
- Live karaoke preview and MP4 output share a persisted 1-to-5 line count and
  Clear/Scroll advance mode, blank lyric rows separating sections, and the same
  per-word timing and purple/orange production palette. Per-word color is the
  lyric progress signal; stage lyric lines do not repeat the singer or track
  name, and section gaps do not inject an automatic Instrumental graphic.
- Draggable, resizable word blocks on a common chronological baseline, readable
  staggered label lanes, range selection, and timing controls on a zoomable
  waveform TimeBoard. Timing edits cannot cross the preceding or following
  timed word in lyric order, including across line boundaries.
- Live Preview's single **Edit text** action opens raw lyric editing with
  syllable separators, preserved blank-row section breaks, and screen-fit
  guidance; TimeBoard does not duplicate it, and no Word Map is persistently
  rendered in the main workspace.
- LRC import, enhanced LRC and ASS export, configurable 240p-through-2160p MP4
  karaoke rendering at 30 or 60 fps, and versioned `.oks` projects.
- Native open/save/import/export dialogs with secure linked-media streaming.
- Command history, timing review, hover help, playback Stop, and browser fallback.

The version 0.1 product-acceptance gate remains open until the user makes and
accepts a karaoke video for a new song with the Studio. Supporting criteria can
change when that real workflow exposes a blocker, while every iteration must
leave `main` technically green and releasable. The active contract is in
[`docs/MVP.md`](docs/MVP.md); deliberately deferred ideas are in
[`docs/ROADMAP.md`](docs/ROADMAP.md).

Changes follow the lightweight, green-`main` workflow in
[`docs/SDLC.md`](docs/SDLC.md). Contribution setup and verification expectations
are in [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Run locally

Requirements: Node.js 24 LTS or newer and Bun 1.3.14 or newer. The exact Bun
version used for the lockfile is pinned in `package.json`.

MP4 export additionally requires FFmpeg with the `libx264` and AAC encoders. The
desktop app checks this before asking for an export destination. If FFmpeg is
missing, it can install the Gyan FFmpeg package through an existing WinGet on
Windows or the `ffmpeg` formula through an existing Homebrew on macOS, after
explicit confirmation. It never installs Homebrew, runs Linux package managers,
or bundles the FFmpeg command-line encoder. Manual and system installations remain
supported; set `OKAY_KARAOKE_FFMPEG` to use a specific executable. Video rendering
is currently limited to 30 minutes and the active lead-vocal track.

```bash
bun install --frozen-lockfile
bun run dev
```

`bun run dev` opens the Electron app and starts its Vite renderer. Bun manages
dependencies and launches scripts; Electron, Vite, Vitest, and TypeScript retain
their existing runtimes and responsibilities. For renderer-only work:

```bash
bun run dev:web
```

## Build and test

```bash
bun run test
bun run build
bun run test:fonts
bun run test:visual
bun run dist:dir
# Requires Electron, FFmpeg, and FFprobe:
bun run test:ffmpeg
bun run test:video
```

- `bun run test` runs project-model and strict current-schema coverage,
  synchronization semantics/history, preview/video display planning, validation,
  LRC, ASS, and renderer tests through Vitest.
- `bun run build` performs a strict TypeScript check and production renderer build.
- `bun run test:fonts` loads that production renderer through the packaged
  `studio-app://app` origin, privately loads one installed face in both the
  renderer and sandboxed video-rendering document, and reports only aggregate
  evidence.
- `bun run test:visual` drives the production desktop renderer at an exact
  1280 x 720 content size and writes three ordered PNGs plus hashed result
  metadata. The font screenshot uses the production React `FontSelector` with a
  fixed public-only System-font state; installed font names remain hidden behind
  a fail-closed capture boundary. Set `OKS_VISUAL_SMOKE_OUTPUT` to
  a path that does not exist yet, or omit it for a unique temporary path. The
  smoke never replaces an existing path, and publishes `result.json` or
  `failure.json` last as the completion marker.
- Both desktop smoke launchers retain their identity-verified browser profiles
  under the operating system's temporary directory. This avoids a pathname-swap
  race inherent in recursive cleanup; hosted runners discard the temporary data,
  and public smoke output never includes the absolute profile path.
- `bun run dist:dir` creates an unpacked desktop application in `release/`.
- `bun run dist` creates distributable macOS artifacts. Public distribution still
  requires signing and notarization credentials.
- `bun run test:ffmpeg` verifies that the discovered FFmpeg provides `libx264`
  and AAC, rather than checking only for an executable.
- `bun run test:video` performs representative 240p/30 fps and 360p/60 fps
  H.264/AAC renders, strict two-stream metadata inspection, exporter-result and
  frame-transition checks, ordinary FFmpeg failure atomicity, and a readable
  cancellation partial. The complete resolution/rate matrix remains a separate
  MVP gate.

## Editing workflow

1. Launch into the clean-slate project, choose **New Project** for another clean
   slate, or open an existing `.oks` project.
2. Choose **Attach an audio file** and select the backing track.
3. Choose **Edit text** in Live Preview to paste one lyric line per row,
   retaining blank rows between lyrical sections, or import an LRC into the
   active track. Applying the dialog replaces the active track's text;
   cancelling leaves it unchanged.
4. In Live Preview, choose 1 through 5 visible lyric lines and either **Clear**
   or **Scroll** advance behavior. These project settings also govern MP4 output.
5. Move the playhead to the desired start and choose **Start Sync** in the
   TimeBoard. Live Preview is suspended and a lightweight Sync Focus shows the
   current and next lyric lines in cursor order.
6. Press Space at each word onset. A new onset on the same line backfills the
   preceding word's end; hold the final word of a line until its sung end. The
   resulting timing remains bounded by the preceding and following timed words
   in lyric order, even across line boundaries. The authoritative playback
   clock supplies timestamps, and taps before lyric time `0:00` are ignored.
   Press Escape to finish the synchronization session and restore Live Preview.
7. Verify timing in Live Preview, then select words in the TimeBoard.
   Command/Ctrl+A selects the active track outside text fields; dragging across
   empty TimeBoard space creates a marquee selection. Drag blocks to move timing
   and drag either edge to resize; moves and resizes stop at the adjacent timed
   words in lyric order, including across line boundaries. A synchronization
   session is one undoable history step; individual TimeBoard corrections remain
   undoable edits.
8. Use the TimeBoard's **Clear Timing** or **Clear Timing After Cursor** controls
   when resynchronizing. Use transport **Stop** to pause and return to `0:00`.
9. Choose **Style** in the Project header to edit the stage without leaving the
   unified window. Configure a solid, gradient, or linked-image background;
   project lyric defaults; title-card and Stage-frame roles; and vocal overrides,
   preview time, and sync aid. **Apply & close** commits the complete style draft
   as one undoable project edit. **Cancel** leaves the canonical project style
   unchanged. Typeface, Style, and Size inherit independently. The installed-font
   selector previews each selected face and reports its deterministic fallback
   when the face is unavailable; opening it or changing only Size does not change
   the selected Typeface or Style. Searching does not preview an uncommitted
   result, and a changed installed family catalog is used only after an explicit
   Typeface choice.
10. Review the timing and style, save the current-format `.oks` project, and
   export LRC, ASS, or an MP4 karaoke video. Video export requires attached audio
   and offers these presets: 240p (426 x 240), 360p (640 x 360),
   480p (854 x 480), 720p (1280 x 720),
   1080p (1920 x 1080), 1440p (2560 x 1440), and 2160p (3840 x 2160), each at
   30 or 60 fps. It defaults to 720p at 30 fps for faster iteration. Closing the
   export dialog, closing the application, quitting, or choosing Cancel during an
   active export asks for confirmation; a confirmed cancellation preserves a
   UUID-named partial file beside the destination. A missing linked background
   image, or one that Electron cannot decode as a static image, blocks MP4
   export until it is replaced, cleared, or no longer selected.
   A missing local font remains selected and uses the same named fallback in
   Live Preview and MP4 output.

## Keyboard controls

| Key | Action |
|---|---|
| Space | Time words in Tap Sync; key-up extends the line's final word. Ignored before lyric time `0:00`; never controls playback |
| Shift + Space | Play/pause |
| Escape | Exit Tap Sync or back/cancel Video style; changed drafts ask before discard |
| Arrow keys / Home / End | Move through Video style sections while their navigation has focus |
| Left / Right | Nudge playhead by 250 ms |
| Shift + Left / Right | Nudge playhead by 1 second |
| Delete / Backspace | Clear timing from selected words |
| Command/Ctrl + A | Select every word in the active track when not editing text |
| Command/Ctrl + Z | Undo |
| Shift + Command/Ctrl + Z | Redo |
| Command/Ctrl + S | Save project |
| Command/Ctrl + O | Open project |

## Project structure

```text
electron/              Secure Electron main process and preload bridge
src/
  components/          Unified workspace panels, dialogs, and transport
  hooks/               Audio playback and waveform decoding
  lib/                 Project model, current-format decoding, validation, LRC, and ASS
  App.tsx               Application state, commands, sync, and file workflows
tests/                  Pure model and interchange tests
docs/MVP.md             Active version 0.1 product-acceptance contract
docs/ROADMAP.md         Prioritized future capabilities and product boundaries
docs/SDLC.md            Pull-request, verification, ruleset, and release policy
```

The current clean-slate v0 schema stores integer-millisecond word timings,
blank-row section separators, shared Live Preview/MP4 lyric-display settings,
and the complete persisted video style. Font choices store a typeface and its
real enumerated face catalog separately from the selected face and size; no font
bytes or synthesized PostScript names are stored. Pre-v1 `.oks` artifacts from other MVP
iterations are rejected clearly instead of migrated. The active MVP authors one
lead track; adding new singer tracks remains deferred. The renderer does not
receive Node.js access. Electron exposes a small typed bridge for project dialogs,
linked audio and background-image capabilities, installed-font permission,
text/video export, lifecycle coordination, and menu commands. Linked media is
served through owner-scoped, tokenized read-only capabilities. A relative audio
path stays relative in the saved `.oks`; playback and MP4 export retain the
owner-scoped canonical path resolved from that project's location instead of
resolving the saved value against the process working directory. MP4 export renders
the same line-selection and stage-style plan as Live Preview in an isolated
offscreen Electron surface. It renders target-resolution, selected-rate unique
frames, waits for each requested compositor paint, streams backpressured JPEGs
into a shell-free FFmpeg process, and uses a faster `libx264` preset for H.264/AAC
encoding. Ordinary failures leave the chosen destination safe. Confirmed
cancellation terminates the encoder and preserves any partial output under a
UUID-based filename beside that destination.

## License

MIT. See [`LICENSE`](LICENSE).
