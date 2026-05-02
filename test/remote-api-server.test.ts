import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { WebSocket } from "ws";
import { BitburnerRemoteApiServer, type JsonRpcRequest } from "../src/remote-api-server.ts";

const servers: BitburnerRemoteApiServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.stop()));
});

async function startServer(): Promise<BitburnerRemoteApiServer> {
  const server = new BitburnerRemoteApiServer({ port: 0, requestTimeoutMs: 250 });
  servers.push(server);
  await server.start();
  return server;
}

async function connectClient(server: BitburnerRemoteApiServer, handler: (request: JsonRpcRequest, socket: WebSocket) => void): Promise<WebSocket> {
  const connected = new Promise<void>((resolve) => server.once("connected", resolve));
  const socket = new WebSocket(server.url);
  socket.on("message", (data) => handler(JSON.parse(data.toString()) as JsonRpcRequest, socket));
  await Promise.all([new Promise<void>((resolve) => socket.once("open", resolve)), connected]);
  return socket;
}

describe("BitburnerRemoteApiServer", () => {
  it("sends JSON-RPC requests and resolves results", async () => {
    const server = await startServer();
    const client = await connectClient(server, (request, socket) => {
      assert.equal(request.jsonrpc, "2.0");
      assert.equal(request.method, "getFile");
      assert.deepEqual(request.params, { filename: "foo.js", server: "home" });
      socket.send(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: "export async function main(ns) {}" }));
    });

    assert.equal(await server.getFile("foo.js"), "export async function main(ns) {}");
    client.close();
  });

  it("wraps Remote API helper methods with Bitburner 3.0 method names", async () => {
    const server = await startServer();
    const seen: Array<{ method: string; params?: unknown }> = [];
    const client = await connectClient(server, (request, socket) => {
      seen.push({ method: request.method, params: request.params });
      socket.send(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: request.method === "calculateRam" ? 1.7 : "OK" }));
    });

    await server.pushFile("x.js", "content", "n00dles");
    await server.deleteFile("x.js", "n00dles");
    assert.equal(await server.calculateRam("x.js", "n00dles"), 1.7);

    assert.deepEqual(seen, [
      { method: "pushFile", params: { filename: "x.js", content: "content", server: "n00dles" } },
      { method: "deleteFile", params: { filename: "x.js", server: "n00dles" } },
      { method: "calculateRam", params: { filename: "x.js", server: "n00dles" } },
    ]);
    client.close();
  });

  it("rejects Remote API errors", async () => {
    const server = await startServer();
    const client = await connectClient(server, (request, socket) => {
      socket.send(JSON.stringify({ jsonrpc: "2.0", id: request.id, error: { message: "not found" } }));
    });

    await assert.rejects(server.getFile("missing.js"), /not found/);
    client.close();
  });

  it("fails fast when Bitburner is not connected", async () => {
    const server = await startServer();
    await assert.rejects(server.getFile("foo.js"), /Bitburner is not connected/);
  });
});
