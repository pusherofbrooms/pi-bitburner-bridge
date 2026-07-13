import assert from "node:assert/strict";
import { createServer, type Socket } from "node:net";
import { unlink } from "node:fs/promises";
import { afterEach, describe, it } from "node:test";
import { BitburnerBridgeClient } from "../src/bridge-client.ts";

const port = 29000 + Math.floor(Math.random() * 1000);
const socketPath = `/tmp/pi-bitburner-bridge-test-${process.pid}.sock`;
const oldSocketPath = process.env.BITBURNER_BRIDGE_SOCKET;
const sockets = new Set<Socket>();

process.env.BITBURNER_BRIDGE_SOCKET = socketPath;

afterEach(async () => {
  if (oldSocketPath === undefined) delete process.env.BITBURNER_BRIDGE_SOCKET;
  else process.env.BITBURNER_BRIDGE_SOCKET = oldSocketPath;
  for (const socket of sockets) socket.destroy();
  sockets.clear();
  await unlink(socketPath).catch(() => undefined);
});

describe("BitburnerBridgeClient", () => {
  it("uses a persistent Unix-socket control connection", async () => {
    await unlink(socketPath).catch(() => undefined);
    let connections = 0;
    const server = createServer((socket) => {
      connections++;
      sockets.add(socket);
      let buffer = "";
      socket.setEncoding("utf8");
      socket.on("data", (chunk) => {
        buffer += chunk;
        const newline = buffer.indexOf("\n");
        if (newline < 0) return;
        const request = JSON.parse(buffer.slice(0, newline)) as { id: number; method: string };
        socket.write(`${JSON.stringify({ id: request.id, result: { listening: true, connected: false, url: `ws://127.0.0.1:${port}` } })}\n`);
        buffer = buffer.slice(newline + 1);
      });
    });
    await new Promise<void>((resolve) => server.listen(socketPath, resolve));

    const client = new BitburnerBridgeClient(port);
    await client.start();
    assert.deepEqual(await client.status(), { listening: true, connected: false, url: `ws://127.0.0.1:${port}` });
    assert.equal(connections, 1);
    await client.stop();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
});
