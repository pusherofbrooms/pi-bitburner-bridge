// Run inside the ~/ai/.envrc dev environment. No model calls or game required.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { createRequire } from "node:module";
import { BitburnerBridgeClient } from "../src/bridge-client.ts";

const loader = createRequire(import.meta.url).resolve("tsx");
const extension = new URL("../src/index.ts", import.meta.url).pathname;
const daemonPath = new URL("../src/bridge-daemon.ts", import.meta.url).pathname;
const directory = await mkdtemp(join(tmpdir(), "bb-real-pi-"));
const observer = join(directory, "observer.mjs");
const evidence = join(directory, "evidence.json");
await writeFile(observer, `import { writeFileSync } from "node:fs";
export default function (pi) {
  pi.on("session_start", () => writeFileSync(${JSON.stringify(evidence)}, JSON.stringify({ tools: pi.getAllTools().map(t => t.name) })));
  pi.on("session_shutdown", () => writeFileSync(${JSON.stringify(join(directory, "shutdown.txt"))}, "shutdown"));
}`);
try {
  for (const persistent of [false, true]) {
    await rm(evidence, { force: true });
    await rm(join(directory, "shutdown.txt"), { force: true });
    const reservation = createServer();
    await new Promise(resolve => reservation.listen(0, "127.0.0.1", resolve));
    const port = reservation.address().port;
    await new Promise(resolve => reservation.close(resolve));
    const socket = join(directory, persistent ? "persistent.sock" : "automatic.sock");
    const env = { ...process.env, BITBURNER_REMOTE_API_PORT: String(port), BITBURNER_REMOTE_API_HOST: "127.0.0.1", BITBURNER_BRIDGE_SOCKET: socket };
    let daemon, pi;
    let daemonExit, piExit;
    const previous = process.env.BITBURNER_BRIDGE_SOCKET;
    process.env.BITBURNER_BRIDGE_SOCKET = socket;
    const client = new BitburnerBridgeClient(port);
    try {
      if (persistent) {
        daemon = spawn(process.execPath, ["--import", loader, daemonPath, "--persistent"], { env, stdio: ["ignore", "ignore", "pipe"] });
        daemonExit = once(daemon, "exit");
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("daemon startup timeout")), 30_000);
          daemon.stderr.on("data", chunk => { if (String(chunk).includes("(persistent)")) { clearTimeout(timer); resolve(); } });
          daemon.once("exit", () => { clearTimeout(timer); reject(new Error("daemon startup failed")); });
        });
      }
      pi = spawn("pi", ["--mode", "rpc", "--offline", "--no-session", "--no-extensions", "--no-mcp", "--no-skills", "--no-prompt-templates", "--no-context-files", "-e", extension, "-e", observer], { env, cwd: directory, stdio: ["pipe", "pipe", "pipe"] });
      piExit = once(pi, "exit");
      const commands = await new Promise((resolve, reject) => {
        let buffer = "";
        const timer = setTimeout(() => reject(new Error("Pi RPC startup timeout")), 60_000);
        pi.stdout.on("data", chunk => {
          buffer += String(chunk);
          while (buffer.includes("\n")) {
            const end = buffer.indexOf("\n"); const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
            try { const response = JSON.parse(line); if (response.id === "commands") { clearTimeout(timer); resolve(response); } } catch {}
          }
        });
        pi.once("error", error => { clearTimeout(timer); reject(error); });
        pi.once("exit", () => { clearTimeout(timer); reject(new Error("Pi exited before RPC response")); });
        pi.stdin.write(JSON.stringify({ id: "commands", type: "get_commands" }) + "\n");
      });
      assert.equal(commands.success, true);
      assert.ok(commands.data.commands.some(c => c.name === "bb-status"));
      const recorded = JSON.parse(await readFile(evidence, "utf8"));
      const tools = recorded.tools.filter(name => name.startsWith("bb_"));
      assert.equal(tools.length, 18);
      assert.ok(tools.includes("bb_push_file")); assert.ok(tools.includes("bb_run_script"));
      await client.start({ autoStart: false });
      assert.equal((await client.status()).listening, true);
      await client.stop();
      pi.kill("SIGTERM"); await piExit;
      assert.equal(await readFile(join(directory, "shutdown.txt"), "utf8"), "shutdown");
      await new Promise(resolve => setTimeout(resolve, 500));
      if (persistent) {
        await client.start({ autoStart: false });
        assert.equal((await client.status()).listening, true);
        await client.shutdown(); await client.stop(); await daemonExit;
      } else await assert.rejects(client.start({ autoStart: false }), /Start the standalone daemon/);
      console.log(JSON.stringify({ mode: persistent ? "persistent" : "Pi-owned", registeredTools: tools.length, command: "bb-status", shutdownVerified: true }));
    } finally {
      await client.stop();
      if (pi && pi.exitCode === null && pi.signalCode === null) { pi.kill("SIGTERM"); await piExit; }
      if (daemon && daemon.exitCode === null && daemon.signalCode === null) { daemon.kill("SIGTERM"); await daemonExit; }
      if (previous === undefined) delete process.env.BITBURNER_BRIDGE_SOCKET; else process.env.BITBURNER_BRIDGE_SOCKET = previous;
    }
  }
} finally { await rm(directory, { recursive: true, force: true }); }
