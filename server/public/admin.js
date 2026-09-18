const content = document.querySelector("#content");
const summary = document.querySelector("#summary");
const dialog = document.querySelector("#dialog");
const dialogForm = document.querySelector("#dialog-form");
const dialogContent = document.querySelector("#dialog-content");
const confirmButton = document.querySelector("#dialog-confirm");
const cancelButton = document.querySelector("#dialog-cancel");
let confirmAction = null;
let currentUser = null;
let csrfToken = "";
let enrollmentFinished = false;

function text(value, fallback = "—") {
  return value === undefined || value === null || value === "" ? fallback : String(value);
}

function applicationLabel(value) {
  return value === "espway-base" ? "ProgHard Link Base" : text(value);
}

function node(tag, attributes = {}, children = []) {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (name === "className") element.className = value;
    else if (name === "textContent") element.textContent = value;
    else element.setAttribute(name, value);
  }
  for (const child of children) element.append(child);
  return element;
}

async function api(path, options = {}) {
  const request = options.body ? {
    ...options,
    headers: { "content-type": "application/json", "x-espway-admin-request": "1", "x-espway-csrf": csrfToken, ...options.headers },
    body: JSON.stringify(options.body),
  } : options;
  const response = await fetch(path, request);
  if (response.status === 401) { location.href = `/login?next=${encodeURIComponent(location.pathname)}`; throw new Error("Session expired"); }
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || `HTTP ${response.status}`);
  return value;
}

async function openDevice(deviceId) {
  const result = await api(`/api/admin/devices/${deviceId}/access-ticket`, { method: "POST", body: {} });
  const form = node("form", { method: "POST", action: result.url }, [
    node("input", { type: "hidden", name: "ticket", value: result.ticket }),
    node("input", { type: "hidden", name: "next", value: "/" }),
  ]);
  document.body.append(form);
  form.submit();
}

function openDeviceButton(deviceId, label = "Open") {
  const button = node("button", { type: "button", textContent: label });
  button.addEventListener("click", () => openDevice(deviceId).catch((error) => alert(error.message)));
  return button;
}

function statusLabel(device) {
  return node("span", {
    className: `status ${device.online ? "online" : "offline"}`,
    textContent: device.online ? "ONLINE" : "OFFLINE",
  });
}

function firmwareLabel(device) {
  const labels = {
    latest: "Up to date",
    update_available: "Update available",
    no_compatible_release: "No compatible release",
    unknown_application: "Unknown application",
    unsupported_version: "Unsupported version",
  };
  return labels[device.firmware?.state] || text(device.firmware?.state);
}

function telemetryAge(sampledAt) {
  const ageSeconds = Math.max(
    0,
    Math.floor((Date.now() - Date.parse(sampledAt)) / 1000),
  );
  if (!Number.isFinite(ageSeconds)) return "waiting";
  if (ageSeconds < 60) return `${ageSeconds} s ago`;
  if (ageSeconds < 3600) return `${Math.floor(ageSeconds / 60)} min ago`;
  if (ageSeconds < 86400) return `${Math.floor(ageSeconds / 3600)} h ago`;
  return `${Math.floor(ageSeconds / 86400)} d ago`;
}

function dateLabel(value) {
  if (!value) return "Never";
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return text(value);
  return `${new Date(parsed).toLocaleString()} (${telemetryAge(value)})`;
}

function friendlyError(error) {
  const messages = {
    device_already_exists: "This device is already registered.",
    device_already_registered: "This device is already registered.",
    enrollment_not_found: "This registration link is invalid or has already been used.",
    enrollment_expired: "This registration link has expired. Start registration again from the device.",
    invalid_device_id: "Enter the Device ID shown by the device (for example esp-a1b2c3).",
    password_confirmation_mismatch: "The password confirmation does not match.",
    invalid_current_password: "The current password is incorrect.",
    user_already_exists: "This username is already in use.",
  };
  return messages[error?.message] || error?.message || "The operation could not be completed.";
}

