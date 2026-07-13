import { tmpdir } from "node:os";
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
  return process.env.BITBURNER_BRIDGE_SOCKET ?? join(tmpdir(), `pi-bitburner-bridge-${process.getuid?.() ?? "user"}-${port}.sock`);
}
