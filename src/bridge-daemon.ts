import { createServer, type Socket } from "node:net";
import { chmod, unlink } from "node:fs/promises";
import { BitburnerRemoteApiServer } from "./remote-api-server.ts";
import { defaultControlSocketPath, type ControlRequest, type ControlResponse } from "./bridge-protocol.ts";

const host = process.env.BITBURNER_REMOTE_API_HOST ?? "127.0.0.1";
const port = Number(process.env.BITBURNER_REMOTE_API_PORT ?? 12525);
const socketPath = defaultControlSocketPath(port);
// Pi launches without this flag and retains its original client-owned lifecycle.
const persistent = process.argv.includes("--persistent");
if (process.argv.slice(2).some((arg) => arg !== "--persistent")) throw new Error("Usage: bridge-daemon.ts [--persistent]");
const bridge = new BitburnerRemoteApiServer({ host, port });
const clients = new Set<Socket>();
let hadClient = false;
let stopping = false;
let controlListening = false;
let idleTimer: NodeJS.Timeout | undefined;

function reply(socket: Socket, response: ControlResponse): void {
  socket.write(`${JSON.stringify(response)}\n`);
}

async function dispatch(request: ControlRequest): Promise<unknown> {
  const params = (request.params ?? {}) as Record<string, unknown>;
  switch (request.method) {
    case "status":
      return { listening: bridge.isListening, connected: bridge.isConnected, url: bridge.url };
    case "request":
      return bridge.request(String(params.method), params.params);
    case "agentRequest":
      return bridge.agentRequest(String(params.method), (params.params ?? {}) as Record<string, unknown>, params.timeoutMs as number | undefined);
    case "shutdown":
      return { stopped: true };
    default:
      throw new Error(`Unknown bridge control method: ${request.method}`);
  }
}

async function stop(): Promise<void> {
  if (stopping) return;
  stopping = true;
  clearTimeout(idleTimer);
  for (const client of clients) client.destroy();
  await bridge.stop().catch(() => undefined);
  if (controlListening) {
    await new Promise<void>((resolve) => controlServer.close(() => resolve()));
    await unlink(socketPath).catch(() => undefined);
  }
}

function scheduleIdleStop(): void {
  if (persistent || !hadClient || clients.size !== 0 || stopping) return;
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => void stop().then(() => process.exit(0)), 200);
}

const controlServer = createServer((socket) => {
  hadClient = true;
  clearTimeout(idleTimer);
  clients.add(socket);
  let buffer = "";
  socket.setEncoding("utf8");
  socket.on("data", (chunk) => {
    buffer += chunk;
    while (true) {
      const newline = buffer.indexOf("\n");
      if (newline < 0) break;
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      let request: ControlRequest;
      try {
        request = JSON.parse(line) as ControlRequest;
      } catch (error) {
        reply(socket, { id: -1, error: `Invalid control request: ${String(error)}` });
        continue;
      }
      void dispatch(request).then(
        (result) => {
          socket.write(`${JSON.stringify({ id: request.id, result })}\n`, () => {
            if (request.method === "shutdown") void stop().then(() => process.exit(0));
          });
        },
        (error) => reply(socket, { id: request.id, error: error instanceof Error ? error.message : String(error) }),
      );
    }
  });
  socket.on("error", () => socket.destroy());
  socket.on("close", () => {
    clients.delete(socket);
    scheduleIdleStop();
  });
});

async function main(): Promise<void> {
  // Claim the TCP port first. In a simultaneous startup, only its owner may
  // remove a stale control socket; a losing daemon must not unlink the winner's.
  await bridge.start();
  await unlink(socketPath).catch(() => undefined);
  await new Promise<void>((resolve, reject) => {
    controlServer.once("error", reject);
    controlServer.listen(socketPath, () => {
      controlServer.off("error", reject);
      controlListening = true;
      resolve();
    });
  });
  await chmod(socketPath, 0o600);
  if (persistent) console.error(`Bitburner bridge listening at ${bridge.url}; control socket ${socketPath} (persistent)`);
}

process.on("SIGTERM", () => void stop().then(() => process.exit(0)));
process.on("SIGINT", () => void stop().then(() => process.exit(0)));

main().catch((error) => {
  console.error(error);
  void stop().finally(() => process.exit(1));
});
