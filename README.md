# Okay Karaoke Studio

Okay Karaoke Studio is a single-window desktop editor for turning a backing
track and plain lyrics into timed karaoke lyrics and a finished MP4 video. Live
Preview, Lyric Timing, project settings, and playback stay together while you
work.

Version 0.1 is still an MVP. Product acceptance remains open until the user
makes and accepts a karaoke video for a new song with the Studio. See the active
[`docs/MVP.md`](docs/MVP.md) contract for the current scope.

## Before you launch

You need Node.js 24 LTS or newer and Bun 1.3.14 or newer. The Bun version used
for the lockfile is pinned in [`package.json`](package.json).

MP4 export also requires a locally installed FFmpeg with both the `libx264` and
AAC encoders. The desktop app verifies those capabilities before asking for an
export destination. If FFmpeg is unavailable, the app can offer to install the
Gyan FFmpeg package through an existing WinGet on Windows or the `ffmpeg`
formula through an existing Homebrew on macOS, after you confirm. It never
installs Homebrew, runs a Linux package manager, or bundles the FFmpeg
command-line encoder. Manual and system installations remain supported; set
`OKAY_KARAOKE_FFMPEG` to use a specific executable.

## Launch from source

```bash
bun install --frozen-lockfile
bun run dev
```

`bun run dev` opens the Electron desktop app and starts its Vite renderer. To
run only the browser-based renderer fallback, use:

```bash
bun run dev:web
```

## Start a project

First launch and **New project** open an untitled clean slate with one empty
lead-vocal track. No example title, artist, lyrics, timing, or media is added.
Use **Open project** to reopen an existing `.oks` file, or choose **Workflow** in
the top bar for the in-app first-project guide.

> **Current v0 format:** this clean-slate pre-v1 build writes and accepts only
> the current `.oks` format with numeric `schemaVersion: 0`. It has no migration
> or compatibility path for any other `.oks` format, so development projects
> may stop opening in a later pre-v1 build.

## Make your first karaoke video

1. **Describe the song and attach audio.** Enter the title and artist in **Song
   details**. Choose **Attach an audio file** under **Backing track**, then select
   an MP3, WAV, M4A, FLAC, AAC, or OGG file. The Studio links the file in place;
   it does not copy the audio into the project.

2. **Add lyrics.** Choose **Edit text** in Live Preview, paste one lyric line per
   row, and keep blank rows between sections. A slash marks a visible syllable
   break, so `nev/er` displays as `nev·er`. Choose **Apply lyrics** to keep the
   edit or **Cancel** to leave the project unchanged. You can instead use
   **Import LRC lyrics** to import line-timed or enhanced LRC into the active
   track.

3. **Synchronize the words.** Move the playhead to the desired starting point
   and choose **Start sync** in Lyric Timing or the playback bar. Live Preview is
   replaced by Sync Focus, which shows the current and next lyric lines. Press
   Space at each word onset. Each new onset on the same line closes the previous
   word; hold Space through the final word of a line to extend its duration.
   Taps before lyric time `0:00` are ignored, and timing cannot cross the
   preceding or following timed word in lyric order, including across line
   boundaries. Press Escape to leave synchronization and restore Live Preview.

4. **Correct the timing.** Select words in Lyric Timing, drag blocks to move
   them, or drag either edge to resize them. Changes stop at adjacent timed words
   in lyric order. Drag across empty Lyric Timing space for a marquee selection,
   or use Command/Ctrl+A outside a text field to select the active track. Use
   **Clear timing** to clear the active track or **Clear from cursor** to clear
   timings beginning at or after the playhead. Synchronization is one undoable
   history step; individual corrections are undoable edits.

5. **Verify and style the result.** In Live Preview, set **Lines** to 1 through 5
   and choose **Clear** or **Scroll** under **Advance**. Those settings also
   govern MP4 output. Blank lyric rows keep sections separate, and the Studio
   does not add an automatic Instrumental graphic between sections.

   Choose **Style** beside the Okay Karaoke Studio identity. The current editor
   destinations are **Project lyrics**, **Background**, **Title card**, and
   **Stage frame**. Project lyrics controls the default typeface, style, size,
   and sung and unsung colors. Background currently supports editable **Solid**
   and **Gradient** colors; linked **Image** settings remain preserved but are
   not yet authorable or Live Preview/MP4-ready in this destination. Title card
   edits the independent Eyebrow, Title, and Artist roles. Stage frame controls
   the frame's master visibility and its independent Brand, Clock, and Footer
   roles. Changes appear in the fixed 1920 × 1080 Design preview. Choose
   **Apply & close** to create one undoable project edit or **Cancel** to discard
   the draft.

