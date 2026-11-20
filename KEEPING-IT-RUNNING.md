# Keeping it running on a server

`RUN-ON-WINDOWS.bat` is for a desktop. It runs the register in the foreground
of your logged-in session, so Windows ends it when that session ends — when
you disconnect, log off, or the machine restarts. That is Windows behaving
normally, not a fault in the app, and nothing in the app's code can change it:
a program started by your session belongs to your session.

To keep it up, start it as something that is not tied to a login. Below is the
way that needs no downloads.

---

## First: get it out of OneDrive

If the folder sits inside OneDrive — and the copy you have does — **move it
before you do anything else.** Somewhere plain and local:

```text
C:\DeviceRegister\
```

Two reasons, and the first is serious:

- **OneDrive syncs the database while the app has it open.** `register.db`
  changes constantly, with `register.db-wal` and `register.db-shm` beside it,
  and a sync client copying those mid-write can corrupt the register or
  silently roll it back. A database is not a document.
- A service running as `SYSTEM` has no business reading a user's OneDrive
  folder, and the path can stop resolving when that user's profile is not
  loaded.

Move the whole folder, then start the app once from the new location to check
it still works before going on.

---

## Then: run it as a scheduled task

Task Scheduler is built into Windows, needs nothing installed, and can run a
program whether or not anybody is logged on.

1. Start → **Task Scheduler** → **Create Task…** (not *Create Basic Task*).

2. **General** tab
   - Name: `Device register`
   - Select **Run whether user is logged on or not**
   - Tick **Run with highest privileges**
   - **Change User or Group…** → type `SYSTEM` → OK
     (or a dedicated service account, if your policy requires one)

3. **Triggers** tab → **New…**
   - Begin the task: **At startup** → OK

4. **Actions** tab → **New…**
   - Action: **Start a program**
   - Program/script: `C:\Program Files\nodejs\node.exe`
     (check the path — `where node` in a command prompt tells you)
   - Add arguments: `src\server.mjs`
   - **Start in: `C:\DeviceRegister\device-register`**

   That last box matters more than it looks. It sets the working directory,
   and the app writes `register.db` relative to it. Leave it blank and the
   register is created wherever the task happens to start — usually
   `C:\Windows\System32` — and you get an empty one while the real data sits
   untouched somewhere else.

5. **Settings** tab
   - Tick **If the task fails, restart every:** `1 minute`, up to `3` times
   - **Untick "Stop the task if it runs longer than:"** — it defaults to
     3 days, and it means exactly what it says. Your register would stop on
     Thursday for no visible reason.

6. **OK**. Then right-click the task → **Run**.

### Belt and braces on the database path

Even with *Start in* set, pin it explicitly. Open
`C:\DeviceRegister\device-register\.env` in Notepad and add or edit this line:

```text
DATABASE_PATH=C:/DeviceRegister/device-register/register.db
```

Forward slashes are fine and avoid escaping problems. With that set, the
register cannot end up anywhere else no matter how the app is started.

### Check it actually survives

Worth doing once, properly:

1. Open the register in a browser and sign in.
2. **Log off** the server completely — not just close the window.
3. From another machine, open the register again.

If it answers, you are done. If it does not, open Task Scheduler and look at
**Last Run Result** on the task: `0x0` is success, anything else is the reason.

---

## If your server has Docker instead

The project already ships for this, and it is less fiddly than the above:

```bash
docker compose up -d
```

`compose.yaml` sets `restart: unless-stopped`, so it comes back after a crash
and after a reboot, with no login involved. The database lives in a named
volume rather than the app folder, which also sidesteps the OneDrive problem
entirely.

Copy your existing `register.db` into that volume first, or you will start
empty — the Dockerfile deliberately excludes `*.db`, so the one in your folder
is not carried into the image.

---

## While you are making it reachable

Two things that bite people at exactly this point:

- **Set `PUBLIC_URL` in `.env`** to the address people really use, e.g.
  `https://devices.example.com`. Without it the invite links are built from
  the server's own network address and nobody outside can open them.
- **Put HTTPS in front and set `SECURE_COOKIES=1`.** The app serves plain HTTP
  and expects a reverse proxy to terminate TLS. Those links carry a session
  cookie that lasts a fortnight.

Set `SECURE_COOKIES=1` only once HTTPS is actually in front. Set it too early
and the cookie is refused over plain http, which looks exactly like "my
password does not work".
