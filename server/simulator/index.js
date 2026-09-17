import crypto from "node:crypto";
import { WebSocket } from "ws";
import {
  AUTH_PROTOCOL,
  computeAuthMac,
  deriveSessionKeys,
  signFrame,
  verifyFrame,
} from "../src/protocol.js";
import { TUNNEL_PROTOCOL_V2 } from "../src/tunnel-metadata.js";

const url = process.env.ESPWAY_TUNNEL_URL || "ws://127.0.0.1:3000/tunnel";
const identity = {
  deviceId: process.env.ESPWAY_DEVICE_ID || "esp-a4f912",
  deviceName: "ESPway Simulator",
  hardware: "simulator",
  application: "led-demo",
  applicationVersion: "0.2.0",
  frameworkVersion: "0.2.0",
};
const token = process.env.ESPWAY_DEVICE_TOKEN || "change-this-demo-token";
const baseDomain = process.env.ESPWAY_DOMAIN || "link.proghard.com";
const tunnelHost =
  process.env.ESPWAY_TUNNEL_HOST ||
  `tunnel.${baseDomain}`;
let led = false;
let delay = 1000;

function connect() {
  const ws = new WebSocket(url, { headers: { Host: tunnelHost } });
  const streams = new Map();
  ws.on("open", () => {
    delay = 1000;
    console.log(`${identity.deviceId} connected to ${url}`);
  });
  ws.on("message", (raw) => {
    let m = JSON.parse(raw.toString());
    if (m.type === "challenge") {
      const deviceNonce = crypto.randomBytes(32).toString("hex");
      ws.espwaySession = {
        ...deriveSessionKeys(token, identity.deviceId, m.serverNonce, deviceNonce),
        sendSequence: 1n,
        expectedReceiveSequence: 1n,
      };
      ws.send(JSON.stringify({
        type: "auth",
        authProtocol: AUTH_PROTOCOL,
        deviceId: identity.deviceId,
        deviceNonce,
        authMac: computeAuthMac(token, identity.deviceId, m.serverNonce, deviceNonce),
      }));
      return;
    }
    m = verifyFrame(ws.espwaySession, "S2C", raw, 8192);
    if (!m) return ws.close();
    if (m.type === "hello-ack") {
      send(ws, {
        type: "hello",
        tunnelProtocol: TUNNEL_PROTOCOL_V2,
        ...identity,
        capabilities: ["aead-selective", "http-ota", "mqtt"],
      });
      return;
    }
    if (m.type === "hello-verified" || m.type === "error") return;
    if (m.type === "open") streams.set(m.streamId, { ...m, chunks: [] });
    else if (m.type === "data" && streams.has(m.streamId))
      streams.get(m.streamId).chunks.push(Buffer.from(m.data, "base64"));
    else if (m.type === "close" && streams.has(m.streamId)) {
      const req = streams.get(m.streamId);
      streams.delete(m.streamId);
      respond(ws, m.streamId, req, Buffer.concat(req.chunks));
    }
  });
  ws.on("close", () => {
    console.log(`disconnected; retry in ${delay}ms`);
    setTimeout(connect, delay);
    delay = Math.min(delay * 2, 30000);
  });
  ws.on("error", (error) => console.error(error.message));
}

function respond(ws, streamId, req, body) {
  let status = 200,
    type = "application/json",
    output;
  if (req.method === "GET" && req.path === "/api/status")
    output = JSON.stringify({
      deviceName: identity.deviceName,
      deviceId: identity.deviceId,
      wifi: { connected: true, ip: "127.0.0.1" },
      remote: { connected: true },
      led: { on: led },
      firmwareVersion: identity.applicationVersion,
    });
  else if (req.method === "POST" && req.path === "/api/led") {
    try {
      led = Boolean(JSON.parse(body).on);
      output = JSON.stringify({ on: led });
    } catch {
      status = 400;
      output = '{"error":"invalid json"}';
    }
  } else if (req.method === "GET" && req.path === "/") {
    type = "text/html; charset=utf-8";
    output = page();
  } else if (req.method === "GET" && req.path === "/style.css") {
    type = "text/css";
    output =
      "body{font:16px system-ui;background:#f4f7fb;color:#17202a;margin:0}.card{max-width:620px;margin:40px auto;background:white;padding:28px;border-radius:16px;box-shadow:0 8px 30px #1232}button{padding:10px 24px;margin-right:8px}.ok{color:#087830}";
  } else if (req.method === "GET" && req.path === "/app.js") {
    type = "text/javascript";
    output =
      "async function load(){const s=await fetch('/api/status').then(r=>r.json());status.textContent=JSON.stringify(s,null,2)}async function setLed(on){await fetch('/api/led',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({on})});load()}load()";
  } else {
    status = 404;
    type = "text/plain";
    output = "not found";
  }
  send(ws, {
    type: "open",
    streamId,
    status,
    headers: { "content-type": type },
  });
  for (let offset = 0; offset < Buffer.byteLength(output); offset += 1024)
    send(ws, {
      type: "data",
      streamId,
      data: Buffer.from(output)
        .subarray(offset, offset + 1024)
        .toString("base64"),
    });
  send(ws, { type: "close", streamId });
}
function send(ws, message) {
  ws.send(signFrame(ws.espwaySession, "C2S", message));
}
function page() {
  return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>ESPway</title><link rel="stylesheet" href="/style.css"></head><body><main class="card"><h1>ESPway</h1><p>Virtual LED demo</p><button onclick="setLed(true)">ON</button><button onclick="setLed(false)">OFF</button><pre id="status">Loading...</pre></main><script src="/app.js"></script></body></html>';
}
connect();
