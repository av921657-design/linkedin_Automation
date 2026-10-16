# Restore Guide — Rebuilding the LinkedIn Automation on a New Mac

Start from zero, end with posting again. No programming knowledge needed.
Total time: about 30–40 minutes (most of it is installing apps and waiting for downloads).

This guide assumes **the worst case: your old Mac is gone entirely.**
Setting up a **Windows 11 PC** instead? Use `Windows-Setup.md` — same flow, Task Scheduler + a locked passphrase file instead of launchd + Keychain.

---

## Before you begin — the one thing that decides everything

Your nightly backups are **encrypted**. The password (passphrase) for that encryption lived on the old Mac.

- ✅ **If you saved the passphrase in a password manager** (as recommended in `RECOVERY.md`): continue, everything below works.
- ⚠️ **If you never saved it**: the OneDrive backup files cannot be opened. You can still rebuild — skip to "Plan B: no passphrase" at the bottom.

You will also need your **GitHub** login (account `av921657-design`) and, if asked, your **OneDrive** and **LinkedIn** logins. Have them ready.

---

## Step 0 — Install the three apps

On the new Mac, install these first (each is a normal app download):

1. **Google Chrome** — https://www.google.com/chrome (just download and install; don't need to sign in)
2. **OneDrive (Microsoft)** — from the Mac App Store, search "OneDrive". Sign in with your Microsoft account.
   After signing in, open Finder and check that a folder appeared at:
   `~/Library/CloudStorage/OneDrive-Personal/linkedin-automation-backups/`
   It should contain files named like `linkedin-automation-backup-<date>.tar.gz.enc`. If you don't see the folder yet, wait a few minutes for OneDrive to set up.
3. **Node.js version 20 or newer** — download the "LTS" macOS installer (`.pkg`) from https://nodejs.org, run it, click through.
4. **Git** — open **Terminal** (press `Cmd+Space`, type "Terminal", press Enter) and run:
   ```bash
   git --version
   ```
   If it prints something like `git version 2.x`, you're done. If macOS pops up a "Install Command Line Developer Tools" window, click **Install** and wait for it to finish.

**Check your work before continuing.** Run these two commands in Terminal — each should print a version number, not an error:

```bash
node --version
git --version
```

---

## Step 1 — Download the program from GitHub

In Terminal, copy-paste these two lines (one after the other) and press Enter:

```bash
git clone https://github.com/av921657-design/linkedin_Automation.git
cd linkedin_Automation
```

It will ask for GitHub credentials. The easiest path: if it opens a browser window saying "Sign in with GitHub", do that and approve. If the terminal asks for a **password**, GitHub does not accept your normal password — you need a "personal access token". If you get stuck here, say so and ask for help; don't guess.

**Check your work:** run `ls` — you should see files like `run.js`, `backup.js`, `package.json`, and a `dashboard` folder.

## Step 2 — Install its dependencies

Still in Terminal (you should still be inside the `linkedin-automation` folder — `pwd` will show you where you are):

```bash
npm install
```

Takes 1–3 minutes. It's finished when you get your normal `$` prompt back with no red errors. (Yellow warnings are normal — ignore them.)

---

## Step 3 — Put the backup passphrase on this Mac

The restore tool reads the passphrase from macOS's Keychain, so you must add it once here.

```bash
npm run backup:setup
```

