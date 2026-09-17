# Screenshot inventory

This directory is reserved for authentic screenshots used by future ProgHard
Link user documentation. Do not add reconstructed or synthetic screenshots.

## Current availability

Twelve authentic browser captures from the 2026-09-17 Base 0.2.3 validation
runs are stored below this directory. The runs used a real ESP8266 and
completed Web Installer, provisioning, enrollment, Device Manager ONLINE state
and remote HTTPS access.

Current-capture status meanings:

- **ORIGINAL-TEST**: unmodified evidence captured from the real product test.
- **READY**: visually inspected and suitable for public documentation as
  captured. For this test documentation, the `admin` test account, sacrificial
  ESP Device ID, private test LAN addresses and ordinary device telemetry are
  explicitly permitted.
- **NEEDS-REDACTION**: authentic original containing a real password, token,
  credential, unrelated personal data or private content from another app.
- **RECAPTURE**: authentic test evidence, but not suitable for the guide.
- **SUPERSEDED**: replaced by a newer native capture; retained temporarily for
  traceability until the dedicated cleanup pass.

| File | Step | What it shows | Publication status | Data to mask or issue | Product version |
|---|---|---|---|---|---|
| `web-installer/01-home.png` | Open Web Installer | Current installer, supported targets and next steps | ORIGINAL-TEST / READY | None | Base 0.2.3 / library 0.4.8 |
| `web-installer/02-install-confirmation.png` | Confirm installation | Clean Base 0.2.3 erase confirmation from the second flash | ORIGINAL-TEST / READY | None | Base 0.2.3 |
| `web-installer/03-install-progress.png` | Flash device | Clean real firmware write progress from the second flash | ORIGINAL-TEST / READY | None | Base 0.2.3 |
| `web-installer/04-install-complete.png` | Complete installation | Clean successful installation result from the second flash | ORIGINAL-TEST / READY | None | Base 0.2.3 |
| `provisioning/01-setup-empty.png` | Provision Wi-Fi | Current ProgHard Link Setup form before private data entry | ORIGINAL-TEST / READY | None | Base 0.2.3 |
| `provisioning/02-saved-restarting.png` | Save configuration | Current Saved / Restarting confirmation | ORIGINAL-TEST / READY | None | Base 0.2.3 |
| `provisioning/04-device-lan-page.png` | Return to LAN | Local device page before enrollment and connected Wi-Fi/tunnel state | ORIGINAL-TEST / READY | Inspected: test Device ID and private test LAN IPv4 only | Base 0.2.3 / framework 0.4.8 |
| `device-manager/01-login.png` | Sign in | Clean Device Manager login page with empty fields | ORIGINAL-TEST / READY | None | Server 0.5.0 |
| `device-manager/02-enrollment-confirmation.png` | Confirm claim | Device, hardware and application presented for enrollment | ORIGINAL-TEST / READY | Inspected: test account and sacrificial Device ID only | Server 0.5.0 / Base 0.2.3 |
| `device-manager/03-device-claimed.png` | Complete claim | Successful account association | ORIGINAL-TEST / READY | Inspected: permitted `admin` test account only | Server 0.5.0 |
| `device-manager/04-my-devices-online.png` | View My devices | One Base 0.2.3 ESP8266 online and up to date | ORIGINAL-TEST / READY | Inspected: test account, Device ID and ordinary telemetry only | Server 0.5.0 / Base 0.2.3 |
| `remote-access/01-remote-device-ui.png` | My devices → Open | Real remote HTTPS device UI, registered and tunnel connected | ORIGINAL-TEST / READY | Inspected: test Device ID and private test LAN IPv4 only | Base 0.2.3 / framework 0.4.8 |

Additional screenshots supplied during the run show Windows joining the setup
AP and the completed provisioning form. Their original files were not exposed
to the workspace, so they are not stored here. The completed form contains a
private SSID and requires redaction; the setup-AP screenshots expose the real
device suffix. The clean empty form and saved/restarting states were recovered
directly from their still-open real browser tabs and are stored above.

A follow-up real enrollment on 2026-09-17 removed the obsolete authorization,
registered the freshly flashed ESP8266 again, and verified exactly one ONLINE
device, a connected tunnel, and working **My devices → Open** access. The
native test captures containing the permitted test account, sacrificial Device
ID and private LAN IPv4 address are now publication-ready. No current capture
is marked SUPERSEDED.

Publication still strictly excludes passwords, Wi-Fi passwords, tokens,
secrets, session cookies, private keys, credentials, unrelated personal data,
and private content from other applications or browser tabs.

Thirty-one older screenshots from the 0.2.2 and 0.2.3 validation runs remain
visible only in the historical working conversation. None of their original
image files is available in the repository, Codex attachments, workspace, or
the usual local screenshot folders. They therefore cannot be copied or
published from the current session.

Historical-reference status meanings:

- **A**: directly reusable file.
- **B**: reusable file after cropping or anonymization.
- **C**: obsolete visual reference only.
- **D**: capture must be made again from the current product.

## Historical visual references

These visuals remain useful for planning, but are not available as files.

