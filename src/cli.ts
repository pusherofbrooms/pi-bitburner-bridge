import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { BitburnerBridgeClient } from "./bridge-client.ts";

const help = `Bitburner bridge — agent-neutral JSON CLI

Usage: npm run --silent bb -- COMMAND [POSITIONALS] [OPTIONS]
       nix develop --command npm run --silent bb -- COMMAND ...

Lifecycle (no game or in-game agent required):
  daemon                       Run standalone daemon in foreground, persistent.
  status                       Report listening/connected. Does NOT start daemon.
  stop                         Stop shared daemon (disconnects ALL Pi/CLI clients).

Remote API (game must connect; no pi-agent.js / game RAM required):
  files                        List filenames on --server (default home).
  get FILE [--out PATH]         Read in-game file, optionally write it locally.
  push LOCAL [--name FILE]      Push local file; name defaults to its basename.
  delete FILE                  Delete in-game file.
  ram FILE                     Calculate actual in-game script RAM in GB.
  definitions [--out PATH]     Retrieve API TypeScript definitions.
  servers                      Retrieve server metadata (not full player state).
  save --out PATH              Export game save to a local file (backup only).
  install-agent                Push bundled pi-agent.js to home; does NOT run it.

Agent diagnostics (pi-agent.js must be RUNNING on home; costs game RAM):
  agent-status                 Ping the in-game agent.
  ps [--params JSON]           Processes; supports server, filters, summary, paging.
  logs [--params JSON]         Logs; params: fn (filename or PID), host, args.
  running [--params JSON]      Running-script metadata; same params as logs.
  recent                       Recent script metadata.
  server [HOST]                Full server details (default --server).
  run FILE [--threads N] [--args JSON_ARRAY]
                               Start script on --server; PID 0 means no launch.
  kill PID                     Kill the specified process.

Advanced escape hatches (method must exist in current game/agent):
  request METHOD [--params JSON_OBJECT]   Raw Remote API request.
  agent METHOD [--params JSON_OBJECT]     Raw diagnostic-agent request.

Options:
  --server HOST    In-game server (default home).
  --name FILE      In-game destination for push.
  --out PATH       Local output file; parent directory must already exist.
  --params JSON    JSON object for diagnostics / raw requests.
  --args JSON      Script argument array of strings, numbers, booleans.
  --threads N      Positive integer (default 1).
  --timeout N      Agent response timeout in milliseconds (default 10000).
  -h, --help       Show this help without contacting daemon.

Environment (same values for daemon, CLI and Pi):
  BITBURNER_REMOTE_API_HOST   Listening host (default 127.0.0.1).
  BITBURNER_REMOTE_API_PORT   WebSocket port (default 12525).
  BITBURNER_BRIDGE_SOCKET     Local Unix socket override.

Setup: start daemon, then in Bitburner Options -> Remote API connect to
127.0.0.1:12525 with WSS off. CDP/browser control is separate (e.g. port 9223).
CLI calls attach only: they never auto-start or stop the daemon.
Pi can share the persistent daemon; exiting Pi will not stop it in this mode.

Results: one JSON value on stdout; errors are JSON on stderr with exit code 1.
Use --out for raw text / save data without dumping large payloads into context.
Never assume run success from exit code alone: check returned PID and logs.
Fresh BN1.1: use file/RAM tools and UI terminal to run tiny scripts until the
full diagnostic agent fits. install-agent does not make diagnostics available.

Examples:
  npm run --silent bb -- daemon
  npm run --silent bb -- status
  npm run --silent bb -- push ./probe.js
  npm run --silent bb -- ram probe.js
  npm run --silent bb -- get probe-result.txt
  npm run --silent bb -- ps --params '{"server":"home","summary":true}'
  npm run --silent bb -- run worker.js --server n00dles --threads 2 --args '["foodnstuff"]'
  npm run --silent bb -- save --out ./before-reset.json
`;

