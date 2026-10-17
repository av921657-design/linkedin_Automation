# Disaster Recovery

What survives what, and how to get posting again on a new Mac (or a Windows PC — see `Windows-Setup.md`).

## What is backed up, where

| Thing | Where it lives | Recovered from |
|---|---|---|
| Code + dashboard | GitHub (`av921657-design/linkedin_Automation`) → Vercel auto-deploy | `git clone` |
| Config (`config.json`) | Vercel Blob (edited at the dashboard) — plus local copy | Runner pulls it every run; also in the archive |
| Posting ledger (`state/state.json`) | Vercel Blob, pushed after **every run** | `npm run recover` |
| Run status/history, last-backup report | Vercel Blob (pushed after every run/backup) | Dashboard Overview |
| `queue/` drafts + media, `failed/`, secrets (`state/dashboard.json`, `state/rewrite.key`), Chrome profile (login data; caches excluded) | Encrypted daily archive in OneDrive → `linkedin-automation-backups/` (last 7 kept) | `npm run backup:restore` |

Backups run daily at **21:30** via launchd (`./install-backup-schedule.sh [install|pause|resume|status]`). Archives are AES-256-GCM encrypted; the passphrase is in this Mac's **Keychain** (item `com.av921657-design.linkedin-automation-backup`). On Windows the same job runs as the Task Scheduler task "LinkedIn Automation Backup" (`node windows/install-tasks.mjs install backup`) and the passphrase lives in the NTFS-locked `state/backup.pass` (`npm run backup:setup:win`).

**Do this now (one time):** copy the passphrase into your password manager:

```bash
security find-generic-password -a "$USER" -s com.av921657-design.linkedin-automation-backup -w
```

Without it, archives are unrecoverable. To set your own passphrase instead of the generated one: `npm run backup:setup`.

## Full recovery on a new Mac (~15 minutes)

1. Install Node 20+, Git, Google Chrome, and sign into OneDrive (files on-demand is fine).
2. `git clone https://github.com/av921657-design/linkedin_Automation.git && cd "linkedin_Automation" && npm install`
3. Restore the daily archive (brings back `queue/`, `state/` incl. dashboard token + rewrite key, `failed/`, profile):
   `npm run backup:restore` — when it asks for confirmation type `yes`.
   On a *different* Mac you must first re-add the Keychain passphrase (step above, from your password manager): `npm run backup:setup`.
4. Recover the anti-double-post ledger from the cloud (paranoia check; the archive already contains it):
   `npm run recover`
5. `npm run login` — sign into LinkedIn once. (Chrome cookies are Keychain-bound to the machine that made them, so re-login is expected even though the profile restored.)
6. `./install-schedule.sh` and `./install-backup-schedule.sh`
7. Verify: `npm run dry-run` → should log `Config source: dashboard` and find nothing new to post (proving the ledger survived).

## Dashboard environment variables (why login can fail)

Three variables in Vercel → Project → Settings → Environment Variables decide whether the dashboard can sign anyone in. After changing any of them you must **redeploy** for it to take effect.

| Variable | Needed for | Without it |
|---|---|---|
| `BLOB_READ_WRITE_TOKEN` | reading/writing config, status, ledger, auth — injected automatically when a Vercel **Blob store is connected** to the project | every login answers "The dashboard cannot read its Vercel Blob store" |
| `DASHBOARD_PASSWORD` | the **first** login only (bootstrap). Once a password is set in-app it is ignored forever | no credential exists yet, so nothing can sign in — set the first password on the login page instead |
| `SYNC_TOKEN` | the runner (Mac/PC) pushing results, and `npm run dashboard:unlock` | runs never appear on the dashboard; lockout recovery is unavailable |

- **Fresh project, no `DASHBOARD_PASSWORD`:** the login page says the deployment is unclaimed. Use **First run: set a password** — the first password is written as a create-only record, so it can never overwrite one that already exists.
- **Locked out after a password was set:** `npm run dashboard:unlock` on the machine holding `state/dashboard.json` (it authenticates with `SYNC_TOKEN`, not the password). This signs out every existing session.
- **"Wrong password." with a configured store:** a credential really does exist, so it is the password that is wrong — not the setup. Check for a stale `DASHBOARD_PASSWORD` from an earlier deployment before assuming the store is misconfigured.

## Failure modes that don't need the above

- **Mac dead but coming back:** nothing — OneDrive syncs the archive; the cloud ledger is current to the last completed run.
- **Dashboard/Vercel unreachable during a run:** harmless. The runner falls back to its cached config, then local `config.json`. Posting never depends on the cloud.
- **Ledger lost on the Mac only:** `npm run recover`.
- **Backups silently stopped:** the dashboard Overview shows "Encrypted backup: last OK/failed/none" — check `logs/launchd-backup.err.log`.
- **Lost GitHub + Vercel account access:** the OneDrive archive contains everything except the code; code is also on this Mac.
