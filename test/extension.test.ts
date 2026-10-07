import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { ExtensionAPI, ExtensionContext, ExtensionToolContext, ExtensionCommandContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import extension from "../src/index.ts";

test("extension registration, notifications and pushes through the control socket", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-extension-"));
  const previous = process.env.BITBURNER_BRIDGE_SOCKET;
  process.env.BITBURNER_BRIDGE_SOCKET = join(dir, "bridge.sock");
  const sockets = new Set<Socket>();
  const requests: unknown[] = [];
  let connected = false;
  const server = createServer((socket) => {
    sockets.add(socket);
    let buffer = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
      buffer += chunk;
      while (buffer.includes("\n")) {
        const end = buffer.indexOf("\n");
        const request = JSON.parse(buffer.slice(0, end));
        buffer = buffer.slice(end + 1);
        requests.push(request.params);
        socket.write(`${JSON.stringify({ id: request.id, result: request.method === "status" ? { connected, listening: true, url: "ws://localhost:12525" } : "OK" })}\n`);
      }
    });
  });
  const tools = new Map<string, ToolDefinition>();
  const handlers = new Map<string, (event: unknown, ctx: ExtensionContext) => Promise<void>>();
  let command: ((args: string, ctx: ExtensionCommandContext) => Promise<void>) | undefined;
  const notifications: string[] = [];
  const ctx = { cwd: dir, ui: { notify(_message: string, level: string) { notifications.push(level); } } } as unknown as ExtensionToolContext;
  const api = {
    registerTool(tool: ToolDefinition) { tools.set(tool.name, tool); },
    on(name: string, handler: (event: unknown, ctx: ExtensionContext) => Promise<void>) { handlers.set(name, handler); },
    registerCommand(_name: string, definition: { handler: typeof command }) { command = definition.handler; },
  } as unknown as ExtensionAPI;
  try {
    await new Promise<void>((resolve) => server.listen(process.env.BITBURNER_BRIDGE_SOCKET, resolve));
    extension(api);
    assert.equal(tools.size, 18);
    assert.equal(requests.length, 0, "factory must not start resources");
    await handlers.get("session_start")!({}, ctx);
    connected = true;
    await command!("", ctx as unknown as ExtensionCommandContext);
    await handlers.get("session_start")!({}, ctx);
    assert.deepEqual(notifications, ["info", "info", "info"]);
    const push = tools.get("bb_push_file")!;
    const execute = (params: Record<string, unknown>) => push.execute("test", params, undefined, undefined, ctx);
    await writeFile(join(dir, "script.js"), "from context");
    const result = await execute({ localPath: "script.js", content: "ignored" });
    assert.deepEqual(requests.at(-1), { method: "pushFile", params: { filename: "script.js", content: "from context", server: "home" } });
    assert.equal((result.details as Record<string, unknown>).localPath, join(dir, "script.js"));
    await execute({ localPath: join(dir, "script.js"), filename: "other.js", server: "n00dles" });
    await execute({ filename: "empty.js", content: "" });
    assert.deepEqual(requests.at(-1), { method: "pushFile", params: { filename: "empty.js", content: "", server: "home" } });
    await assert.rejects(execute({}), /requires filename/);
    await assert.rejects(execute({ filename: "missing.js" }), /content or localPath/);
    await assert.rejects(execute({ localPath: "missing.js" }), /ENOENT/);
    const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
    assert.deepEqual(manifest.pi.extensions, ["./src/index.ts"]);
  } finally {
    await handlers.get("session_shutdown")?.({}, ctx);
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (previous === undefined) delete process.env.BITBURNER_BRIDGE_SOCKET;
    else process.env.BITBURNER_BRIDGE_SOCKET = previous;
    await rm(dir, { recursive: true, force: true });
  }
});
