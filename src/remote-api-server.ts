import { EventEmitter } from "node:events";
import { WebSocketServer, type WebSocket } from "ws";

export type JsonRpcId = number;

export type ScriptArg = string | number | boolean;

export interface JsonRpcRequest<TParams = unknown> {
  jsonrpc: "2.0";
  id: JsonRpcId;
  method: string;
  params?: TParams;
}

export interface JsonRpcResponse<TResult = unknown> {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result?: TResult;
  error?: unknown;
}

export interface BitburnerFile {
  filename: string;
  content: string;
}

export interface BitburnerFileMetadata {
  filename: string;
  atime: string;
  btime: string;
  mtime: string;
}

export interface BitburnerSaveFile {
  identifier: string;
  binary: boolean;
  save: string;
}

export interface BitburnerServerInfo {
  hostname: string;
  hasAdminRights: boolean;
  purchasedByPlayer: boolean;
}

export interface BitburnerRemoteApiServerOptions {
  host?: string;
  port?: number;
  requestTimeoutMs?: number;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
  timeout: NodeJS.Timeout;
}

export class BitburnerRemoteApiServer extends EventEmitter {
  readonly host: string;
  readonly port: number;
  readonly requestTimeoutMs: number;

  private nextId = 1;
  private nextAgentId = 1;
  private agentQueue: Promise<unknown> = Promise.resolve();
  private wss?: WebSocketServer;
  private client?: WebSocket;
  private pending = new Map<JsonRpcId, PendingRequest>();

  constructor(options: BitburnerRemoteApiServerOptions = {}) {
    super();
    this.host = options.host ?? "127.0.0.1";
    this.port = options.port ?? 12525;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
  }

  get isListening(): boolean {
    return this.wss !== undefined;
  }

  get isConnected(): boolean {
    return this.client !== undefined && this.client.readyState === this.client.OPEN;
  }

  get url(): string {
    return `ws://${this.host}:${this.actualPort}`;
  }

  get actualPort(): number {
    const address = this.wss?.address();
    if (address && typeof address === "object") return address.port;
    return this.port;
  }

  async start(): Promise<void> {
    if (this.wss) return;

    this.wss = new WebSocketServer({ host: this.host, port: this.port });
    this.wss.on("connection", (socket) => this.attachClient(socket));
    this.wss.on("error", (error) => this.emit("error", error));

    await new Promise<void>((resolve) => this.wss?.once("listening", resolve));
    this.emit("listening", this.url);
  }

  async stop(): Promise<void> {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timeout);
      pending.reject(new Error(`Bitburner Remote API request ${id} cancelled: server stopped`));
    }
    this.pending.clear();

    this.client?.close();
    this.client = undefined;

    const server = this.wss;
    this.wss = undefined;
    if (!server) return;

    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    this.emit("stopped");
  }

  async request<TResult = unknown, TParams = unknown>(method: string, params?: TParams): Promise<TResult> {
    if (!this.client || this.client.readyState !== this.client.OPEN) {
      throw new Error(`Bitburner is not connected. In Bitburner, open Options -> Remote API and connect to ${this.url}`);
    }

    const id = this.nextId++;
    const message: JsonRpcRequest<TParams> = { jsonrpc: "2.0", id, method };
    if (params !== undefined) message.params = params;

    const result = new Promise<TResult>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Bitburner Remote API request timed out: ${method}`));
      }, this.requestTimeoutMs);

      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timeout });
    });

    this.client.send(JSON.stringify(message));
    return result;
  }

  pushFile(filename: string, content: string, server = "home"): Promise<"OK"> {
    return this.request("pushFile", { filename, content, server });
  }

  getFile(filename: string, server = "home"): Promise<string> {
    return this.request("getFile", { filename, server });
  }

  getFileMetadata(filename: string, server = "home"): Promise<BitburnerFileMetadata> {
    return this.request("getFileMetadata", { filename, server });
  }

  deleteFile(filename: string, server = "home"): Promise<"OK"> {
    return this.request("deleteFile", { filename, server });
  }

  getFileNames(server = "home"): Promise<string[]> {
    return this.request("getFileNames", { server });
  }

  getAllFiles(server = "home"): Promise<BitburnerFile[]> {
    return this.request("getAllFiles", { server });
  }

  getAllFileMetadata(server = "home"): Promise<BitburnerFileMetadata[]> {
    return this.request("getAllFileMetadata", { server });
  }

  calculateRam(filename: string, server = "home"): Promise<number> {
    return this.request("calculateRam", { filename, server });
  }

  getDefinitionFile(): Promise<string> {
    return this.request("getDefinitionFile");
  }

  getSaveFile(): Promise<BitburnerSaveFile> {
    return this.request("getSaveFile");
  }

  getAllServers(): Promise<BitburnerServerInfo[]> {
    return this.request("getAllServers");
  }

  agentRequest<TResult = unknown>(method: string, params: Record<string, unknown> = {}, timeoutMs = 10_000): Promise<TResult> {
    const run = () => this.executeAgentRequest<TResult>(method, params, timeoutMs);
    const result = this.agentQueue.then(run, run);
    this.agentQueue = result.catch(() => undefined);
    return result;
  }

  private async executeAgentRequest<TResult>(method: string, params: Record<string, unknown>, timeoutMs: number): Promise<TResult> {
    const id = `${Date.now()}-${this.nextAgentId++}`;
    const commandFile = "pi-bridge-command.txt";
    const responseFile = `pi-bridge-response-${id}.txt`;
    await this.deleteFile(responseFile, "home").catch(() => undefined);
    await this.pushFile(commandFile, JSON.stringify({ id, method, params }), "home");

    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const raw = await this.getFile(responseFile, "home");
        const response = JSON.parse(raw) as { id?: string; result?: TResult; error?: string };
        if (response.id !== id) throw new Error(`Bitburner agent returned mismatched response id: ${response.id}`);
        await this.deleteFile(responseFile, "home").catch(() => undefined);
        if (response.error) throw new Error(response.error);
        return response.result as TResult;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!message.includes("File does not exist")) throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error(`Timed out waiting for Bitburner agent response to ${method}. Is pi-agent.js running on home?`);
  }

  private attachClient(socket: WebSocket): void {
    if (this.client && this.client.readyState === this.client.OPEN) {
      this.client.close(1012, "Replaced by a newer Bitburner Remote API connection");
    }

    this.client = socket;
    this.emit("connected");

    socket.on("message", (data) => this.handleMessage(data.toString()));
    socket.on("close", () => {
      if (this.client === socket) this.client = undefined;
      this.emit("disconnected");
    });
    socket.on("error", (error) => this.emit("clientError", error));
  }

  private handleMessage(raw: string): void {
    let response: JsonRpcResponse;
    try {
      response = JSON.parse(raw) as JsonRpcResponse;
    } catch (error) {
      this.emit("protocolError", new Error(`Invalid JSON from Bitburner: ${String(error)}`));
      return;
    }

    const pending = this.pending.get(response.id);
    if (!pending) {
      this.emit("protocolError", new Error(`Unexpected Bitburner response id: ${response.id}`));
      return;
    }

    this.pending.delete(response.id);
    clearTimeout(pending.timeout);

    if (response.error !== undefined && response.error !== null) {
      pending.reject(new Error(formatRemoteError(response.error)));
    } else {
      pending.resolve(response.result);
    }
  }
}

function formatRemoteError(error: unknown): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) return String((error as { message: unknown }).message);
  return JSON.stringify(error);
}
