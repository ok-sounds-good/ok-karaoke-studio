# Contributing

Okay Karaoke Studio keeps `main` green and releasable while version 0.1 product
acceptance remains open and user-held. Read only the guidance relevant to the
change: [`docs/MVP.md`](docs/MVP.md) for product behavior,
[`docs/ROADMAP.md`](docs/ROADMAP.md) for scope and priorities, and
[`docs/SDLC.md`](docs/SDLC.md) for pull-request and release work.

## Local setup

```bash
bun install --frozen-lockfile
bun run test
bun run build
```

Run focused checks while working and the applicable regression gates before
handoff. Hosted GitHub Actions checks are merge gates, not substitutes for
required local manual, visual, package, or media validation.

Use a short-lived branch from current `main` and open a pull request. The pull
request is the durable audit trail: explain the problem, scope, progress,
verification, review decisions, risks, and deliberate exclusions. Link an Issue
when one is useful; one is not required for every change.

Run `bun run format` before validation. It applies the pinned formatter only to
the changed Git hunks, expanding to the enclosing syntax structure when
Prettier requires it. `bun run format:check` validates that same range contract
without rewriting files; CI supplies the pull-request or push base commit. The
range ratchet intentionally leaves untouched legacy lines alone and stops
without writing if it cannot isolate a safe structural expansion. Use the
full-repository `bun run format:all` only for a dedicated, behavior-neutral
formatting change.
The checked-in `.codex/hooks.json` runs the same formatter after Codex writes;
it requires normal project-hook trust, not a separate user hook.

Run `bun run dist:dir` for Electron or packaging changes. Run the gated
`bun run test:video` smoke test for video, audio-muxing, or media-process changes;
it requires Electron, FFmpeg, and FFprobe.

## Maintainability guidance

Readability and cohesive responsibility matter more than mechanical line or
word counts. Split code when the resulting components, hooks, domain helpers, or
test utilities have clear ownership and can be understood and tested separately.

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