function rssiQuality(rssi) {
  if (typeof rssi !== "number" || !Number.isFinite(rssi)) return "Unknown";
  if (rssi > -55) return "Excellent";
  if (rssi > -67) return "Good";
  if (rssi > -75) return "Fair";
  return "Weak";
}

function telemetrySummary(device) {
  const telemetry = device.telemetry;
  if (!telemetry?.sampledAt) return ["Telemetry: waiting"];
  const lines = [];
  if (telemetry.wifi?.rssi !== null && telemetry.wifi?.rssi !== undefined) {
    lines.push(
      `Wi-Fi: ${telemetry.wifi.rssi} dBm (${rssiQuality(telemetry.wifi.rssi)})`,
    );
  }
  if (telemetry.mqtt?.enabled) {
    lines.push(`MQTT: ${telemetry.mqtt.connected ? "Connected" : "Disconnected"}`);
  }
  lines.push(
    `Telemetry: ${telemetryAge(telemetry.sampledAt)}${telemetry.stale ? " - stale" : ""}`,
  );
  return lines;
}

function deviceCard(device) {
  const card = node("article", { className: "card" });
  card.append(statusLabel(device));
  card.append(node("h2", { textContent: text(device.deviceName, "Unnamed device") }));
  card.append(node("p", { className: "device-id", textContent: device.deviceId }));
  card.append(node("p", {
    className: "metadata",
    textContent: `Firmware ${text(device.applicationVersion)} · ${firmwareLabel(device)}`,
  }));
  card.append(node("p", {
    className: "telemetry-summary",
    textContent: telemetrySummary(device).join("\n"),
  }));
  if (!device.online) card.append(node("p", {
    className: "last-seen",
    textContent: device.lastSeen ? `Last seen ${telemetryAge(device.lastSeen)}` : "Never connected",
  }));
  const actions = node("div", { className: "actions" });
  actions.append(openDeviceButton(device.deviceId));
  actions.append(node("a", {
    className: "button secondary",
    href: `/devices/${device.deviceId}`,
    textContent: "Details",
  }));
  card.append(actions);
  return card;
}

function addField(list, label, value) {
  list.append(node("dt", { textContent: label }));
  list.append(node("dd", { textContent: text(value) }));
}

