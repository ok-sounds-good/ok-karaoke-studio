# Okay Karaoke Studio — MVP Definition

## Product promise

Okay Karaoke Studio is a desktop editor for turning a backing track and plain lyrics into precisely timed karaoke lyrics. It keeps the stage preview, lyric editor, timing board, project settings, and playback controls in **one unified window**.

This document is the active product-acceptance contract for version 0.1. The
supporting criteria below may change as real editing work exposes blockers;
capabilities that are deliberately deferred belong in
[`ROADMAP.md`](./ROADMAP.md).

## Acceptance status and scope control

- **Product acceptance: open.** The user holds the gate until they can use the
  Studio to make a karaoke video for a new song.
- **Passing evidence:** the user completes that real-song workflow in the Studio
  and accepts the resulting video. A synthetic fixture, demo project, automated
  export, or maintainer walkthrough cannot close the gate on the user's behalf.
- **Flexible supporting scope:** features and codified behaviors may be added,
  removed, or revised when the attempt identifies a blocker or shows that a
  criterion does not serve the primary gate. Record the observation and the
  resulting contract change so the decision remains auditable.
- **Technical baseline:** every iteration must leave `main` green and releasable.
  Passing CI or producing a package is required engineering evidence, but is not
  equivalent to product acceptance.

## Primary user journey

1. Launch into a clean-slate project, or open an existing `.oks` project.
2. Attach an audio backing track.
3. Paste lyrics or import an LRC file.
4. Press and hold Space with the singer to time each word.
5. Correct individual words by dragging and resizing them in the TimeBoard.
6. Preview the result continuously without opening another window.
7. Save the editable project and export LRC, ASS, or a finished MP4 karaoke video.

## Single-window layout invariant

The main window must always provide simultaneous access to:

- Project metadata and vocal-track controls.
- A live karaoke stage preview.
- The active track's lyric lines and word state.
- A scrollable waveform TimeBoard.
- Playback, seeking, speed, volume, zoom, and tap-sync controls.

Focused overlays are permitted for short, transactional tasks such as pasting raw lyrics or choosing an export format. The preview, editor, and transport must never become separate application windows.

## In scope

### Projects and media

- New, open, save, and save-as for versioned `.oks` JSON project files.
- Link MP3, WAV, M4A, FLAC, AAC, or OGG audio without copying it into the project.
- Display the decoded waveform when possible, with a deterministic placeholder before audio is attached.
- Song title, artist, global timing offset, audio path, and duration metadata.
- First launch and **New Project** create a clean slate: one empty **Lead Vocal**
  track is permitted, but no example title, artist, lyrics, timing, or media is
  populated.
- `createDemoProject` is retained only as an explicitly invoked development,
  debugging, or test fixture. It must not supply startup state, the **New
  Project** action, a packaged user workflow, or fallback data after a load
  failure.

### Lyrics and vocal tracks

- One lead track and one optional duet track with independent names and colors.
- Paste or edit lyrics as lines of plain text.
- Treat `/` as a visible syllable boundary (`·`) while preserving the source token.
- Warn when a line is likely to exceed the title-safe preview width.
- Import line-timed or enhanced LRC into the active track.
- Clear timing without deleting lyrics.

### Synchronization and TimeBoard

- Tap-sync mode in which Space key-down sets a word start and key-up sets its end.
- Start or resume synchronization from the current playhead.
- A visible next-word cursor and timed/untimed progress.
- TimeBoard-native controls for **Start Sync**, **Clear Timing**, and **Clear
  Timing After Cursor**. Clear operations affect timing in the active track,
  preserve lyric text, and participate in undo/redo.
- Click the ruler or waveform to seek.
- Drag timed words or a multi-word selection to move them.
- Drag word edges to change start or end times.
- Select words from the lyric list or TimeBoard.
- Outside a text-editing field, Command/Ctrl+A selects every word in the active
  track instead of selecting page text.
- Dragging across empty TimeBoard space draws a visible marquee and selects the
  active track's intersecting word blocks.
- Word text is rendered separately from duration-sized timing blocks. Full
  labels remain readable without ellipses, and deterministic vertical lanes keep
  adjacent labels and timing blocks from overlapping.