function object(value: string): Record<string, unknown> {
  const result: unknown = JSON.parse(value);
  if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error("--params must be a JSON object");
  return result as Record<string, unknown>;
}
function positive(value: string, name: string): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1) throw new Error(`${name} must be a positive integer`);
  return n;
}
async function main() {
  const { values, positionals, tokens } = parseArgs({ allowPositionals: true, tokens: true, options: {
    help: { type: "boolean", short: "h" }, server: { type: "string", default: "home" },
    name: { type: "string" }, out: { type: "string" }, params: { type: "string", default: "{}" },
    args: { type: "string", default: "[]" }, threads: { type: "string", default: "1" },
    timeout: { type: "string", default: "10000" },
  } });
  if (values.help || positionals.length === 0) { console.log(help); return; }
  const [command, arg] = positionals;
  const known = ["daemon", "status", "stop", "files", "get", "push", "delete", "ram", "definitions", "servers", "save", "install-agent", "agent-status", "ps", "logs", "running", "recent", "server", "run", "kill", "request", "agent"];
  if (!known.includes(command)) throw new Error(`Unknown command: ${command}. Use --help.`);
  const required = ["get", "push", "delete", "ram", "run", "kill", "request", "agent"].includes(command);
  const allowedArg = required || command === "server";
  if ((required && !arg) || positionals.length > (allowedArg ? 2 : 1)) throw new Error(`Invalid positionals for ${command}. Use --help.`);
  if (command === "save" && !values.out) throw new Error("save requires --out PATH");
  const allowedOptions: Record<string, string[]> = {
    files: ["server"], get: ["server", "out"], push: ["server", "name"], delete: ["server"], ram: ["server"],
    definitions: ["out"], save: ["out"], ps: ["params", "server", "timeout"], logs: ["params", "timeout"],
    running: ["params", "timeout"], recent: ["timeout"], server: ["server", "timeout"],
    run: ["server", "threads", "args", "timeout"], kill: ["timeout"], "agent-status": ["timeout"],
    request: ["params"], agent: ["params", "timeout"],
  };
  // Defaults aren't user-supplied options. Reject unsupported explicit switches
  // before performing mutations (particularly ignored --name / --server).
  for (const token of tokens) {
    if (token.kind === "option") {
      const option = token.name;
      if (!(allowedOptions[command] ?? []).includes(option)) throw new Error(`--${option} is not supported by ${command}`);
    }
  }
  const params = object(values.params!);
  const timeout = positive(values.timeout!, "--timeout");
  const threads = positive(values.threads!, "--threads");
  const args: unknown = JSON.parse(values.args!);
  if (!Array.isArray(args) || args.some((item) => !["string", "number", "boolean"].includes(typeof item))) throw new Error("--args must be an array of strings, numbers or booleans");
  const pid = command === "kill" ? positive(arg!, "PID") : 0;
  const localContent = command === "push" ? await readFile(resolve(arg!), "utf8") : undefined;
  if (command === "daemon") {
    const child = spawn(process.execPath, ["--import", createRequire(import.meta.url).resolve("tsx"), fileURLToPath(new URL("./bridge-daemon.ts", import.meta.url)), "--persistent"], { stdio: "inherit" });
    const forward = (signal: NodeJS.Signals) => child.kill(signal);
    const term = () => forward("SIGTERM"); const interrupt = () => forward("SIGINT");
    process.on("SIGTERM", term); process.on("SIGINT", interrupt);
    try {
      await new Promise<void>((done, reject) => {
        child.once("error", reject);
        child.once("exit", (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); done(); });
      });
    } finally { process.off("SIGTERM", term); process.off("SIGINT", interrupt); }
    return;
  }
  const client = new BitburnerBridgeClient();
  await client.start({ autoStart: false });
  try {
    let result: unknown;
    const server = values.server!;
    const diagnostic = (method: string, p: Record<string, unknown> = params) => client.agentRequest(method, p, timeout);
    switch (command) {
      case "status": result = await client.status(); break;
      case "stop": result = await client.shutdown(); break;
      case "files": result = await client.getFileNames(server); break;
      case "get": result = await client.getFile(arg!, server); break;
      case "push": result = await client.pushFile(values.name ?? basename(arg!), localContent!, server); break;
      case "delete": result = await client.deleteFile(arg!, server); break;
      case "ram": result = await client.calculateRam(arg!, server); break;
      case "definitions": result = await client.getDefinitionFile(); break;
      case "servers": result = await client.getAllServers(); break;
      case "save": result = await client.request("getSaveFile"); break;
      case "install-agent": result = await client.pushFile("pi-agent.js", await readFile(new URL("./pi-agent.js", import.meta.url), "utf8")); break;
      case "agent-status": result = await diagnostic("ping", {}); break;
      case "ps": result = await diagnostic("ps", { server, ...params }); break;
      case "logs": result = await diagnostic("getScriptLogs"); break;
      case "running": result = await diagnostic("getRunningScript"); break;
      case "recent": result = await diagnostic("getRecentScripts", {}); break;
      case "server": result = await diagnostic("getServer", { server: arg ?? server }); break;
      case "run": result = await diagnostic("runScript", { filename: arg, server, threads, args }); break;
      case "kill": result = await diagnostic("killScript", { pid }); break;
      case "request": result = await client.request(arg!, params); break;
      case "agent": result = await diagnostic(arg!); break;
    }
    if (values.out) {
      const path = resolve(values.out);
      await writeFile(path, typeof result === "string" ? result : JSON.stringify(result, null, 2), { mode: 0o600 });
      console.log(JSON.stringify({ written: path }));
    } else console.log(JSON.stringify(result));
  } finally { await client.stop(); }
}
main().catch((error) => { console.error(JSON.stringify({ error: String(error instanceof Error ? error.message : error) })); process.exitCode = 1; });