function showDetail(device) {
  summary.textContent = "";
  const panel = node("section", { className: "panel" });
  panel.append(statusLabel(device));
  panel.append(node("h1", { textContent: text(device.deviceName, "Unnamed device") }));
  panel.append(node("p", { className: "device-id", textContent: device.deviceId }));
  const fields = node("dl");
  for (const [label, value] of [
    ["Device name", device.deviceName],
    ["Hardware", device.hardware],
    ["Application", applicationLabel(device.application)],
    ["Firmware", device.applicationVersion],
    ["Framework", device.frameworkVersion],
    ["Transport", device.transport],
    ["Protocol", device.tunnelProtocol],
    ["Metadata verified", device.metadataVerified],
    ["Capabilities", device.capabilities?.join(", ")],
    ["Connected since", device.connectedSince ? dateLabel(device.connectedSince) : undefined],
    ["Last seen", dateLabel(device.lastSeen)],
    ["Latest released", device.firmware?.latestReleasedVersion],
    ["Firmware status", firmwareLabel(device)],
  ]) addField(fields, label, value);
  panel.append(fields);

  const telemetry = device.telemetry;
  const observability = node("section", { className: "observability" });
  observability.append(node("h2", { textContent: "Observability" }));
  if (!telemetry?.sampledAt) {
    observability.append(node("p", { textContent: "Telemetry: waiting" }));
  } else {
    const telemetryFields = node("dl");
    for (const [label, value] of [
      ["Last sample", telemetry.sampledAt],
      ["Age", telemetryAge(telemetry.sampledAt)],
      ["State", telemetry.stale ? "Stale" : "Current"],
    ]) addField(telemetryFields, label, value);
    observability.append(node("h3", { textContent: "Telemetry" }));
    observability.append(telemetryFields);

    const wifi = telemetry.wifi;
    observability.append(node("h3", { textContent: "Wi-Fi" }));
    const wifiFields = node("dl");
    for (const [label, value] of [
      ["Connected", wifi ? (wifi.connected ? "Yes" : "No") : undefined],
      ["RSSI", wifi?.rssi === null ? undefined : `${wifi?.rssi} dBm`],
      ["Quality", rssiQuality(wifi?.rssi)],
      ["Active profile", wifi?.activeProfile],
      ["Last known good", wifi?.lastKnownGoodProfile],
      ["SSID", wifi?.activeSsid],
      ["LAN IPv4", wifi?.ip],
      ["Recovery AP", wifi ? (wifi.apActive ? "Yes" : "No") : undefined],
      ["Last poll error", telemetry.errors?.wifi],
    ]) addField(wifiFields, label, value);
    observability.append(wifiFields);

    const mqtt = telemetry.mqtt;
    observability.append(node("h3", { textContent: "Local MQTT" }));
    const mqttFields = node("dl");
    for (const [label, value] of [
      ["Enabled", mqtt ? (mqtt.enabled ? "Yes" : "No") : undefined],
      ["Connected", mqtt?.enabled ? (mqtt.connected ? "Yes" : "No") : "Not enabled"],
      ["Broker", mqtt?.host],
      ["Port", mqtt?.port],
      ["Base topic", mqtt?.baseTopic],
      ["Last poll error", telemetry.errors?.mqtt],
    ]) addField(mqttFields, label, value);
    observability.append(mqttFields);
  }
  panel.append(observability);

  const apiUrl = `${device.deviceUrl}api/status`;
  const apiAccess = node("section", { className: "observability" }, [
    node("h2", { textContent: "Remote HTTPS API" }),
    node("p", { textContent: "Use a Personal API Token. Existing tokens are never inserted or displayed here." }),
    node("code", { className: "token", textContent: apiUrl }),
  ]);
  const copyUrl = node("button", { type: "button", className: "secondary", textContent: "Copy URL" });
  copyUrl.addEventListener("click", async () => {
    await navigator.clipboard.writeText(apiUrl);
    copyUrl.textContent = "Copied";
  });
  apiAccess.append(copyUrl);
  apiAccess.append(node("pre", { className: "example", textContent:
    `curl -H "Authorization: Bearer <personal-api-token>" ${apiUrl}\n\n` +
    `Node-RED: msg.url = "${apiUrl}";\n` +
    `Python: requests.get("${apiUrl}", headers={"Authorization": "Bearer <personal-api-token>"})`,
  }));
  panel.append(apiAccess);

  const actions = node("div", { className: "actions" });
  actions.append(node("a", {
    className: "button secondary",
    href: "/",
    textContent: "Back",
  }));
  actions.append(openDeviceButton(device.deviceId, "Open device"));
  const enabledButton = node("button", {
    type: "button",
    className: "secondary",
    textContent: device.enabled ? "Disable" : "Enable",
  });
  enabledButton.addEventListener("click", () => changeEnabled(device));
  actions.append(enabledButton);
  const editButton = node("button", {
    type: "button",
    className: "secondary",
    textContent: "Edit",
  });
  editButton.addEventListener("click", () => editDevice(device));
  actions.append(editButton);
  const deleteButton = node("button", {
    type: "button",
    className: "danger",
    textContent: "Delete device",
  });
  deleteButton.addEventListener("click", () => deleteDevice(device));
  actions.append(deleteButton);
  if (device.online && device.firmware?.latest) {
    const otaButton = node("button", { type: "button", textContent: "Install released firmware" });
    otaButton.addEventListener("click", () => confirmOta(device));
    actions.append(otaButton);
  }
  if (device.online && device.capabilities?.includes("http-ota")) {
    const uploadButton = node("button", { type: "button", textContent: "Update firmware" });
    uploadButton.addEventListener("click", () => updateFirmware(device));
    actions.append(uploadButton);
  }
  panel.append(actions);
  content.replaceChildren(panel);
}