It will ask you to **type the passphrase twice** (typed characters stay hidden — that's normal; paste it with `Cmd+V` if your password manager supports it).

**Check your work:** run this — it should print exactly the passphrase you entered:

```bash
security find-generic-password -a "$USER" -s com.av921657-design.linkedin-automation-backup -w
```

## Step 4 — Restore the backup file

```bash
npm run backup:restore
```

What happens, in order:

1. It lists the backup files it found in your OneDrive folder and picks the **newest** one.
2. It asks for confirmation — type `yes` and press Enter.
3. It decrypts the archive and unpacks everything back into this folder: your content drafts (`queue/`), the posted-history ledger and secrets (`state/`), failed items (`failed/`), and the Chrome login profile (`chrome-profile/`).

**Check your work:** run `ls queue` and `cat state/state.json | head -5` — the queue may contain `.md` draft files, and `state.json` should print JSON starting with `{ "posted":`.

> If it says "no backup files found", OneDrive hasn't downloaded them yet. Open Finder, go to the `linkedin-automation-backups` folder, right-click the newest `.tar.gz.enc` file → "Download Now", then re-run.

## Step 5 — Re-sync the posting ledger from the cloud

The backup is at most 1 day old. The "cloud ledger" on the dashboard is current to the last completed run, and it tells the app exactly which posts already went out — this is what prevents double-posting.

```bash
npm run recover
```

Expected output compares the local and cloud versions and either keeps the newer one or restores the cloud copy. Read its last line; it will say what it did.

---

## Step 6 — Log in to LinkedIn one time

```bash
npm run login
```

A Chrome window opens with the dedicated automation profile. **Log into your LinkedIn account in that window manually** (same as any normal login — the program never sees or stores your password). When you reach your LinkedIn home feed, close the Chrome window. That's it.

## Step 7 — Reinstall the schedule (so it runs by itself again)

Two small jobs must be registered with macOS: the poster and the nightly backup (21:30). The poster follows your **day-wise schedule** — the `schedule` block in your config (`timezone` + `weekday` hours for Mon–Fri, `weekend` hours for Sat–Sun, e.g. `10, 13, 17, 20` on weekdays and every 2 hours `10–20` on weekends). The hours are wall-clock time in `schedule.timezone` (pick it in the dashboard **Schedule** tab); `install-schedule.sh` translates them to this Mac's local clock — exact minute and weekday, even for different or half-hour zones — and wakes launchd at those times; `run.js` then re-checks each wake against the day's own list in the posting timezone, so an off-schedule wake skips posting *and* engagement without opening Chrome. Run both:

```bash
./install-schedule.sh
./install-backup-schedule.sh
```

If you change hours or the timezone in the dashboard, re-run `./install-schedule.sh` so launchd wakes for the new set (the run.js gate already honors the change on the very next tick). If your posting timezone observes DST, re-run it after each DST change to keep wakes exact. Need a post right now, off-schedule? `npm run post-now`.

**Check your work:**

```bash
./install-schedule.sh status
./install-backup-schedule.sh status
```

Both should report the job is installed/loaded.

---

## Step 8 — Verify everything works

### 8a. Test run without posting

```bash
npm run dry-run
```

Open the newest log file and check for a line like:

```bash
ls -t logs/*.log | head -1 | xargs tail -40
```

You want to see: **`Config source: dashboard`** (proves it reached the cloud) and a result of **nothing to post / no new candidates** (proves the ledger survived — it recognizes your already-published posts).

### 8b. Check the dashboard

Open https://<your-project>.vercel.app in Chrome, log in with your dashboard password, and look at the Overview tab: the countdown should name your next scheduled slot from the day-wise schedule (see the Schedule tab), and the "Recovery copies" card should show a recent cloud ledger.

### 8c. Confirm the first real posts

Next morning, check your LinkedIn profile: posts should appear on the usual schedule, and the dashboard history should show results (`posted`, `nothing`, etc.). If any run shows `AUTH_REQUIRED` / "auth-paused", just re-run `npm run login` and log in again.

**Done.** The automation is fully restored.

---

## Plan B: no passphrase (backup files unreadable)

You can still rebuild; you just lose the OneDrive archive contents:

1. Steps 0, 1, 2 as above.
2. Skip steps 3–5. Create `state/dashboard.json` by asking whoever manages the dashboard for the URL + sync token, or copy it from a teammate's machine if one exists. (Without it, the app still posts using the local `config.json`.)
3. `npm run login` (step 6) and both install scripts (step 7).
4. **Big caveat — double-posting:** the app no longer knows what it already published. Before enabling the schedule, open the dashboard Overview/history, note the recent posts, and manually add their content to `state/state.json` under `posted`, **or** accept that the app may repost candidates from `queue/` — safest is to review `queue/` (empty, since it was lost) and re-create drafts deliberately.
5. Create a new backup passphrase with `npm run backup:setup` and save it somewhere safe this time.

---

## Trouble reference

| Symptom | Cause / fix |
|---|---|
| `npm: command not found` | Node wasn't installed or Terminal was opened before installing — close Terminal, open a new one, retry. |
| `git clone` asks for a password | GitHub requires a personal access token, not your password. Use "Sign in with GitHub" popup if it appears; otherwise create a token at github.com → Settings → Developer settings. |
| "no backup files found" | OneDrive hasn't synced — download the newest `.tar.gz.enc` file manually (right-click → Download Now) and retry. |
| "decryption failed / bad passphrase" | Wrong passphrase, or an old `backup:setup` value stored in Keychain. Delete it (`security delete-generic-password -s com.av921657-design.linkedin-automation-backup`), re-run `npm run backup:setup`, retry restore. |
| Dashboard page won't load | Vercel project moved or renamed — check https://vercel.com/av921657-design's dashboard list; the runner keeps working regardless (falls back to cached config). |
| Run history shows `auth-paused` | LinkedIn asked for login — run `npm run login` again. |
| No posts and no runs at all | Check schedule: `./install-schedule.sh status`. Re-run `./install-schedule.sh` if not loaded. |

Related files: `RECOVERY.md` (short technical version of this guide).
