import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { mkdtemp, readFile, writeFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { test } from "node:test";
import WebSocket from "ws";
import { BitburnerBridgeClient } from "../src/bridge-client.ts";

const exec = promisify(execFile);
const loader = createRequire(import.meta.url).resolve("tsx");
const cli = new URL("../src/cli.ts", import.meta.url).pathname;
const daemon = new URL("../src/bridge-daemon.ts", import.meta.url).pathname;

test("CLI help/validation are offline and never start a daemon", async () => {
  const env = { ...process.env, BITBURNER_BRIDGE_SOCKET: `/tmp/nonexistent-bb-${process.pid}.sock` };
  const result = await exec(process.execPath, ["--import", loader, cli, "--help"], { env });
  assert.match(result.stdout, /Fresh BN1.1/);
  assert.match(result.stdout, /ALL Pi\/CLI clients/);
  for (const args of [["run", "x.js", "--threads", "0"], ["save"], ["push", "x.js", "--out", "x"], ["unknown"], ["agent", "ping", "--params", "[]"]]) {
    await assert.rejects(exec(process.execPath, ["--import", loader, cli, ...args], { env }), (error: unknown) => {
      assert.doesNotMatch((error as { stderr: string }).stderr, /Cannot connect/);
      return true;
    });
  }
  await assert.rejects(exec(process.execPath, ["--import", loader, cli, "status"], { env }), /Start the standalone daemon first/);
});

test("persistent daemon shares Pi-style client and CLI; files, diagnostics, shutdown", { timeout: 45_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "bb-cli-"));
  const socketPath = join(directory, "control.sock");
  const reservation = createServer();
  await new Promise<void>((resolve) => reservation.listen(0, "127.0.0.1", resolve));
  const port = (reservation.address() as { port: number }).port;
  await new Promise<void>((resolve) => reservation.close(() => resolve()));
  const env = { ...process.env, BITBURNER_REMOTE_API_HOST: "127.0.0.1", BITBURNER_REMOTE_API_PORT: String(port), BITBURNER_BRIDGE_SOCKET: socketPath };
  const child = spawn(process.execPath, ["--import", loader, daemon, "--persistent"], { env, stdio: ["ignore", "ignore", "pipe"] });
  const exited = once(child, "exit");
  let game: WebSocket | undefined;
  let pi: BitburnerBridgeClient | undefined;
  const oldSocket = process.env.BITBURNER_BRIDGE_SOCKET;
  const call = async (...args: string[]) => JSON.parse((await exec(process.execPath, ["--import", loader, cli, ...args], { env })).stdout);
  try {
    await new Promise<void>((resolve, reject) => {
      child.stderr!.on("data", (data) => { if (String(data).includes("(persistent)")) resolve(); });
      child.once("exit", () => reject(new Error("daemon exited before ready")));
    });
    assert.equal((await stat(socketPath)).mode & 0o777, 0o600);
    assert.equal((await call("status")).connected, false);
    await new Promise((resolve) => setTimeout(resolve, 350));
    assert.equal((await call("status")).listening, true, "survives CLI disconnect");
    game = new WebSocket(`ws://127.0.0.1:${port}`);
    const files = new Map<string, string>();
    game.on("message", (raw) => {
      const req = JSON.parse(String(raw));
      let result: unknown = "OK";
      let error: unknown;
      const p = req.params ?? {};
      switch (req.method) {
        case "pushFile":
          files.set(p.filename, p.content);
          if (p.filename === "pi-bridge-command.txt") {
            const command = JSON.parse(p.content);
            const agentResult = command.method === "runScript" ? 42 : { ok: true, method: command.method, params: command.params };
            files.set(`pi-bridge-response-${command.id}.txt`, JSON.stringify({ id: command.id, result: agentResult }));
          }
          break;
        case "getFile": result = files.get(p.filename); if (result === undefined) error = { code: -1, message: "File does not exist" }; break;
        case "deleteFile": files.delete(p.filename); break;
        case "getFileNames": result = [...files.keys()]; break;
        case "calculateRam": result = 1.6; break;
        case "getSaveFile": result = { save: "fixture", version: "test" }; break;
        default: error = { code: -1, message: "Unsupported fixture method" };
      }
      game!.send(JSON.stringify({ jsonrpc: "2.0", id: req.id, ...(error ? { error } : { result }) }));
    });
    await once(game, "open");
    assert.equal((await call("status")).connected, true);
    process.env.BITBURNER_BRIDGE_SOCKET = socketPath;
    pi = new BitburnerBridgeClient(port);
    await pi.start();
    const local = join(directory, "probe.js");
    await writeFile(local, "export async function main(ns) { ns.tprint('probe'); }");
    assert.equal(await call("push", local), "OK");
    assert.match(await pi.getFile("probe.js"), /probe/);
    assert.equal(await call("ram", "probe.js"), 1.6);
    await call("get", "probe.js", "--out", join(directory, "copy.js"));
    assert.equal(await readFile(join(directory, "copy.js"), "utf8"), files.get("probe.js"));
    await call("save", "--out", join(directory, "save.json"));
    assert.equal(JSON.parse(await readFile(join(directory, "save.json"), "utf8")).save, "fixture");
    assert.equal(await call("run", "probe.js", "--args", '["--literal",true,3]'), 42);
    assert.equal((await call("agent-status")).ok, true);
    // Both clients use the daemon's single serialized agent command channel.
    const [ping, processes] = await Promise.all([pi.agentRequest<{ ok: boolean }>("ping"), call("ps", "--params", '{"summary":true}')]);
    assert.equal(ping.ok, true); assert.equal(processes.params.summary, true);
    await pi.stop(); pi = undefined;
    assert.equal((await call("status")).connected, true, "Pi shutdown leaves persistent game connection alive");
    await call("delete", "probe.js");
    assert.equal(files.has("probe.js"), false);
    assert.deepEqual(await call("stop"), { stopped: true });
    assert.equal((await exited)[0], 0);
    await assert.rejects(stat(socketPath), /ENOENT/);
  } finally {
    await pi?.stop(); game?.terminate();
    if (child.exitCode === null && child.signalCode === null) { child.kill("SIGTERM"); await exited; }
    if (oldSocket === undefined) delete process.env.BITBURNER_BRIDGE_SOCKET;
    else process.env.BITBURNER_BRIDGE_SOCKET = oldSocket;
    await rm(directory, { recursive: true, force: true });
  }
});
