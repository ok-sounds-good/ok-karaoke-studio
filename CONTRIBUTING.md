# Contributing

Okay Karaoke Studio keeps `main` green and releasable while version 0.1 product
acceptance remains open and user-held. Read the active
[`docs/MVP.md`](docs/MVP.md) contract, the prioritized
[`docs/ROADMAP.md`](docs/ROADMAP.md), and the
[`docs/SDLC.md`](docs/SDLC.md) change policy before starting nontrivial work.

## Local setup

```bash
bun install --frozen-lockfile
bun run test
bun run build
```

Use a short-lived branch from current `main` and open a pull request. The pull
request should explain the problem, intended scope, verification, risks, data or
export-format impact, and what was deliberately left out. For MVP work, identify
the real-song workflow blocker being addressed and call out any supporting
criterion that the evidence adds, removes, or revises.

Run `bun run dist:dir` for Electron or packaging changes. Run the gated
`bun run test:video` smoke test for video, audio-muxing, or media-process changes;
it requires Electron, FFmpeg, and FFprobe. Visual changes also run
`bun run test:visual` after `bun run build`; its real Electron window may require
a desktop session and writes only public capture-boundary UI screenshots and
aggregate metadata. A configured evidence path must not already exist; completion
is indicated by the `result.json` or `failure.json` file written last.
The `macOS` and `Windows` CI jobs install FFmpeg, verify `libx264` and AAC, run
font and visual smoke tests, upload the visual evidence for 14 days, exercise the
representative video smoke, and package the unpacked application.

## Maintainability guidance

Readability and single responsibility matter more than a mechanical line count.
For TypeScript, TSX, and CommonJS modules, aim for roughly 100–300 lines and
prefer 80–120-character lines. Crossing 500 lines is a prompt to review the
file's responsibilities and look for cohesive components, hooks, domain helpers,
or test utilities to extract; it is not an automatic failure when the file still
represents one clear concept.

Keep rendering, state orchestration, data transformation, and process-boundary
code separate when those responsibilities can be named and tested independently.
Prefer focused new test modules over adding unrelated scenarios to an already
large suite. Any exception should remain easy to understand in one sitting and
have a cohesive reason to stay together.

Renderer UI colors come from the custom properties in `src/styles.css`, with the
active product-theme overrides in `src/identity.css`. New component CSS should
consume those variables instead of introducing UI palette literals in TS/TSX.
Keep editor controls in `src/video-style.css` and Preview-stage rendering in
`src/stage-rendering.css`; neither stylesheet should introduce its own UI palette.
Colors that are saved into a karaoke project are media settings rather than app
chrome; keep their initial values centralized in `DEFAULT_STAGE_STYLE` so Live
Preview, persistence, and MP4 export share one source of truth.

## Maintainability guidance

Readability and single responsibility matter more than a mechanical line count.
For TypeScript, TSX, and CommonJS modules, aim for roughly 100–300 lines and
prefer 80–120-character lines. Crossing 500 lines is a prompt to review the
file's responsibilities and look for cohesive components, hooks, domain helpers,
or test utilities to extract; it is not an automatic failure when the file still
represents one clear concept.

Keep rendering, state orchestration, data transformation, and process-boundary
code separate when those responsibilities can be named and tested independently.
Prefer focused new test modules over adding unrelated scenarios to an already
large suite. Any exception should remain easy to understand in one sitting and
have a cohesive reason to stay together.

Renderer UI colors come from the custom properties in `src/styles.css`, with the
active product-theme overrides in `src/identity.css`. New component CSS should
consume those variables instead of introducing UI palette literals in TS/TSX.
Keep editor controls in `src/video-style.css` and Preview-stage rendering in
`src/stage-rendering.css`; neither stylesheet should introduce its own UI palette.
Colors that are saved into a karaoke project are media settings rather than app
chrome; keep their initial values centralized in `DEFAULT_STAGE_STYLE` so Live
Preview, persistence, and MP4 export share one source of truth.

Do not attach copyrighted songs, lyrics, or media to public issues or pull
requests. Use a minimal synthetic project or redacted `.oks` example when a
reproduction is needed.
