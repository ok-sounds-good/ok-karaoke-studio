# Review Standard

Review exists to catch credible problems before merge and to leave a clear
record of what was considered. It should not manufacture blockers from
hypothetical states or turn style preferences into defects.

## Inputs

Review the complete change against:

- the stated goal, scope, and exclusions;
- the relevant product and technical contracts;
- the implementation, tests, documentation, and configuration; and
- the recorded automated, manual, and platform validation.

For changed behavior, inspect the normal path, a realistic failure or recovery
path, and any affected trust, process, filesystem, or media boundary. Static
inspection does not turn an unrun test into a pass.

## Findings

Return actionable findings first, ordered by severity. Each finding should say:

- where the problem is;
- what credible action or condition reaches it;
- the concrete user or system impact;
- the smallest reasonable correction; and
- the validation that would demonstrate the correction.

Separate demonstrated defects from questions or residual uncertainty. Flag
unrelated edits and undocumented contract changes. Do not block solely because
an internal API could represent a state that production boundaries prevent, or
because a different design is preferred.

## Outcome

Conclude with `PASS` or `NOT PASS`, then state residual risk and validation gaps.
A confirmed correctness, security, data-integrity, or required-validation defect
blocks a pass until it is fixed or the maintainer explicitly accepts the risk in
the pull request. Create a follow-up Issue when accepted work needs durable
tracking.

Identify the reviewed commit. Material changes after review require another
look; trivial conflict resolution or metadata-only changes do not require
ceremonial rereview when they cannot affect the conclusion.

Review can be completed from the local diff and supplied pull-request context.
GitHub access is optional unless the assignment specifically authorizes reading
or posting there.
