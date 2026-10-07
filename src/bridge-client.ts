import { spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { connect, type Socket } from "node:net";
import { fileURLToPath } from "node:url";
import type { BitburnerFile, BitburnerServerInfo } from "./remote-api-server.ts";
import { defaultControlSocketPath, type BridgeStatus, type ControlResponse } from "./bridge-protocol.ts";

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class BitburnerBridgeClient {
  private socket?: Socket;
  private child?: ChildProcess;
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();
  private buffer = "";

  constructor(private readonly port = Number(process.env.BITBURNER_REMOTE_API_PORT ?? 12525)) {}

  get socketPath(): string {
    return defaultControlSocketPath(this.port);
  }

  async start(options: { autoStart?: boolean } = {}): Promise<void> {
    if (this.socket && !this.socket.destroyed) return;
    try {
      await this.open();
      return;
    } catch (error) {
      if (options.autoStart === false) throw new Error(`Cannot connect to bridge at ${this.socketPath}. Start the standalone daemon first. ${String(error)}`);
      // No managed daemon is running yet.
    }

    const daemonPath = fileURLToPath(new URL("./bridge-daemon.ts", import.meta.url));
    // Resolve relative to this extension, not pi's cwd. Pi extensions are often
    // installed in a different project than the caller's working directory.
    const tsxLoaderPath = createRequire(import.meta.url).resolve("tsx");
    this.child = spawn(process.execPath, ["--import", tsxLoaderPath, daemonPath], {
      detached: false,
      env: { ...process.env, BITBURNER_REMOTE_API_PORT: String(this.port) },
      stdio: "ignore",
    });
    this.child.unref();

    let lastError: unknown;
    for (let attempt = 0; attempt < 50; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      try {
        await this.open();
        return;
      } catch (error) {
        lastError = error;
        if (this.child.exitCode !== null) break;
      }
    }
    throw new Error(`Failed to start Bitburner bridge daemon: ${String(lastError)}`);
  }

  async stop(): Promise<void> {
    const socket = this.socket;
    this.socket = undefined;
    if (socket && !socket.destroyed) {
      await new Promise<void>((resolve) => {
        socket.once("close", resolve);
        socket.end();
      });
    }
    this.rejectPending(new Error("Bitburner bridge client stopped"));
  }

  status(): Promise<BridgeStatus> {
    return this.controlRequest("status") as Promise<BridgeStatus>;
  }

  shutdown(): Promise<unknown> { return this.controlRequest("shutdown"); }

  request<TResult = unknown, TParams = unknown>(method: string, params?: TParams): Promise<TResult> {
    return this.controlRequest("request", { method, params }) as Promise<TResult>;
  }

  pushFile(filename: string, content: string, server = "home"): Promise<"OK"> { return this.request("pushFile", { filename, content, server }); }
  getFile(filename: string, server = "home"): Promise<string> { return this.request("getFile", { filename, server }); }
  deleteFile(filename: string, server = "home"): Promise<"OK"> { return this.request("deleteFile", { filename, server }); }
  getFileNames(server = "home"): Promise<string[]> { return this.request("getFileNames", { server }); }
  getAllFiles(server = "home"): Promise<BitburnerFile[]> { return this.request("getAllFiles", { server }); }
  calculateRam(filename: string, server = "home"): Promise<number> { return this.request("calculateRam", { filename, server }); }
  getDefinitionFile(): Promise<string> { return this.request("getDefinitionFile"); }
  getAllServers(): Promise<BitburnerServerInfo[]> { return this.request("getAllServers"); }

  agentRequest<TResult = unknown>(method: string, params: Record<string, unknown> = {}, timeoutMs = 10_000): Promise<TResult> {
    return this.controlRequest("agentRequest", { method, params, timeoutMs }) as Promise<TResult>;
  }

  private open(): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = connect(this.socketPath);
      const fail = (error: Error) => {
        socket.destroy();
        reject(error);
      };
      socket.once("error", fail);
      socket.once("connect", () => {
        socket.off("error", fail);
        this.attach(socket);
        resolve();
      });
    });
  }

  private attach(socket: Socket): void {
    this.socket = socket;
    this.buffer = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => this.handleData(String(chunk)));
    socket.on("error", (error) => this.rejectPending(error));
    socket.on("close", () => {
      if (this.socket === socket) this.socket = undefined;
      this.rejectPending(new Error("Bitburner bridge daemon disconnected"));
    });
  }

  private controlRequest(method: string, params?: unknown): Promise<unknown> {
    if (!this.socket || this.socket.destroyed) return Promise.reject(new Error("Bitburner bridge daemon is not running"));
    const id = this.nextId++;
    const result = new Promise<unknown>((resolve, reject) => {
      const timeoutMs = method === "agentRequest" ? Number((params as { timeoutMs?: number }).timeoutMs ?? 10_000) + 5_000 : 30_000;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Bridge control request timed out: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
    });
    this.socket.write(`${JSON.stringify({ id, method, params })}\n`);
    return result;
  }

  private handleData(chunk: string): void {
    this.buffer += chunk;
    while (true) {
      const newline = this.buffer.indexOf("\n");
      if (newline < 0) return;
      const line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      if (!line) continue;
      const response = JSON.parse(line) as ControlResponse;
      const pending = this.pending.get(response.id);
      if (!pending) continue;
      this.pending.delete(response.id);
      clearTimeout(pending.timer);
      if (response.error !== undefined) pending.reject(new Error(response.error));
      else pending.resolve(response.result);
    }
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}
