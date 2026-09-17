# Upgrade an existing installation

1. Record `git rev-parse HEAD` and `sudo docker compose ps`.
2. Back up `.env` and all three named volumes.
3. Read release notes and confirm required Docker/Node/firmware versions.
4. Fetch and fast-forward only:

```bash
cd /opt/proghard-link
git fetch origin main
git merge --ff-only origin/main
sudo docker compose config
sudo docker compose build server
sudo docker compose up -d
```

5. Wait for `server` and `caddy` to become healthy.
6. Verify users, devices, TLS, public ports, logs and the Web Installer.

Do not remove volumes during an upgrade. If rollback is required, restore the
recorded source revision together with a compatible backup; source rollback
alone cannot reverse a database schema migration.
