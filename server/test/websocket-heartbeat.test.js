import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import { test } from "node:test";

import { attachWebSocketHeartbeat } from "../src/authenticated-tunnel.js";

class FakeSocket extends EventEmitter {
  constructor() {
    super();
    this.OPEN = 1;
    this.readyState = this.OPEN;
    this.pingCount = 0;
    this.terminateCount = 0;
  }

  ping() {
    this.pingCount += 1;
  }

  terminate() {
    this.terminateCount += 1;
    this.readyState = 3;
    this.emit("close", 1006, Buffer.alloc(0));
  }
}

test("heartbeat keeps pong-responsive sockets online", async () => {
  const wss = new EventEmitter();
  const socket = new FakeSocket();
  wss.clients = new Set([socket]);
  socket.ping = function ping() {
    this.pingCount += 1;
    this.emit("pong");
  };
  attachWebSocketHeartbeat(wss, { intervalMs: 10, timeoutMs: 35 });
  wss.emit("connection", socket);
  await new Promise((resolve) => setTimeout(resolve, 65));
  wss.emit("close");
  assert.ok(socket.pingCount >= 2);
  assert.equal(socket.terminateCount, 0);
});

test("heartbeat terminates a stale socket", async () => {
  const wss = new EventEmitter();
  const socket = new FakeSocket();
  wss.clients = new Set([socket]);
  attachWebSocketHeartbeat(wss, { intervalMs: 10, timeoutMs: 25 });
  wss.emit("connection", socket);
  let timeout;
  try {
    await Promise.race([
      once(socket, "close"),
      new Promise((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("stale socket was not terminated")),
          250,
        );
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
  wss.emit("close");
  assert.equal(socket.terminateCount, 1);
});
