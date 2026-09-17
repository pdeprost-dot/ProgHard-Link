import { DEVICE_ID_RE } from "./config.js";
import {
  AUTH_PROTOCOL,
  clearSession,
  deriveSessionKeys,
  generateChallenge,
  signFrame,
  verifyDeviceAuth,
  verifyFrame,
} from "./protocol.js";
import {
  TUNNEL_PROTOCOL_V2,
  parseSignedHello,
} from "./tunnel-metadata.js";

function emptySession() {
  return {
    c2sKey: null,
    s2cKey: null,
    c2sEncryptionKey: null,
    s2cEncryptionKey: null,
    c2sAesEncryptionKey: null,
    s2cAesEncryptionKey: null,
    c2sNoncePrefix: null,
    s2cNoncePrefix: null,
    sendSequence: 1n,
    expectedReceiveSequence: 1n,
  };
}

export function attachAuthenticatedTunnel(wss, context) {
  const { registry, authorizedDevices, broker, config } = context;

  wss.on("connection", (ws) => {
    let deviceId = null;
    let authenticated = false;
    let metadataVerified = false;
    const challenge = generateChallenge();
    const session = emptySession();
    const helloTimer = setTimeout(
      () => ws.close(4000, "hello timeout"),
      5000,
    );

    ws.send(JSON.stringify({ type: "challenge", ...challenge }));
    ws.on("message", (raw) => {
      let message;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        return ws.close(4002, "invalid json");
      }

      if (!authenticated) {
        if (!DEVICE_ID_RE.test(message.deviceId || "")) {
          return ws.close(4003, "invalid identity");
        }
        const expectedToken = authorizedDevices.getToken(
          message.deviceId,
          config.tokens ?? new Map(),
        );
        if (
          !authorizedDevices.isEnabled(message.deviceId) ||
          !verifyDeviceAuth(expectedToken, message, challenge.serverNonce)
        ) {
          return ws.close(4003, "unauthorized");
        }

        deviceId = message.deviceId;
        authenticated = true;
        Object.assign(
          session,
          deriveSessionKeys(
            expectedToken,
            deviceId,
            challenge.serverNonce,
            message.deviceNonce,
          ),
        );
        ws.espwaySend = (frame) =>
          ws.send(signFrame(session, "S2C", frame), { binary: false });
        ws.espwaySession = session;

        ws.espwaySend({
          type: "hello-ack",
          authProtocol: AUTH_PROTOCOL,
          tunnelProtocol: TUNNEL_PROTOCOL_V2,
        });
        return;
      }

      message = verifyFrame(
        session,
        "C2S",
        raw,
        config.maxBodyBytes + 4096,
      );
      if (!message) return ws.close(4004, "invalid signed frame");
      if (message.type === "hello") {
        if (metadataVerified) return ws.close(4006, "duplicate hello");
        const metadata = parseSignedHello(message, deviceId);
        if (!metadata) return ws.close(4006, "invalid signed hello");
        clearTimeout(helloTimer);
        metadataVerified = true;
        const connectedDevice = registry.connect(
          {
            deviceId,
            ...metadata,
            transport: "ws-hmac",
            tunnelProtocol: TUNNEL_PROTOCOL_V2,
          },
          ws,
        );
        void authorizedDevices.recordObservation(deviceId, connectedDevice);
        ws.espwaySend({
          type: "hello-verified",
          tunnelProtocol: TUNNEL_PROTOCOL_V2,
        });
        return;
      }

      if (!metadataVerified) return ws.close(4006, "signed hello required");
      registry.seen(deviceId);

      if (
        !["open", "data", "close", "ack"].includes(message.type) ||
        !broker.receive(deviceId, message)
      ) {
        ws.espwaySend({
          type: "error",
          streamId: message.streamId,
          code: "unknown_stream",
        });
      }
    });

    ws.on("close", (code, reason) => {
      clearTimeout(helloTimer);
      clearSession(session);
      if (
        deviceId &&
        registry.disconnect(deviceId, ws, code, reason.toString())
      ) {
        broker.disconnect(deviceId);
        void authorizedDevices.recordObservation(
          deviceId,
          registry.get(deviceId),
        );
      }
    });
  });
}

export function attachWebSocketHeartbeat(wss, {
  intervalMs = 30000,
  timeoutMs = 60000,
} = {}) {
  wss.on("connection", (ws) => {
    ws.espwayAwaitingPong = false;
    ws.espwayPingSentAt = 0;
    ws.on("pong", () => {
      ws.espwayAwaitingPong = false;
    });
  });

  const timer = setInterval(() => {
    const now = Date.now();
    for (const ws of wss.clients) {
      if (
        ws.espwayAwaitingPong &&
        now - ws.espwayPingSentAt >= timeoutMs
      ) {
        ws.terminate();
        continue;
      }
      if (!ws.espwayAwaitingPong && ws.readyState === 1) {
        ws.espwayAwaitingPong = true;
        ws.espwayPingSentAt = now;
        ws.ping();
      }
    }
  }, intervalMs);
  timer.unref?.();
  wss.on("close", () => clearInterval(timer));
  return timer;
}