function openDialog(fragment, action, label = "Confirm") {
  dialogForm.reset();
  dialogContent.replaceChildren(fragment);
  confirmButton.textContent = label;
  confirmAction = action;
  dialog.showModal();
}

function closeDialog() {
  confirmAction = null;
  dialogForm.reset();
  dialogContent.replaceChildren();
  if (dialog.open) dialog.close();
}

function editDevice(device) {
  const fragment = node("div", {}, [
    node("h2", { textContent: `Edit ${device.deviceId}` }),
    node("label", { textContent: "Device name" }, [
      node("input", {
        id: "edit-device-name",
        maxlength: "128",
        value: device.deviceName || "",
      }),
    ]),
  ]);
  openDialog(fragment, async () => {
    await api(`/api/admin/devices/${device.deviceId}`, {
      method: "PATCH",
      body: { deviceName: document.querySelector("#edit-device-name").value },
    });
    await loadDetail(device.deviceId);
  }, "Save");
}

function deleteDevice(device) {
  const fragment = node("div", {}, [
    node("h2", { textContent: "Delete device?" }),
    node("p", { textContent: `Device ID: ${device.deviceId}` }),
    node("p", { textContent: `Device name: ${text(device.deviceName)}` }),
    node("p", {
      className: "error",
      textContent:
        "Deletion removes this device authorization. Its current token will no longer work.",
    }),
  ]);
  openDialog(fragment, async () => {
    await api(`/api/admin/devices/${device.deviceId}`, {
      method: "DELETE",
      body: {},
    });
    location.href = "/";
  }, "Delete device");
}

function confirmOta(device) {
  const target = device.firmware.latest;
  const fragment = node("div", {}, [
    node("h2", { textContent: `Update ${device.deviceId}` }),
    node("p", {
      textContent: `Current: ${applicationLabel(device.application)} ${text(device.applicationVersion)}`,
    }),
    node("p", {
      textContent: `Target: ${applicationLabel(target.application)} ${target.applicationVersion}`,
    }),
    node("p", { textContent: `Size: ${target.size} bytes` }),
    node("p", {}, [node("code", { textContent: `SHA-256: ${target.sha256}` })]),
  ]);
  openDialog(fragment, async () => {
    await api(`/api/admin/devices/${device.deviceId}/ota`, {
      method: "POST",
      body: { applicationVersion: target.applicationVersion },
    });
    alert("OTA accepted by the device.");
  }, device.firmware.state === "latest"
    ? "Reinstall current firmware"
    : "Install update");
}

function formatBytes(value) {
  if (!Number.isFinite(value)) return "Unknown";
  return `${(value / (1024 * 1024)).toFixed(2)} MiB (${value} bytes)`;
}

async function sha256File(file) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function uploadFirmware(deviceId, file, sha256, status, progress) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", `/api/admin/devices/${deviceId}/ota-upload`);
    request.setRequestHeader("X-ESPway-Admin-Request", "1");
    request.setRequestHeader("X-ESPway-CSRF", csrfToken);
    request.setRequestHeader("X-ESPway-OTA-Size", String(file.size));
    request.setRequestHeader("X-ESPway-OTA-SHA256", sha256);
    request.upload.addEventListener("progress", (event) => {
      if (!event.lengthComputable) return;
      const percent = Math.round(event.loaded * 100 / event.total);
      progress.value = percent;
      status.textContent = `Uploading: ${percent}%`;
    });
    request.addEventListener("load", () => {
      let body = {};
      try { body = JSON.parse(request.responseText); } catch {}
      if (request.status >= 200 && request.status < 300) resolve(body);
      else reject(new Error(body.error || `HTTP ${request.status}`));
    });
    request.addEventListener("error", () => reject(new Error("Firmware upload failed")));
    const body = new FormData();
    body.append("update", file, file.name);
    request.send(body);
  });
}