6. **Save the editable project.** Choose **Save project** in the top bar or use
   Command/Ctrl+S. A new project opens the native save dialog; **Save As** is
   also available from the File menu. The current v0 `.oks` file saves lyrics,
   blank-row section breaks, timing, display and style settings, metadata, and
   linked-media paths.

7. **Export the result.** Choose **Export** in the top bar. The export dialog
   offers Enhanced LRC for the active track, ASS karaoke subtitles, a finished
   MP4 karaoke video, and another editable `.oks` project. Review any reported
   timing issues before handing off the result.

   MP4 export requires lyrics and attached audio, is limited to 30 minutes and
   the active lead-vocal track, and produces H.264/AAC video. Resolution choices
   are 240p (426 × 240), 360p (640 × 360), 480p (854 × 480), 720p (1280 × 720),
   1080p (1920 × 1080), 1440p (2560 × 1440), and 2160p (3840 × 2160), each at 30
   or 60 fps. A new export defaults to 720p at 30 fps. Closing the export dialog,
   closing or quitting the app, or choosing **Cancel video export** during an
   active export asks for confirmation. Confirmed cancellation preserves a
   UUID-named partial file beside the chosen destination; ordinary export
   failures leave the chosen destination safe.

## Keyboard controls

| Key | Action |
|---|---|
| Space                    | While synchronization is armed, key-down starts the current word, the next same-line onset closes the preceding word, and key-up extends the final word of a line. Taps before lyric time `0:00` are ignored; bare Space never controls playback. |
| Shift + Space            | Play or pause.                                                                                                                                                                                                                                    |
| Escape                   | Exit synchronization and restore Live Preview; cancel an open Style edit.                                                                                                                                                                         |
| Left / Right             | Move the playhead by 250 ms.                                                                                                                                                                                                                      |
| Shift + Left / Right     | Move the playhead by 1 second.                                                                                                                                                                                                                    |
| Delete / Backspace       | Clear timing from selected words.                                                                                                                                                                                                                 |
| Command/Ctrl + A         | Select every word in the active track when not editing text.                                                                                                                                                                                      |
| Command/Ctrl + Z         | Undo.                                                                                                                                                                                                                                             |
| Shift + Command/Ctrl + Z | Redo.                                                                                                                                                                                                                                             |
| Command/Ctrl + N         | Start a new project.                                                                                                                                                                                                                              |
| Command/Ctrl + O         | Open a project.                                                                                                                                                                                                                                   |
| Command/Ctrl + S         | Save the project.                                                                                                                                                                                                                                 |
| Shift + Command/Ctrl + S | Save the project as a new `.oks` file.                                                                                                                                                                                                            |
| Shift + Command/Ctrl + A | Import audio.                                                                                                                                                                                                                                     |
| Shift + Command/Ctrl + L | Import LRC lyrics.                                                                                                                                                                                                                                |
| Shift + Command/Ctrl + E | Open Export.                                                                                                                                                                                                                                      |

## Distribution status

`bun run dist` creates distributable macOS artifacts, but public distribution
still requires signing and notarization credentials. The app currently uses an
external FFmpeg installation and does not redistribute the encoder; whether to
redistribute FFmpeg with a documented compatible build and compliance plan
remains a separate user-held decision.

## Project and contributor documentation

The active product contract is in [`docs/MVP.md`](docs/MVP.md), and deliberately
deferred ideas are in [`docs/ROADMAP.md`](docs/ROADMAP.md). Setup, build, test,
and contribution guidance is in [`CONTRIBUTING.md`](CONTRIBUTING.md). Repository
architecture and safety boundaries are in [`AGENTS.md`](AGENTS.md), and the
branch, review, CI, and release process is in [`docs/SDLC.md`](docs/SDLC.md).

## License

Copyright © 2026 Okay Karaoke Studio contributors.

Okay Karaoke Studio is free software: you can redistribute it and/or modify it
under the terms of the GNU General Public License as published by the Free
Software Foundation, either version 3 of the License, or (at your option) any
later version.

Okay Karaoke Studio is distributed in the hope that it will be useful, but
WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or
FITNESS FOR A PARTICULAR PURPOSE. See [`LICENSE`](LICENSE) for the complete
license terms. The SPDX identifier is `GPL-3.0-or-later`.
