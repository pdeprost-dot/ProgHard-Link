export class DeviceRegistry {
  constructor() {
    this.devices = new Map();
  }

  connect(info, socket) {
    const now = new Date().toISOString();
    const previous = this.devices.get(info.deviceId);
    const replaced = previous?.socket && previous.socket !== socket;
    if (replaced)
      previous.socket.close(4001, "replaced");
    const device = {
      ...previous,
      ...info,
      connected: true,
      online: true,
      connectedSince: now,
      lastSeen: now,
      ...(replaced
        ? {
            lastDisconnectAt: now,
            lastDisconnectCode: 4001,
            lastDisconnectReason: "replaced",
          }
        : {}),
      socket,
    };
    this.devices.set(info.deviceId, device);
    return device;
  }

  seen(deviceId) {
    const device = this.devices.get(deviceId);
    if (device) device.lastSeen = new Date().toISOString();
  }

  updateMetadata(deviceId, socket, metadata) {
    const device = this.devices.get(deviceId);
    if (!device || device.socket !== socket) return false;
    Object.assign(device, metadata);
    device.lastSeen = new Date().toISOString();
    return true;
  }

  disconnect(deviceId, socket, code, reason) {
    const device = this.devices.get(deviceId);
    if (device?.socket === socket) {
      device.connected = false;
      device.online = false;
      device.lastSeen = new Date().toISOString();
      device.lastDisconnectAt = device.lastSeen;
      device.lastDisconnectCode = Number(code || 0);
      device.lastDisconnectReason = String(reason || "");
      delete device.socket;
      return true;
    }
    return false;
  }

  updateManagementMetadata(deviceId, metadata) {
    const device = this.devices.get(deviceId);
    if (!device) return false;
    Object.assign(device, metadata);
    return true;
  }

  remove(deviceId) {
    const device = this.devices.get(deviceId);
    if (!device) return null;
    this.devices.delete(deviceId);
    return device;
  }

  get(deviceId) {
    return this.devices.get(deviceId);
  }
  list() {
    return [...this.devices.values()].map(({ socket, ...device }) => device);
  }
}