- The timeline navigation group is ordered **Jump to start (`|<`)**, **Scroll
  backward (`<`)**, **Scroll forward (`>`)**. Each action has an unambiguous
  accessible name and hover description.
- Keyboard delete clears selected words' timing, Escape exits sync, and timing
  selection and clear operations participate in undo/redo.
- Zoom and horizontal scrolling suitable for detailed timing correction.

### Preview and transport

- Progressive word highlighting driven by the same authoritative playback clock as the editor.
- Display both active voices during duet passages.
- Title card, instrumental state, upcoming line, safe-area guide, and current time.
- Play/pause, Stop, short skip backward/forward, playback speed, volume, playhead
  time, and duration. Stop pauses playback and returns the playhead to project
  time `0:00`.
- Outside text-editing fields, bare Space is reserved for key-down/key-up lyric
  synchronization while Tap Sync is armed and never toggles playback.
  Shift+Space toggles playback.
- Fallback-clock playback when no audio is attached so timing interactions can
  still be exercised without loading the development demo fixture.

### Save and export

- Save all lyric text, word timings, track styling, media linkage, and metadata in `.oks`.
- Export the active vocal track as LRC.
- Export the project as ASS with karaoke timing tags.
- Render a 1080p MP4 up to 30 minutes from the built-in stage design, up to two vocal tracks, and linked backing track through a locally installed FFmpeg executable.
- Show frame-rendering and encoding progress, and fail without leaving a partial destination file when video requirements are unavailable.
- Validate and report untimed, invalid, or overlapping timing before export.
- Browser fallbacks for open/download when the React surface is run outside Electron.

### Quality bar

- Electron desktop shell with a constrained preload bridge and no renderer Node access.
- Responsive down to a 1280 × 720 application window; optimized for larger desktop displays.
- Complete keyboard focus states, accessible labels for icon-only actions, and
  adequate contrast.
- Icon-only and compact controls expose concise hover help that names the action
  and, when applicable, its keyboard shortcut.
- Unit tests for project parsing, lyric parsing, timing validation, and LRC/ASS round trips.
- Unit tests for video frame planning plus the gated `bun run test:video` H.264/AAC export smoke check.
- Clean TypeScript build, production Vite build, and launchable unpacked desktop package.

## Explicitly out of scope for 0.1

- Automatic transcription or word alignment.
- Stem separation or vocal removal.
- MIDI/KAR playback and lead-vocal-note mapping.
- CDG authoring or MP3+G export.
- Background image scheduling.
- Automatic linguistic hyphenation.
- Embedded audio, cloud sync, collaboration, show rotation, or a singer-facing second display.

## Product acceptance checklist

- [ ] The user makes and accepts a karaoke video for a new song using the Studio.
- [ ] Launch and **New Project** start with a clean slate; the development demo is
  never introduced implicitly.
- [ ] The primary journey can be completed without leaving the main window.
- [ ] A saved project reopens with identical metadata, tracks, lyrics, and timings.
- [ ] TimeBoard-native start, clear-all, and clear-after-cursor actions operate on
  the active track without deleting lyrics.
- [ ] Bare Space times words only while synchronization is armed; Shift+Space
  controls playback.
- [ ] Command/Ctrl+A and marquee selection select the intended active-track words
  without selecting page text.
- [ ] Full word labels and duration blocks remain readable and non-overlapping in
  deterministic TimeBoard lanes.
- [ ] Timeline navigation, transport Stop, and hover help are discoverable and
  behave as labeled.
- [ ] Timeline movement and resize operations immediately affect the live preview.
- [ ] LRC and ASS exports contain monotonic, non-negative timing.
- [ ] Undo and redo cover lyric replacement, timing edits, and timing clears.
- [ ] Required tests, builds, packages, and platform CI are green for the final
  acceptance candidate.
- [ ] A linked-audio project renders a 1920 × 1080 H.264/AAC MP4 with synchronized
  lyric frames.
- [ ] The final UI is visually checked at the working desktop size and the minimum
  supported 1280 × 720 window.
