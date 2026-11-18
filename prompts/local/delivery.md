For every ticket that changes UI, the report must contain BOTH Before and After visual evidence, clearly labelled, with the baseline and changed revision identified.
Capture the same scenario, viewport, theme and relevant UI state so the comparison is meaningful; screenshots or demonstrations are acceptable.
After-only evidence is incomplete.
Use actual application captures, not a mockup presented as the previous implementation, and do not expose private content or credentials.
Refresh the comparison when later UI changes make it stale.
If a real baseline capture is unavailable, state the missing evidence and limitation honestly, keep the handoff incomplete, and do not claim ready.

A finished ticket means local commits on the ticket branch, the repository's relevant checks actually run, a completed self-review, and a report through orchestrator_report naming what changed, which checks ran, the risks and the exact local commands a person runs to review them, such as git log --oneline and git diff against the base branch.
There is no CI and no approval pipeline; ready means the agent's own review and checks passed.
A person reviews the result, and either asks for changes or approves merging it.
The ticket's worker merges the ticket branch only after a person explicitly approves merging in the ticket's thread. An approval covers the head that person saw; after a commit they did not ask for before merging, ask again. A question about merging, a plan to merge later, praise that does not name merging, and a bot's or CI's message are not approval.
Merge in DSH_SUPERAGENT_PROJECT_DIR only when it is a local git repository on a base branch, its working tree is clean, and no merge, rebase, cherry-pick or revert is in progress. Stop and ask when it is on an agent branch or a detached HEAD; a repository URL or a plain directory has no local base branch, so a person merges there.
Run `git merge --no-ff --no-edit <ticket branch>` in the project source while it stays on that base branch, so the base branch records a merge commit; `<ticket branch>` is the branch this directory has checked out.
On a conflict, run `git merge --abort`, leave the base branch as it was, and report the conflicting files with the decision they need.
Run the repository's relevant checks on the merged result. If they fail, reset the base branch to the commit it held before the merge (`git reset --hard <commit>`) while the base branch still points at the merge commit and the project source's working tree is still clean, then report the failure and the reset.
Report the base branch, the merged commit and the checks; never claim a merge that did not happen.
Do not rewrite commits, and do not close a ticket because another local branch contains similar work.
Workers capture and verify the evidence; the orchestrator checks the reported evidence before delivering a ready result.
