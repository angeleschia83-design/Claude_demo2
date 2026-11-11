# Running it so it stays up

`START-ON-WINDOWS.bat` and `START-ON-MAC.command` run the register **inside
your login session**. That is right for trying it on a laptop and wrong for a
server: Windows ends a session's processes when you log off, so the register
stops the moment whoever started it disconnects. Nothing is broken when that
happens — the server is up, the process is not.

A server needs it running as a service: started at boot, with nobody logged
in, restarted if it stops.

## Windows

From an **Administrator** PowerShell, in the folder you unzipped:

```powershell
powershell -ExecutionPolicy Bypass -File service\install-windows.ps1
```

It registers a scheduled task called **Device register** that:

- starts at boot and runs as `SYSTEM`, so no login is involved
- restarts itself a minute after any stop
- has no time limit, so Windows never ends it for running too long
- writes everything to `logs\server.log`, rolled at 5 MB, one old copy kept

It checks `/healthz` before it finishes and tells you if the register did not
answer.

Afterwards:

```powershell
Get-ScheduledTask -TaskName 'Device register'     # is it registered
Stop-ScheduledTask  -TaskName 'Device register'   # stop it
Start-ScheduledTask -TaskName 'Device register'   # start it
Get-Content logs\server.log -Wait -Tail 20        # watch it
powershell -ExecutionPolicy Bypass -File service\uninstall-windows.ps1
```

**A service account instead of SYSTEM**, if your policy wants least privilege:

```powershell
powershell -ExecutionPolicy Bypass -File service\install-windows.ps1 `
  -UserId 'DOMAIN\svc-device-register' -Password 'the password'
```

That account needs **Log on as a batch job** and read/write on this folder.

**Two things that catch people out.** Keep the folder on a local disk: as
`SYSTEM` the task cannot reach a mapped drive or a user profile path. And
open the port in Windows Firewall if people reach the register from other
machines — nothing in the app does that for you.

## Linux

```bash
sudo cp service/device-register.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now device-register
```

Edit `User`, `Group` and `WorkingDirectory` in the unit first if the register
does not live in `/opt/device-register`.

```bash
systemctl status device-register
journalctl -u device-register -f
```

The unit restarts on failure and confines the process: no new privileges, a
read-only system apart from its own folder, no access to home directories.

## Either way

The register still binds to localhost by design and expects a reverse proxy
to terminate TLS. Set `PUBLIC_URL` in `.env` to the address people use, or
the invite links you hand out will carry an address nobody can reach.
