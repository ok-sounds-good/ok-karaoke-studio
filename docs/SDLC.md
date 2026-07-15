# Software Development Lifecycle

`main` is the technically green, releasable baseline. Version 0.1 product
acceptance remains open and is held by the user until they make and accept a
karaoke video for a new song with the Studio. The purpose of this process is to
preserve that technical baseline while making product and technical decisions
easy to audit.

## Authoritative contracts and checkpoints

The copies of `docs/MVP.md`, `docs/SDLC.md`, and `docs/ROADMAP.md` on `main` are
authoritative. A checkpoint or extraction branch is implementation evidence and
a source of tested code; its documentation never overrides newer decisions on
`main`.

Before extracting implementation from a checkpoint, bring the authoritative
documents from `main` into that checkpoint with `main` winning every
documentation conflict. Start each delivery slice from current `main` and port
only the cohesive implementation and tests that belong to that slice. Do not
merge a checkpoint wholesale merely because its integrated test suite passed.

## Change flow

1. Start nontrivial work from an observed MVP workflow blocker, a roadmap item,
   or an issue with acceptance criteria.
2. Create a short-lived branch from current `main`. Use a descriptive prefix such
   as `feature/`, `fix/`, `docs/`, or `chore/`.
3. Open a draft pull request early. Keep unrelated changes in separate pull
   requests. Aim for 750–1000 changed lines, counting additions and deletions,
   so an adversarial reviewer can understand the complete diff. This is a soft
   limit: a documented invariant class may exceed it when splitting schema,
   trust-boundary, persistence, or renderer/export parity changes would make the
   result less safe or less reviewable.
   Formatting never counts as a way to meet this target. A dedicated
   whole-repository formatter pass may receive a complete-invariant exception
   only after full behavior-preservation gates and an independent adversarial
   review find no formatting-induced semantic change.
4. Record scope, tests, manual checks, project-format impact, export or licensing
   impact, and deliberate exclusions in the pull request. For MVP work, record
   the observation from the real-song attempt and any supporting contract
   criterion added, removed, or revised.
5. Prefer a sequence of cohesive **Foundation**, **Behavior**, and **Hardening**
   pull requests. Minimize duplicated invariants and cross-module dependencies;
   never split a security or data-integrity invariant solely to satisfy the line
   target.
6. Obtain an independent adversarial review using the reachability and finding
   contract in [`REVIEWING.md`](./REVIEWING.md). A confirmed finding remains a
   merge blocker until it is fixed or the maintainer explicitly accepts it with
   a linked GitHub issue created before merge. Merge only after the review
   passes, the required macOS and Windows CI checks pass, and all review
   conversations are resolved.
7. Squash merge, delete the branch, and leave `main` green and releasable.

One human approval becomes required when a second maintainer is reliably available.
Until then, pull requests still provide the change record, while a zero-approval
requirement avoids a solo maintainer deadlock.

## Definition of done

A change is done when:

- Task acceptance criteria are met. Any supporting MVP scope change is explicit,
  evidence-backed, and tied to the user-held product gate.
- `bun run test` and `bun run build` pass.
- `bun run dist:dir` passes when Electron, packaging, preload, or main-process code
  changes.
- The final Windows MVP candidate produces an unsigned x64 NSIS installer and
  unpacked app in Windows CI, launch-smokes the package, and runs the applicable
  font, visual, project, and H.264/AAC media gates.
- `bun run test:video` passes when video rendering, audio muxing, frame planning,
  or media-process code changes.
- User-visible behavior is checked manually; visual changes include before/after
  evidence in the pull request. For Video Style Editor changes, the protected
  macOS and Windows jobs also capture ordered 1280 x 720 production-window
  evidence; inspect those short-lived artifacts rather than treating a passing
  geometry assertion as a design review.
- During the clean-slate pre-v1 MVP, project-schema changes include exhaustive
  current-format round-trip coverage and clear rejection of unsupported earlier
  artifacts. Migration coverage becomes required once the product promises
  compatibility with a prior format.
- Format or export changes include fixtures, validation, and licensing notes.
- The public-distribution license and any FFmpeg redistribution policy remain
  user-held decisions. Do not change license files, package metadata, or bundled
  binary policy without explicit user direction.
- Documentation and the relevant release or roadmap status are updated.
- Every accepted review residual links to its GitHub issue, and that issue
  records its finding class and class-specific evidence, impact, deferral
  rationale, and closure criteria.

## Recommended `main` ruleset

Create one repository branch ruleset named `protect-main` in **Settings → Rules →
Rulesets**. Target the default branch and set enforcement to **Active**. The
required check names are `macOS` and `Windows`; use a protected pull request to
confirm enforcement.

Configure:

- Restrict deletions.
- Block force pushes.
- Require a pull request before merging. Use zero required approvals when there
  is no reliable second maintainer; otherwise require one approval.
- Require all conversations to be resolved.
- Require the existing `macOS` and `Windows` status checks.
- Require branches to be up to date before merging.
- Require linear history and squash merges.
- Do not grant Write or Maintain roles a bypass. If an emergency escape hatch is
  necessary, grant repository administrators **For pull requests only** so the
  exception still leaves a pull request and audit trail.

Also enable squash merging and automatic head-branch deletion in the repository's
pull-request settings. Do not add signed-commit, merge-queue, deployment, code-owner,
or coverage gates until the project has the people and stable automation to support
them.

GitHub documents ruleset availability and layering in [About
rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets),
the setup and bypass flow in [Creating rulesets for a
repository](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/creating-rulesets-for-a-repository),
and each protection in [Available rules for
rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets).

This repository is currently private. GitHub currently makes repository rulesets
for private repositories available on Pro, Team, and Enterprise Cloud plans. If
the account plan does not expose rulesets, use the equivalent classic branch
protection settings or revisit protection when the repository becomes public.

## Releases

Create releases only from green `main`. Do not describe version 0.1 as
product-accepted until the user-held gate in [`MVP.md`](./MVP.md) closes. Before
the next distributable release, add a release checklist covering versioning,
clean installation, the gated video smoke test, artifacts, signing/notarization
where applicable, checksums, release notes, and known limitations.

An emergency bypass is for restoring the delivery process or addressing an urgent
security issue. Document why it was used, validate immediately afterward, and
return `main` to the normal pull-request flow.