async function waitForReconnect(deviceId, previousConnectedSince, status) {
  status.textContent = "Firmware validated. Waiting for reboot and reconnection...";
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 2500));
    try {
      const device = await api(`/api/admin/devices/${deviceId}`);
      if (device.online && device.connectedSince !== previousConnectedSince) {
        status.textContent = "Device reconnected and ONLINE.";
        return device;
      }
    } catch {}
  }
  throw new Error("Firmware was accepted, but the device did not reconnect in time");
}

function updateFirmware(device) {
  const capacity = Number.isSafeInteger(device.otaMaxBytes) ? device.otaMaxBytes : 1048576;
  const capacitySource = Number.isSafeInteger(device.otaMaxBytes)
    ? "reported by this device" : "conservative limit for older firmware";
  const fileInput = node("input", { id: "firmware-file", type: "file", accept: ".bin,application/octet-stream", required: "" });
  const status = node("p", { id: "ota-status", textContent: "Choose a firmware binary." });
  const progress = node("progress", { max: "100", value: "0" });
  const selected = node("p", { className: "help" });
  fileInput.addEventListener("change", () => {
    const file = fileInput.files[0];
    selected.textContent = file ? `${file.name}: ${formatBytes(file.size)}` : "";
  });
  openDialog(node("div", {}, [
    node("h2", { textContent: `Update firmware — ${device.deviceId}` }),
    node("p", { textContent: `OTA capacity: ${formatBytes(capacity)} (${capacitySource}).` }),
    node("label", { textContent: "Firmware (.bin)" }, [fileInput]),
    selected, progress, status,
    node("p", { className: "help", textContent: "The Device Token remains internal and is never requested." }),
  ]), async () => {
    const file = fileInput.files[0];
    if (!file) throw new Error("Select a .bin firmware file");
    if (!file.name.toLowerCase().endsWith(".bin")) throw new Error("Firmware must be a .bin file");
    if (file.size > capacity) throw new Error(`Firmware exceeds the ${formatBytes(capacity)} OTA capacity`);
    status.textContent = "Validating firmware (SHA-256)...";
    const digest = await sha256File(file);
    status.textContent = "Starting authenticated OTA...";
    await uploadFirmware(device.deviceId, file, digest, status, progress);
    await waitForReconnect(device.deviceId, device.connectedSince, status);
    await loadDetail(device.deviceId);
  }, "Update firmware");
}

function changeEnabled(device) {
  const action = device.enabled ? "disable" : "enable";
  const explanation = action === "disable"
    ? "The active session is kept; the next connection will be refused."
    : "The device may connect again immediately.";
  const title = `${action === "enable" ? "Enable" : "Disable"} ${device.deviceId}?`;
  openDialog(node("div", {}, [
    node("h2", { textContent: title }),
    node("p", { textContent: explanation }),
  ]), async () => {
    await api(`/api/admin/devices/${device.deviceId}/${action}`, {
      method: "POST",
      body: {},
    });
    await loadDetail(device.deviceId);
  });
}

document.querySelector("#add-device").addEventListener("click", () => {
  const fragment = node("div", {}, [
    node("h2", { textContent: "Register a device" }),
    node("p", { textContent: "Connect the new device to Wi-Fi, open its local page, then choose “Register this device in ProgHard Link”." }),
    node("p", { className: "help", textContent: "The device identity and machine credential are transferred automatically. You do not need to copy a Device ID or token." }),
  ]);
  openDialog(fragment, async () => {}, "Got it");
});

