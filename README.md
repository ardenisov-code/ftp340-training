# FTP 340 public training board

PostgreSQL in TriCoach is the source of the approved plan. The adaptive Pages
artifact is built from `site-template/` and the validated `adaptive-plan.json`.
The site is not built by a push from `GITHUB_TOKEN`: the receiver explicitly
uses `configure-pages`, `upload-pages-artifact` and `deploy-pages`, then verifies
the public JSON version and canonical SHA-256 before reporting success.

## Safe first publication

Until the first verified publication, the existing root `index.html` and
`board.js` remain the current site. Merging this PR therefore preserves the
legacy view; no empty placeholder manifest is committed. The legacy site was
already public and may contain outdated training and personal information; it
is not evidence of the current PostgreSQL plan. The new adaptive artifact is
allowlisted and has the privacy gate.

The first authenticated sync can start at any positive version already
approved in PostgreSQL. The public archive contains that exact version and a
separate baseline snapshot; it does not invent unavailable historical version
files. Later publications must be consecutive. Replays with changed content,
version gaps and stale signatures fail validation.

After a publication failure, the workflow restores the previous repository
pointer, builds a rollback artifact (legacy site on the first sync, otherwise
the previous approved manifest), deploys it explicitly and verifies the
public response. Failed versions remain archived. If restoration cannot be
verified, the callback reports `rollback_not_verified`; no success is claimed.

## Settings for deployment

After review and explicit production authorization, configure Pages to use
**GitHub Actions** instead of its current branch source. The `github-pages`
environment must allow `main` and GitHub Actions must be allowed the workflow's
requested `contents: write`, `pages: write` and `id-token: write` permissions.
Configure these repository Actions secrets:

- `TRICOACH_DISPATCH_HMAC_SECRET`: same >=32-byte random value as TriCoach's
  `FTP340_DISPATCH_HMAC_SECRET`.
- `LINK_SIGNING_SECRET`: same callback signing secret as TriCoach Render.
- `TRICOACH_CALLBACK_URL`: base URL of the TriCoach Render service.

Do not enable an initial sync until the actual approved plan and version have
been reviewed read-only in PostgreSQL. Dry-run preview is not a migration.

## Local checks

```bash
python3 -m unittest discover -s tests -v
python3 -m compileall -q scripts tests
node --check site-template/board.js
```
