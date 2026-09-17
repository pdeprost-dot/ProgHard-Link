# Backup and restore

The Compose project stores application data in `proghard-link_app_data` and
Caddy certificates/configuration in `proghard-link_caddy_data` and
`proghard-link_caddy_config`. Back up `.env` separately with restrictive
permissions.

For a consistent backup, schedule a short maintenance window, stop the Compose
services without deleting volumes, and archive each named volume with a trusted
tool. Protect backups as secrets: `auth.sqlite`, device credentials and Caddy
private keys are sensitive.

Restore onto the same application version before starting the stack. Restore
the three volumes and `.env`, run `sudo docker compose config`, then start and
verify ownership/mode, user counts, registered devices, service health and TLS.

Never use `docker compose down -v` as a backup or maintenance command. Test the
restore procedure on a separate host; an untested archive is not a backup plan.