async function loadEnrollment(token) {
  if (enrollmentFinished) return;
  const enrollment = await api(`/api/enrollments/${token}`);
  summary.textContent = "Register device";
  const panel = node("section", { className: "panel enrollment" }, [
    node("h1", { textContent: "Register this device?" }),
    node("p", { textContent: "The device will be added to My devices for your account." }),
  ]);
  const fields = node("dl");
  for (const [label, value] of [
    ["Device", enrollment.deviceName || "Unnamed device"],
    ["Hardware", enrollment.hardware],
    ["Application", applicationLabel(enrollment.application)],
    ["Device ID", enrollment.deviceId],
  ]) addField(fields, label, value);
  panel.append(fields);
  const register = node("button", { type: "button", textContent: "Register device" });
  register.addEventListener("click", async () => {
    register.disabled = true;
    try {
      const result = await api(`/api/enrollments/${token}/claim`, {
        method: "POST", body: {},
      });
      enrollmentFinished = true;
      summary.textContent = "Device registered successfully";
      content.replaceChildren(node("section", { className: "panel success" }, [
        node("h1", { textContent: "Device registered successfully" }),
        node("p", { textContent: `${result.deviceName || "Device"} is now associated with your account.` }),
        node("div", { className: "actions" }, [
          openDeviceButton(result.deviceId, "Open device"),
          node("a", { className: "button secondary", href: "/", textContent: "My devices" }),
        ]),
      ]));
    } catch (error) {
      panel.append(node("p", { className: "error", role: "alert", textContent: friendlyError(error) }));
      register.disabled = false;
    }
  });
  panel.append(node("div", { className: "actions" }, [register, node("a", {
    className: "button secondary", href: "/", textContent: "Cancel",
  })]));
  content.replaceChildren(panel);
}

dialogForm.addEventListener("submit", async (event) => {
  if (event.submitter?.value !== "default") return;
  event.preventDefault();
  const submittedAction = confirmAction;
  const previousLabel = confirmButton.textContent;
  confirmButton.disabled = true;
  confirmButton.textContent = `${previousLabel}...`;
  try {
    await submittedAction?.();
    if (dialog.open && confirmAction === submittedAction) dialog.close();
  } catch (error) {
    dialogContent.append(node("p", { className: "error", role: "alert", textContent: friendlyError(error) }));
  } finally {
    if (confirmAction === submittedAction) {
      confirmButton.disabled = false;
      confirmButton.textContent = previousLabel;
    }
  }
});

cancelButton.addEventListener("click", closeDialog);

document.querySelector("#logout").addEventListener("click", async () => {
  await api("/api/auth/logout", { method: "POST", body: {} });
  location.href = "/login";
});

document.querySelector("#my-account").addEventListener("click", () => {
  const fragment = node("div", {}, [
    node("h2", { textContent: "My account" }),
    node("p", { textContent: currentUser.displayName || currentUser.username }),
    node("label", { textContent: "Current password" }, [node("input", { id: "current-password", type: "password", required: "", autocomplete: "current-password" })]),
    node("label", { textContent: "New password (12 characters minimum)" }, [node("input", { id: "new-password", type: "password", required: "", minlength: "12", autocomplete: "new-password" })]),
    node("label", { textContent: "Confirm new password" }, [node("input", { id: "confirm-new-password", type: "password", required: "", minlength: "12", autocomplete: "new-password" })]),
  ]);
  openDialog(fragment, async () => {
    await api("/api/auth/password", { method: "POST", body: {
      currentPassword: document.querySelector("#current-password").value,
      newPassword: document.querySelector("#new-password").value,
      confirmPassword: document.querySelector("#confirm-new-password").value,
    } });
    alert("Password changed. Your current session remains active; other sessions were signed out.");
  }, "Change password");
});

function showCreatedToken(created) {
  const copy = node("button", { type: "button", className: "secondary", textContent: "Copy token" });
  copy.addEventListener("click", async () => {
    await navigator.clipboard.writeText(created.token);
    copy.textContent = "Copied";
  });
  const saved = node("input", { id: "token-saved", type: "checkbox" });
  const fragment = node("div", {}, [
    node("h2", { textContent: "Token created" }),
    node("p", { className: "warning", textContent: "This token will only be shown once. Save it now." }),
    node("code", { className: "token", textContent: created.token }),
    copy,
    node("label", { className: "checkbox-label" }, [saved, document.createTextNode(" I have saved this token")]),
  ]);
  openDialog(fragment, async () => {}, "Done");
  confirmButton.disabled = true;
  cancelButton.hidden = true;
  saved.addEventListener("change", () => { confirmButton.disabled = !saved.checked; });
  const preventClose = (event) => { if (!saved.checked) event.preventDefault(); };
  dialog.addEventListener("cancel", preventClose);
  dialog.addEventListener("close", () => {
    dialog.removeEventListener("cancel", preventClose);
    cancelButton.hidden = false;
    confirmButton.disabled = false;
  }, { once: true });
}

