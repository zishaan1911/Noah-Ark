# Free online demo

The whole local stack (`compose.yaml`) on one free VM, behind HTTPS. The web pages go on GitHub Pages.

```
GitHub Pages: landing page (/) + Ark Command (/command/) ──wss://<domain>/mqtt──┐
Ark SOS (Android) ──────────────────────────https://<domain>/v1─────────────────┤
                                                                                 v
Oracle Cloud free VM: Caddy (HTTPS) -> Mosquitto, sos-api, sim, fleet, health, gateway
```

Anyone with the link can **watch**. Only a browser opened once with the operator key can **command** drones.

## 1. Get the VM (once)
1. Sign up for [Oracle Cloud Free Tier](https://www.oracle.com/cloud/free/). It asks for a card but does not charge for Always Free resources.
2. Create an instance with the shape **VM.Standard.A1.Flex** (Ampere ARM), 4 OCPU and 24 GB RAM, image **Ubuntu 24.04**.
   If it says "out of capacity", retry later or pick another availability domain.
3. In the instance's VCN security list, add ingress rules for TCP **80** and **443** from `0.0.0.0/0`.
   Ubuntu on Oracle also blocks ports in iptables:
   ```bash
   sudo iptables -I INPUT 6 -p tcp -m multiport --dports 80,443 -j ACCEPT && sudo netfilter-persistent save
   ```

## 2. Get a domain (once)
At [duckdns.org](https://www.duckdns.org), create a subdomain such as `noah-ark.duckdns.org` and point it at the VM's public IP.

## 3. Start the stack
On the VM:
```bash
curl -fsSL https://get.docker.com | sh && sudo usermod -aG docker $USER   # then log out and back in
git clone https://github.com/zishaan1911/Noah-Ark.git && cd Noah-Ark

echo "ARK_DOMAIN=noah-ark.duckdns.org" > .env

# Operator password for commanding drones (pick your own; never commit infra/cloud/passwd)
docker run --rm -v ./infra/cloud:/c eclipse-mosquitto:2.0.22 \
  sh -c 'mosquitto_passwd -c -b /c/passwd operator "CHANGE-ME" && chown 1883:1883 /c/passwd'

# Predictive-maintenance model used by the health service (once)
docker run --rm -v .:/repo -w /repo/ml/predictive-maintenance python:3.12-slim \
  sh -c 'pip install -q -r requirements.txt && python generate.py && python train.py'

docker build -t noah-ark-sitl simulation     # on ARM this compiles ArduCopter: ~20 min, once
docker compose -f compose.yaml -f infra/cloud/compose.yaml up -d --build
```
Check it: `curl https://noah-ark.duckdns.org/v1/health`.

To update after a push: `git pull && docker compose -f compose.yaml -f infra/cloud/compose.yaml up -d --build`.

## 4. Publish the web pages (once)
In the GitHub repo:
1. **Settings → Pages → Source: GitHub Actions**.
2. **Settings → Secrets and variables → Actions → Variables**: add `MQTT_URL` = `wss://noah-ark.duckdns.org/mqtt`.
3. Push to `main` (or run the `pages` workflow by hand).

The links:
- Landing page: `https://zishaan1911.github.io/Noah-Ark/`
- Ark Command, watch only (share this one): `https://zishaan1911.github.io/Noah-Ark/command/#/fleet`
- Ark Command, operator (only on your own demo laptop, once): `https://zishaan1911.github.io/Noah-Ark/command/?key=CHANGE-ME#/fleet`.
  The key is saved in that browser and removed from the address bar.

## 5. Ark SOS on a phone
```bash
cd apps/sos-mobile && ./gradlew assembleDebug -PapiUrl=https://noah-ark.duckdns.org/v1
```
Install `app/build/outputs/apk/debug/app-debug.apk` on the phone, or attach it to a GitHub Release.

## Limits
- One shared operator password, no per-user accounts. Replace it with AWS IoT Core + Cognito once `infra/` CDK is built.
- A watch-only browser that presses a command button gets no error: the broker drops the message silently.
