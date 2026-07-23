# Release candidate gate

Use the **Release candidate** GitHub Actions workflow for a release. Ordinary
push and pull-request CI intentionally stays portable and lean; it is not
release evidence.

## Before dispatch

1. Confirm `main` is green and choose its exact 40-character commit SHA.
2. Confirm the tag is new and exactly `v` plus that candidate's `package.json`
   version.

## Candidate evidence

Dispatch the workflow from the repository's trusted default branch with the
exact SHA and tag. It fails closed unless that SHA is the checked-out source and
the current tip of `main`; the final publication job repeats the main-tip check
so an advanced `main` invalidates the candidate.

The candidate run keeps the portable Linux suite and build, then runs the full
`bun run test` suite on both macOS and Windows before their native gates. macOS
captures 1280 × 720 baseline and Style-session visual evidence, verifies an
external FFmpeg/FFprobe with `libx264` and AAC, exercises the media smoke, and
builds an unpacked package. Windows performs the same external-codec and media
checks, builds an unsigned x64 NSIS installer and unpacked app, verifies the
package inventory has no bundled FFmpeg/FFprobe, and launch-smokes the unpacked
package while capturing its visual evidence. Each platform verifies its required
evidence before upload; a missing visual result, inventory, copied installer,
unpacked executable, or package-smoke result fails the candidate rather than
leaving the release without objective evidence. The baseline and Style-session
screenshots prove renderability and scripted workflow execution only; they do
not certify UI aesthetics or replace human product acceptance.

Download the macOS and Windows artifacts for the exact run when diagnosing or
recording release evidence. Final UI visual review at the working desktop size
and 1280 × 720 remains a separate human product-acceptance item in `MVP.md`; it
does not gate the mechanical release-candidate workflow.

Set `publish_release` only when this candidate is ready to release. The final
job has the workflow's only `contents: write` permission. It runs only after all
candidate jobs pass, downloads the validated Windows evidence from the same run,
rechecks the unsigned NSIS installer name, version, and SHA-256 against its
inventory, creates a draft release targeting the supplied SHA with that installer
attached, then publishes the draft. The unpacked application remains an Actions
validation artifact, not a public portable release asset. A failed final step may
leave an unpublished draft for maintainer inspection, but cannot report a
published release as successful. Do not publish the same release through the
GitHub UI or another workflow, because that would bypass this gate.

Record the workflow URL, run ID, exact SHA, tag, artifact names, and any
exception in the release record. This evidence is per candidate/run and never
closes the user-held real-song acceptance gate in [`MVP.md`](./MVP.md).

## External FFmpeg policy

Version 0.1 uses externally installed FFmpeg and FFprobe. The app does not
redistribute codec executables; Homebrew and Chocolatey installation in CI
provisions test runners only. The hosted gates require both `libx264` and AAC,
not just an `ffmpeg` executable. A later bundled build is outside this release
workflow and needs an explicit fresh-machine adoption finding plus a separate
provenance, licensing, source-notice, patent, and security-update decision.
