# Install ProgHard Link on a fresh Ubuntu VPS

This guide targets a technically comfortable hobbyist and a current Ubuntu
Server installation. Commands assume a non-root user with `sudo`. Read each
command before running it and adapt hostnames to your environment.

This server installation uses Docker Compose but never requires the separate
firmware-maintainer build container. Arduino application development likewise
uses Arduino IDE normally. The firmware container is only for reconstructing
official ProgHard Link Base images.

The example namespace is `link.example.com`:

```text
link.example.com
*.link.example.com
```

Replace it with a domain you control. Do not copy `example.com` literally.

## 1. Inspect and update Ubuntu

```bash
sudo apt update
apt list --upgradable
sudo apt upgrade
test -f /var/run/reboot-required && cat /var/run/reboot-required
git --version
```

Reboot if Ubuntu requires it, then reconnect. Do not add swap merely because
this guide mentions it; first observe whether your machine needs it.

## 2. Install Docker from Docker's official APT repository

Do not use `get.docker.com`. Follow Docker's current Ubuntu repository
instructions for your Ubuntu release. The intended packages are:

```text
docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

Validate before proceeding:

```bash
sudo systemctl status docker --no-pager
sudo docker version
sudo docker compose version
sudo docker buildx version
sudo docker info
sudo docker run --rm hello-world
```

This guide continues to use `sudo docker`. Membership in the `docker` group is
effectively root-level access and is not required.

## 3. Prepare DNS

Create two IPv4 records pointing to the new VPS:

```text
A  link    VPS_IPV4
A  *.link  VPS_IPV4
```

If you publish IPv6, ensure it is reachable and intentionally protected before
adding corresponding AAAA records. Verify the apex, `admin`, `install`,
`tunnel`, and an arbitrary device hostname. Caddy cannot obtain public
certificates until DNS and TCP ports 80/443 reach this server.

## 4. Obtain the public source

After the public repository exists:

```bash
sudo install -d -o "$USER" -g "$USER" /opt/proghard-link
git clone https://github.com/OWNER/ProgHard-Link.git /opt/proghard-link
cd /opt/proghard-link
git status
git rev-parse HEAD
```

Use the actual published repository URL in place of `OWNER`. Do not embed a
GitHub token in the clone URL or shell history.

## 5. Configure the instance

```bash
cp .env.example .env
chmod 600 .env
```

Edit only the local `.env`:

```ini
ESPWAY_DOMAIN=link.example.com
ACME_EMAIL=admin@example.net
ESPWAY_OTA_OPERATOR_TOKEN=
```

Use your own operational e-mail. The legacy OTA operator token is optional and
should normally remain empty. Never commit `.env`.

Validate the resolved configuration:

```bash
sudo docker compose config
```

## 6. Build and start

```bash
sudo docker compose build
sudo docker compose pull
sudo docker compose up -d
sudo docker compose ps
```

`data-init` should exit successfully. `server` and `caddy` should become
healthy. Do not use `docker compose down -v` on a real instance: it deletes
persistent application and certificate data.

## 7. Network exposure

Expected public TCP ports are:

```text
22   SSH, if used
80   HTTP and tunnel endpoint
443  HTTPS
```

Node port 3000 and Caddy administration port 2019 must not be published. UDP
443 is not required by this Compose file. Verify with `sudo ss -lntup` and
`sudo docker compose ps`.

Docker programs its own netfilter rules. Do not assume a basic UFW rule alone
filters Docker-published ports; study Docker/UFW interaction for your host
before changing firewall policy.

## 8. Validate HTTPS

Check:

```text
https://link.example.com/
https://admin.link.example.com/
https://install.link.example.com/
http://tunnel.link.example.com/tunnel
```

The tunnel is intentionally HTTP/WebSocket at the ESP side; authenticated
protocol `espway-tunnel/2` provides its own integrity/confidentiality layer.
Do not convert it to WSS without a protocol design change.

## 9. Create the first administrator

```bash
cd /opt/proghard-link
sudo docker compose exec server npm run create-admin -- --username admin
```

The CLI asks twice for a masked password. Do not pass a password through argv,
an environment variable, `printf`, or `echo`. Then sign in at the `admin`
hostname and confirm the Device Manager loads.

## 10. Install the first ESP

Open the Web Installer, flash Base 0.2.3, provision Wi-Fi and the instance URL,
then register the device from its LAN page. Follow [Getting Started](getting-started.md)
and [remote access](remote-access.md).

## 11. Final checks

```bash
sudo docker compose ps
sudo docker compose logs --tail=100 server caddy
sudo docker compose exec -T server stat -c '%n %a %u:%g' /data/devices.json /data/auth.sqlite
git status
```

Both data files should be owned by UID/GID 1000 and mode 0600. Logs must not
contain credentials. Back up the volumes before upgrades.
