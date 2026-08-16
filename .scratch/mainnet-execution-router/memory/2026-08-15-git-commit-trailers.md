Commit-trailer behavior is PER-REPO: OVRFLO clean, the FORK injects Co-authored-by.
Boot check (2026-08-15) found no trailers in /Users/jay/OVRFLO history and plain git commit there
stays clean. But ticket 07's first `git commit` in /Users/jay/OVRFLO-Streams-u4 grew a
Co-authored-by trailer; the worker replaced it via write-tree/commit-tree/update-ref plumbing.
Policy: OVRFLO repo — plain git commit, verify `git log -1 --format='%B'` after each commit.
Fork repo — use plumbing (or amend-strip immediately) and verify the same way.
