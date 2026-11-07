# FTP 340 public training board

`adaptive-plan.json` is the public presentation of the approved plan from
TriCoach PostgreSQL. It does not become an independent plan source. The board
loads calendar weeks, macrocycle summaries, completion flags, and calculator
reference FTP from this file; it does not embed day-by-day sessions in HTML or
JavaScript.

## Cross-repository publication

The `Publish TriCoach-approved plan` workflow accepts only the
`tricoach_plan_approved` repository-dispatch event. It verifies the short-lived
HMAC signature and nonce, validates the fixed FTP/date target and privacy
contract, rejects stale/replayed/gapped versions, and ensures the original
baseline and completed sessions remain unchanged. Each accepted release is
stored as an immutable `versions/ftp340-plan-vN.json` file before
`adaptive-plan.json` is changed.

The workflow waits until the GitHub Pages URL serves the exact approved version
and canonical manifest hash. It then sends a signed result to TriCoach. If the
new page cannot be verified, the workflow reverts the publication commit,
checks the previous public version, and reports failure; it never reports
success merely because a repository-dispatch was accepted.

## Required repository settings

Configure these Actions secrets in `ardenisov-code/ftp340-training`:

- `TRICOACH_DISPATCH_HMAC_SECRET`: same random value as
  `FTP340_DISPATCH_HMAC_SECRET` in TriCoach Render; at least 32 bytes.
- `LINK_SIGNING_SECRET`: same value as TriCoach Render.
- `TRICOACH_CALLBACK_URL`: base URL of the TriCoach Render service.

Allow GitHub Actions to write repository contents. GitHub Pages must publish
from `main`; a workflow commit triggers the Pages build. The workflow uses its
own repository-scoped `GITHUB_TOKEN` and does not need a second PAT.

`adaptive-plan.json` begins in `awaiting_approved_sync` state. The initial
approved database version is published through TriCoach's manual sync workflow
after its DRY_RUN is reviewed. Until that verified sync, the page deliberately
shows no stale workouts.

## Local checks

```bash
python3 -m unittest discover -s tests -v
python3 -m compileall -q scripts tests
```