document.querySelector("#api-tokens").addEventListener("click", async () => {
  const tokens = await api("/api/auth/tokens");
  const list = node("div", {}, [node("h2", { textContent: "Personal API tokens" })]);
  for (const token of tokens) {
    const revoke = node("button", { type: "button", className: "danger", textContent: token.revokedAt ? "Revoked" : "Revoke" });
    revoke.disabled = Boolean(token.revokedAt);
    revoke.addEventListener("click", () => openDialog(node("div", {}, [
      node("h2", { textContent: "Revoke API token?" }),
      node("p", { textContent: token.name }),
      node("p", { className: "error", textContent: "Applications using this token will immediately lose access." }),
    ]), async () => { await api(`/api/auth/tokens/${token.id}`, { method: "DELETE", body: {} }); }, "Revoke token"));
    list.append(node("div", { className: "token-row" }, [
      node("strong", { textContent: token.name }),
      node("span", { textContent: `Created: ${dateLabel(token.createdAt)}` }),
      node("span", { textContent: `Last used: ${token.lastUsedAt ? dateLabel(token.lastUsedAt) : "Never"}` }),
      revoke,
    ]));
  }
  list.append(node("label", { textContent: "New token name" }, [node("input", { id: "token-name", maxlength: "80", placeholder: "Node-RED home" })]));
  openDialog(list, async () => {
    const created = await api("/api/auth/tokens", { method: "POST", body: { name: document.querySelector("#token-name").value } });
    showCreatedToken(created);
  }, "Create token");
});

async function loadUsers() {
  const users = await api("/api/admin/users");
  summary.textContent = `${users.length} users`;
  const panel = node("section", { className: "panel" }, [node("h1", { textContent: "Users" })]);
  for (const user of users) {
    const edit = node("button", { type: "button", className: "secondary", textContent: "Edit" });
    edit.addEventListener("click", () => editUser(user));
    const remove = node("button", { type: "button", className: "danger", textContent: "Delete" });
    remove.disabled = user.id === currentUser.id;
    remove.addEventListener("click", () => openDialog(node("div", {}, [
      node("h2", { textContent: "Delete user?" }),
      node("p", { textContent: user.username }),
      node("p", { className: "error", textContent: "This removes the user, device assignments, sessions and API tokens." }),
    ]), async () => { await api(`/api/admin/users/${user.id}`, { method: "DELETE", body: {} }); await loadUsers(); }, "Delete user"));
    panel.append(node("div", { className: "user-row" }, [
      node("strong", { textContent: user.displayName || user.username }),
      node("span", { textContent: user.role }),
      node("span", { textContent: `${user.enabled ? "Enabled" : "Disabled"} · ${user.role === "admin" ? "All devices (admin)" : (user.deviceIds.join(", ") || "No devices")}` }),
      node("div", { className: "row-actions" }, [edit, remove]),
    ]));
  }
  const add = node("button", { type: "button", textContent: "Add user" });
  add.addEventListener("click", () => editUser(null));
  panel.append(add);
  content.replaceChildren(panel);
}

