# Keeping it running on a Linux server

On **Windows**, use `KEEP-RUNNING-ON-SERVER.bat` in the folder above. It is
the supported route and nothing in here is needed.

This folder holds the **Linux** equivalent: a systemd unit, so the register
starts at boot, runs with nobody logged in, and is restarted if it stops.

```bash
sudo cp service/device-register.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now device-register
```

Before the first start, change `User`, `Group`, `WorkingDirectory`,
`EnvironmentFile` and `ReadWritePaths` in the unit to match where you put the
register. They all assume `/opt/device-register` and a `device-register`
account that owns it.

Then:

```bash
systemctl status device-register        # is it up
journalctl -u device-register -f        # watch it
sudo systemctl restart device-register  # after an upgrade
```

The unit is deliberately tight: no new privileges, a private `/tmp`, a
read-only system with write access only to the register's own folder, and
only the address families it needs. If the register cannot write its database
or its `backups` folder, `ReadWritePaths` is the line to look at.
