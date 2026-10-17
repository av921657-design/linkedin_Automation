# LinkedIn content automation

Scrapes content you already own (your other LinkedIn account, X, Instagram, a Facebook page, RSS feeds, blog articles), rewrites it, and posts it to LinkedIn from one Chrome profile on a daily schedule. A Next.js dashboard holds the config and run history; queue contents, secrets and the browser profile live in an encrypted daily backup.

Everything runs locally — the only thing on Vercel is the dashboard.

## Requirements

Node.js 20+, Git, Google Chrome, and an account on the sources you want to scrape. The automation signs into those sites inside its own Chrome profile (`chrome-profile/`), separate from your personal browser.

## Setup

**Windows:** follow [Windows-Setup.md](Windows-Setup.md) — it covers Task Scheduler, the passphrase file, and which scripts are Mac-only.
**macOS:** the five steps below.

```bash
npm install
npm run login          # sign into LinkedIn (and any other source) in the window that opens
npm run dry-run        # scrape + rewrite, post nothing. Safe to run repeatedly.
npm run post-now       # one real post run, manually
./install-schedule.sh  # daily posting slots (pause|resume|status also work)
```

Sources are configured in `config.json`, or at the dashboard once it is deployed. Each entry has a `profileUrl`/`url` and an `enabled` flag. Unconfigured placeholders (`YOUR-HANDLE`, `YOUR-PAGE`, `ANY-BLOG.example`) are detected and the source is skipped with a log line — a fresh clone does nothing destructive until you edit them.

Enable one source at a time and re-run `npm run dry-run` between changes: LinkedIn's markup moves, so it is easier to see which adapter broke.

## Dashboard

Deploy `dashboard/` on Vercel (connect the Git repository and point the framework root at it), then set the project environment variables:

| Variable | Needed | Purpose |
|---|---|---|
| `BLOB_READ_WRITE_TOKEN` | yes | Injected automatically when you attach a Blob store. Without it every read/write fails and login answers 503. |
| `DASHBOARD_PASSWORD` | no | First-login bootstrap only. Ignored forever once a password is stored in-app. |
| `SYNC_TOKEN` | recommended | Lets the local runner push its ledger and status to the dashboard with `Bearer` auth instead of a password. |

On a fresh deployment the sign-in page offers **First run: set a password**. That write is create-only, so it can never overwrite an existing credential, and two people claiming at once cannot both win. After that the dashboard edits `config.json` in the cloud, shows run history, and the runner pulls that config on every run.

Recovering a locked-out dashboard: `npm run dashboard:unlock` (Mac) or the `SYNC_TOKEN` route on `/api/reset`.

## Backups

`backup.js` archives `queue/`, `failed/`, `state/` and the Chrome profile into an AES-256-GCM bundle in your cloud storage, keeping the last 7.

```bash
npm run backup:setup       # Mac: store the passphrase in Keychain
npm run backup:setup:win   # Windows: write it to the NTFS-locked state/backup.pass
./install-backup-schedule.sh
npm run backup:restore     # pull the newest archive down
```

**Copy the passphrase into your password manager the day you set it up.** Without it every archive is unrecoverable. [RECOVERY.md](RECOVERY.md) lists what survives which failure, and [Restore.md](Restore.md) is the step-by-step.

## LLM rewriting (optional)

Without a key, posts go through a free extractive rewrite — no cost, no signup. To use a chat model instead: `npm run llm:setup` (Mac; on Windows write your key into `state/rewrite.key` with no `.txt` extension), then `npm run llm:check` and `npm run test:llm`.

## Layout

| Path | What is in it |
|---|---|
| `run.js`, `src/` | the runner: source adapters, rewriting, media handling, LinkedIn composer |
| `src/sources/` | one adapter per source type; each fails closed on unconfigured URLs |
| `dashboard/` | Next.js app — config editor, status, history, password reset |
| `queue/` | manual posts: one folder each, `post.txt` (or `post.md`) plus any media |
| `state/` | ledger, tokens, keys — **gitignored, never commit** |
| `chrome-profile/` | browser login — **gitignored, never commit** |
| `windows/`, `install-*.sh` | Task Scheduler and launchd installers |
