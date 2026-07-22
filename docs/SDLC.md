# Software Development Lifecycle

The goal of this process is simple: keep `main` green and leave a useful,
visible record in GitHub of why a change was made, how it progressed, what was
verified, and why it was merged.

## The GitHub record

Every change merged to `main` goes through a pull request. The pull request is
the durable delivery record and should make these facts easy to find:

- the problem or goal and the intended scope;
- the implementation and important decisions made along the way;
- exact validation results, including anything not run or unavailable;
- review findings, responses, and accepted risks; and
- follow-up work that was deliberately left out.

Use pull-request comments or linked Issues for progress updates when they add
useful context. An Issue is optional: create or link one when work benefits from
planning, discussion, or follow-up tracking. A branch, chat, or local handoff is
not a substitute for documenting material decisions in the pull request before
merge.

## Change flow

1. Start a cohesive branch from current `main`. Keep unrelated work in separate
   pull requests.
2. Implement the smallest complete change and update the relevant product or
   technical documentation when its contract changes.
3. Run the checks required by `CONTRIBUTING.md` and the changed behavior. Record
   the commands, results, manual evidence, and gaps in the pull request.
4. For a nontrivial change, obtain an independent review under `REVIEWING.md`.
   Keep findings and their resolution visible in the pull request.
5. Merge only when the intended scope is complete, required checks pass, and
   blocking findings are fixed or explicitly accepted by the maintainer.
6. After merge, leave `main` green and clean up only task-owned branches and
   worktrees whose integration and identity have been verified.

The user's task defines authority. Local work does not imply permission to
publish, merge, change repository settings, or perform another remote action.
Delegated agents remain local-only unless their current assignment explicitly
authorizes a specific remote action within the user's authority.

## CI and branch protection

The workflows under `.github/workflows/` define hosted CI. GitHub branch
protection or rulesets define which checks block merging. Keep those settings
and workflow names aligned, but do not duplicate their implementation details in
this document.

A required check that did not run or could not complete is not a pass. Any
exception to a required check or normal pull-request flow needs an explicit
maintainer decision recorded in GitHub, followed by validation as soon as the
blocker clears.

## Releases

Create releases from green `main`. Product acceptance and distribution decisions
remain governed by `MVP.md`; release-specific mechanics belong in the release
checklist rather than this development policy.
