import { join } from "node:path";

export interface ControlRequest {
  id: number;
  method: string;
  params?: unknown;
}

export interface ControlResponse {
  id: number;
  result?: unknown;
  error?: string;
}

export interface BridgeStatus {
  listening: boolean;
  connected: boolean;
  url: string;
}

export function defaultControlSocketPath(port: number): string {
  // Nix gives each develop invocation its own TMPDIR. A shared daemon needs
  // a stable rendezvous path across independently launched Pi/CLI clients.
  return process.env.BITBURNER_BRIDGE_SOCKET ?? join("/tmp", `pi-bitburner-bridge-${process.getuid?.() ?? "user"}-${port}.sock`);
}
