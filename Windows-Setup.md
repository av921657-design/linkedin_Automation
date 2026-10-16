# Setup Guide — Running the LinkedIn Automation on a Windows 11 PC

Start from zero, end with posting again. No programming knowledge needed.
Total time: about 30–40 minutes. The macOS guide is `Restore.md`; this one is its Windows twin.

Everything (content queue, posting ledger, config, dashboard, backups) is shared
with the Mac through GitHub + the cloud dashboard + OneDrive — this PC is just a
new machine that *runs* the same automation.

---

## Before you begin

Have ready:

- Your **GitHub** login (account `av921657-design`).
- The nightly-backup **passphrase** (the one you saved in your password manager). On Windows it goes into a locked file instead of the Mac Keychain.
- Your **OneDrive** and **LinkedIn** logins.

---

## Step 0 — Install the four apps

1. **Google Chrome** — https://www.google.com/chrome (the automation drives your installed Chrome; no separate browser is downloaded).
2. **Git for Windows** — https://git-scm.com/windows — installer defaults are fine.
3. **Node.js LTS (x64 .msi)** — https://nodejs.org — installer defaults are fine.
4. **OneDrive** — already built into Windows 11. Click the cloud icon in the taskbar → sign in with the same Microsoft account as on the Mac. Make sure the folder `C:\Users\<you>\OneDrive\linkedin-automation-backups` exists (it syncs from the Mac automatically; give it a few minutes).

Open **Terminal** (`Win` key, type "Terminal", Enter — the PowerShell one) and check:

```powershell
node --version
git --version
```

Both must print a version number.

---

## Step 1 — Download the program from GitHub

In Terminal:

```powershell
cd $env:USERPROFILE
git clone https://github.com/av921657-design/linkedin_Automation.git
cd linkedin_Automation
npm install
```

A browser window may pop up saying "Sign in with GitHub" — do that and approve. If the terminal instead asks for a **password**, GitHub wants a personal access token, not your account password — ask for help rather than guessing.

`npm install` takes 1–3 minutes; yellow warnings are normal, red errors are not.

## Step 2 — Put the backup passphrase on this PC

```powershell
npm run backup:setup:win
```

Type the passphrase twice (characters stay hidden). It is saved to `state\backup.pass`, locked by Windows to your user account only, and never committed (the `state/` folder is git-ignored). The value is never printed.

## Step 3 — Restore your data from the OneDrive backup

```powershell
npm run backup:restore
```

It lists the encrypted archives in your OneDrive folder, picks the **newest**, asks for confirmation (type `yes`), then unpacks `config.json`, `state/`, `queue/`, `failed/` and the Chrome profile into this folder. Windows' built-in `tar` handles the archive — nothing extra to install.

**Check:** `dir queue` may show `.md` drafts; `type state\state.json` should start with `{"posted":`.

> "No OneDrive backup folder found" → OneDrive hasn't synced yet: open the folder in Explorer, right-click the newest `.tar.gz.enc` → "Always keep on this device", re-run. Or set the folder manually: `$env:BACKUP_DIR = "C:\path\to\backups"`.

## Step 4 — Sync the posting ledger from the cloud

The backup is up to a day old; the cloud ledger is current to the last run and is what prevents double-posting:

```powershell
npm run recover
```

Read its last line — it says whether it kept the local copy or restored the cloud one.

## Step 5 — Log in to LinkedIn one time

```powershell
npm run login
```

Chrome opens with the dedicated automation profile. **Log into LinkedIn in that window yourself** (the program never sees or stores your password), reach your home feed, then close the window. This is required on every new machine — Chrome's login cookies are encrypted per machine, so the restored profile starts logged-out.

## Step 6 — Register the schedule (Task Scheduler)

```powershell
npm run schedule:win
```

This creates two Windows tasks, mirroring the Mac's launchd jobs:

- **LinkedIn Automation** — the day-wise posting schedule. Your dashboard Schedule tab's hours (`schedule.timezone`) are translated to THIS PC's local clock — exact minute and weekday, even across half-hour zones. `run.js` re-checks every wake against the schedule itself, so hour/timezone edits apply on the next tick; re-run `npm run schedule:win` after changing **hours or timezone** (and after any **DST** change) to refresh which times the PC wakes for.
- **LinkedIn Automation Backup** — the nightly encrypted OneDrive backup at 21:30 local.

Verify:

```powershell
npm run schedule:win:status
```

Other controls: `node windows\install-tasks.mjs pause|resume|remove [post|backup|all]`.

**Power notes (Windows equivalent of the Mac's sleep behavior):**

- The tasks request permission to **wake the PC from sleep** for a posting slot, and a missed slot **runs once when the PC comes back** — same coalescing as launchd.
- Chrome must run in your **logged-on session**. A locked screen is normally fine; a signed-out or off PC cannot post. If posts start failing around your posting times, keep the session signed in (Settings → Accounts → "Use my sign-in info to automatically finish setting up my device after an update or restart" → On).
- One machine posting is the design. If both Mac and this PC are on schedules, pause one (`./install-schedule.sh pause` on the Mac; `pause post` here) — the shared ledger still prevents duplicate posts, but one runner keeps the history clean.

## Step 7 — Verify everything works

```powershell
npm run dry-run
Get-ChildItem logs\*.log | Sort-Object LastWriteTime -Descending | Select-Object -First 1 | Get-Content -Tail 40
```

You want to see **`Config source: dashboard`** (proves cloud sync works from this PC) and **no new candidates** (proves the ledger survived — it recognizes already-published posts). Then open https://<your-project>.vercel.app, log in, and confirm the Overview countdown shows a slot from the schedule. Next scheduled wake should produce a real post visible on your LinkedIn profile; the dashboard run history will list this PC's runs alongside the Mac's.

Need a post right now, off-schedule? `npm run post-now`.

---

## Optional extras

- **LLM rewriting key** — the Mac's `npm run llm:setup` is a bash prompt; on Windows create the file directly: put your free API key into `state\rewrite.key` (right-click → New → Text Document, name it exactly `rewrite.key` — no `.txt`), then check with `npm run llm:check`. Without a key everything still runs on the free extractive path.
- **Dashboard password to clipboard** — `npm run dashboard:password:win`.

## Trouble reference

| Symptom | Cause / fix |
|---|---|
| `node : term not recognized` | Node installed but Terminal was already open — close and reopen Terminal. |
| `git clone` asks for a password | GitHub needs a personal access token, not your password. Use the "Sign in with GitHub" popup, or create a token at github.com → Settings → Developer settings. |
| `tar` not found | Windows 10 1803+ ships `tar.exe` in System32 — update Windows, or run the commands from **Git Bash** (installed with Git for Windows, which also bundles tar). |
| "No backup passphrase found" | Step 2 not done on this PC — `npm run backup:setup:win`. (A Mac-only passphrase won't be in this PC's file; the passphrase itself is the same one from your password manager.) |
| "decryption failed / bad passphrase" | Wrong passphrase in `state\backup.pass` — delete the file, re-run `npm run backup:setup:win`. |
| `schtasks` "Access is denied" | Register from your normal user account (the tasks run in your interactive session); no admin elevation needed. |
| Runs show `auth-paused` | LinkedIn asked for re-login — `npm run login` again. |
| No runs at all | `npm run schedule:win:status` — if NOT REGISTERED, re-run `npm run schedule:win`. |
| Posts go out at the wrong hour | Hours are wall-clock in the dashboard's **posting timezone**; the installer converts to this PC's clock. Changed hours or timezone since the install? Re-run `npm run schedule:win`. |
