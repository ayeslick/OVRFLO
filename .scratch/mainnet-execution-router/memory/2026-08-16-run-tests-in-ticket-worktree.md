Workers and reviewers keep running forge/vitest/npm in the wrong tree: the campaign
checkout `/Users/jay/OVRFLO`, a sibling worktree, or a default cwd that is not the
ticket worktree. A green suite from the wrong tree is not evidence.

Rule: every repo command (forge, npm, vitest, typegen, git commit) starts by `cd`
to the absolute worktree named in the dispatch. In the SAME command, echo `pwd`,
`git rev-parse --show-toplevel`, branch, and short HEAD, then run the test.
Web tests: `cd $WORKTREE/web` and the local binary (`./node_modules/.bin/vitest`
or `npm test`). Never `npx vitest` from another tree. Never `/Users/jay/OVRFLO`
when the ticket lives in `/Users/jay/OVRFLO-tN`.

Load the worktree before baseline. See `2026-08-16-worktree-baseline-bootstrap.md`.
Missing `node_modules` / `.env.local` / `out/` is bootstrap, not a failed baseline.
