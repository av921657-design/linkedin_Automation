import { execFile } from 'node:child_process';

/** macOS notification so failures surface without watching logs.
 *  No-op on other platforms (Windows runs headless under Task Scheduler;
 *  failures still land in logs/ and the dashboard run history). */
export function notify(title, message) {
  if (process.platform !== 'darwin') return;
  const script = `display notification ${JSON.stringify(String(message).slice(0, 200))} with title ${JSON.stringify(String(title).slice(0, 100))}`;
  execFile('osascript', ['-e', script], () => {
    /* notification is best-effort; never crash over it */
  });
}