| Historical content | Step | Approximate version | Branding | Status | Privacy or obsolescence note |
|---|---|---|---|---|---|
| Web Installer landing page | Start installation | Base 0.2.2 | ProgHard Link | C | Old firmware version; replace with current installer. |
| Serial-port selection dialog | Select the ESP USB port | Base 0.2.2 | Browser/ProgHard Link | C | OS-specific dialog; replace with a clean current capture. |
| Installer action dialog | Start installation | 0.2.2 and 0.2.3 | ProgHard Link | D | Current equivalent must be recaptured. |
| Installation confirmation | Confirm erase and flash | 0.2.2 and 0.2.3 | ProgHard Link | D | Recapture the current released version. |
| Installation progress | Flash firmware | Base 0.2.3 | ProgHard Link | D | Historical image showed 86 percent progress. |
| Installation complete dialog | Finish flash | 0.2.2 and 0.2.3 | ProgHard Link | D | Recapture without unrelated browser chrome. |
| Windows Wi-Fi list with setup AP | Discover captive AP | Base 0.2.2 | ESPway AP name | C | Historical technical SSID and surrounding desktop UI. |
| Empty provisioning form | Provision Wi-Fi | Base 0.2.2 | ESPway Setup | C | Obsolete public branding and old default instance. |
| Completed provisioning form | Provision Wi-Fi | Base 0.2.2 | ESPway Setup | C | Contained a private SSID; password was masked. |
| Saved/restarting page | Finish provisioning | Base 0.2.2 | Neutral | C | Old run; current equivalent should be captured. |
| Current captive provisioning form | Provision Wi-Fi | Base 0.2.3 | ProgHard Link Setup | D | Replace with a clean capture using a documentation SSID. |
| Browser network-changed error | Return to LAN | Base 0.2.3 | Browser | D | Historical image exposed browser tabs/bookmarks and setup AP details. |
| Local device page before enrollment | Start enrollment | Base 0.2.2 and 0.2.3 | Mixed/current | D | Current capture must use a non-production Device ID. |
| Sign-in page | Authenticate | Base 0.2.2-era server | ProgHard Link | D | Historical image showed a personal username. |
| Enrollment confirmation | Claim device | Base 0.2.2 and 0.2.3 | ProgHard Link | D | Historical images showed a real Device ID. |
| Enrollment success | Complete claim | Base 0.2.2 and 0.2.3 | ProgHard Link | D | Recapture with a documentation-only device identity. |
| My devices list | Confirm online state | Base 0.2.2 and 0.2.3 | ProgHard Link | D | Historical images showed real account/device details. |
| Local registered state | Confirm tunnel connection | Base 0.2.3 | ProgHard Link | D | Historical image showed LAN IP and real Device ID. |
| Direct remote access rejected | Explain ticket requirement | Base 0.2.3 | Browser/plain response | D | Recapture with a documentation-only hostname. |
| Remote device UI | Use remote access | Base 0.2.3 | ProgHard Link | D | Historical images showed real Device ID and browser UI. |
| Base application UI after migration | Control sample LED | Base 0.2.3 / framework 0.4.8 | ProgHard Link | D | Current product, but real Device ID is visible and no source file remains. |

Several rows consolidate near-duplicate screenshots from the two validation
runs. The historical conversation contains 31 individual images in total.

## Capture plan

Create new, authentic captures with a dedicated documentation account, test
SSID, and non-production device identity. Crop browser tabs, bookmarks,
profile names, and operating-system notifications unless they are essential to
the step.

| Planned file | Step | Required state |
|---|---|---|
| `web-installer/web-installer-home.png` | Open Web Installer | Current public installer and release version. |
| `web-installer/web-installer-select-port.png` | Select serial port | Only the relevant browser dialog and generic port label. |
| `web-installer/web-installer-confirm.png` | Confirm installation | Current Base version. |
| `web-installer/web-installer-flashing.png` | Flash device | Progress visible, no unrelated browser UI. |
| `web-installer/web-installer-complete.png` | Complete installation | Successful completion dialog. |
| `provisioning/provisioning-access-point.png` | Join setup AP | Documentation-only AP/device identity. |
| `provisioning/provisioning-wifi.png` | Configure Wi-Fi | Documentation SSID; password field empty or safely masked. |
| `provisioning/provisioning-restarting.png` | Restart device | Successful save/restart state. |
| `provisioning/device-lan-page.png` | Find device on LAN | Documentation LAN and Device ID. |
| `device-manager/device-manager-login.png` | Sign in | Documentation account name. |
| `device-manager/device-manager-enrollment.png` | Confirm claim | Documentation-only device. |
| `device-manager/device-manager-registered.png` | Complete claim | No production identity. |
| `device-manager/device-manager-my-devices.png` | View devices | Online documentation device. |
| `device-manager/device-manager-details.png` | Inspect status | Sanitized telemetry and network details. |
| `remote-access/remote-access-open.png` | Open device | Device Manager action and safe hostname. |
| `remote-access/remote-device-ui.png` | Use remote UI | Documentation-only Device ID. |
| `arduino/arduino-library-install.png` | Install library ZIP | ProgHard Link 0.4.8 or the then-current release. |
| `arduino/arduino-example.png` | Open an example | Current public example and compatibility include. |
| `arduino/arduino-export-binary.png` | Export compiled binary | Current Arduino IDE menu/action. |
| `ota/ota-upload.png` | Start OTA | Sanitized filename and device identity. |
| `ota/ota-success.png` | Complete OTA | Successful current workflow. |

The VPS installation portion also lacks authentic screenshots. Prefer concise
terminal excerpts with fake hostnames and no secrets, or diagrams, rather than
screenshots containing a real server address, shell history, or credentials.
