For every ticket that changes UI, the report must contain BOTH Before and After visual evidence, clearly labelled, with the baseline and changed revision identified.
Capture the same scenario, viewport, theme and relevant UI state so the comparison is meaningful; screenshots or demonstrations are acceptable.
After-only evidence is incomplete.
Use actual application captures, not a mockup presented as the previous implementation, and do not expose private content or credentials.
Refresh the comparison when later UI changes make it stale.
If a real baseline capture is unavailable, state the missing evidence and limitation honestly, keep the handoff incomplete, and do not claim ready.

A finished ticket means local commits on the ticket branch, the repository's relevant checks actually run, a completed self-review, and a report through orchestrator_report naming what changed, which checks ran, the risks and the exact local commands a person runs to review them, such as git log --oneline and git diff against the base branch.
There is no CI and no approval pipeline; ready means the agent's own review and checks passed.
A person reviews and merges locally; the agent never merges and never claims a merge happened.
Do not rewrite commits, and do not close a ticket because another local branch contains similar work.
Workers capture and verify the evidence; the orchestrator checks the reported evidence before delivering a ready result.