function editUser(user) {
  const role = node("select", { id: "user-role" }, [node("option", { value: "user", textContent: "user" }), node("option", { value: "admin", textContent: "admin" })]);
  role.value = user?.role || "user";
  const fragment = node("div", {}, [
    node("h2", { textContent: user ? `Edit ${user.username}` : "Add user" }),
    ...(user ? [] : [node("label", { textContent: "Username" }, [node("input", { id: "user-name", required: "", maxlength: "32" })])]),
    node("label", { textContent: "Display name" }, [node("input", { id: "user-display", maxlength: "128", value: user?.displayName || "" })]),
    node("label", { textContent: "Role" }, [role]),
    node("label", { textContent: user ? "New password (leave empty to keep it)" : "Password (12 characters minimum)" }, [node("input", { id: "user-password", type: "password", minlength: "12", ...(user ? {} : { required: "" }) })]),
    node("label", { textContent: user ? "Confirm new password" : "Confirm password" }, [node("input", { id: "user-password-confirm", type: "password", minlength: "12", ...(user ? {} : { required: "" }) })]),
    ...(user ? [node("label", { textContent: "Assigned device IDs (comma-separated)" }, [node("input", { id: "user-devices", value: user.deviceIds.join(", ") })])] : []),
  ]);
  if (user) fragment.append(node("label", {}, [node("input", { id: "user-enabled", type: "checkbox" }), document.createTextNode(" Enabled")]));
  openDialog(fragment, async () => {
    const password = document.querySelector("#user-password").value;
    const passwordConfirmation = document.querySelector("#user-password-confirm").value;
    if (password !== passwordConfirmation) throw new Error("Password confirmation does not match");
    const body = { displayName: document.querySelector("#user-display").value, role: role.value };
    if (password) { body.password = password; body.confirmPassword = passwordConfirmation; }
    if (user) {
      body.enabled = document.querySelector("#user-enabled").checked;
      await api(`/api/admin/users/${user.id}`, { method: "PATCH", body });
      const requested = new Set(document.querySelector("#user-devices").value.split(",").map((value) => value.trim()).filter(Boolean));
      for (const deviceId of requested) if (!user.deviceIds.includes(deviceId))
        await api(`/api/admin/users/${user.id}/devices/${deviceId}`, { method: "POST", body: {} });
      for (const deviceId of user.deviceIds) if (!requested.has(deviceId))
        await api(`/api/admin/users/${user.id}/devices/${deviceId}`, { method: "DELETE", body: {} });
    } else {
      body.username = document.querySelector("#user-name").value; body.password = password; body.confirmPassword = passwordConfirmation;
      await api("/api/admin/users", { method: "POST", body });
    }
    await loadUsers();
  }, "Save");
  if (user) document.querySelector("#user-enabled").checked = user.enabled;
}

async function loadList() {
  const devices = await api("/api/admin/devices");
  const online = devices.filter((device) => device.online).length;
  summary.textContent = `${devices.length} devices · ${online} online`;
  content.replaceChildren(node("div", { className: "grid" }, devices.map(deviceCard)));
}

async function loadDetail(deviceId) {
  showDetail(await api(`/api/admin/devices/${deviceId}`));
}

async function refresh() {
  const match = /^\/devices\/(esp-[a-f0-9]{6,16})$/.exec(location.pathname);
  const enrollment = /^\/enroll\/([A-Za-z0-9_-]{43})$/.exec(location.pathname);
  try {
    if (location.pathname === "/users") await loadUsers();
    else if (enrollment) await loadEnrollment(enrollment[1]);
    else if (match) await loadDetail(match[1]);
    else await loadList();
  } catch (error) {
    content.replaceChildren(node("p", { className: "error", textContent: error.message }));
  }
}

async function initialize() {
  const auth = await api("/api/auth/me");
  currentUser = auth.user;
  csrfToken = auth.csrfToken;
  document.querySelector("#identity").textContent = `${currentUser.displayName || currentUser.username} · ${currentUser.role === "admin" ? "Global access" : "My devices"}`;
  document.querySelector("#users-link").hidden = currentUser.role !== "admin";
  await refresh();
  setInterval(refresh, 5000);
}

initialize().catch((error) => { content.replaceChildren(node("p", { className: "error", textContent: error.message })); });
