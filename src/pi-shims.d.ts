declare module "@mariozechner/pi-ai" {
  export const Type: {
    Object: (properties: Record<string, unknown>) => unknown;
    String: (options?: Record<string, unknown>) => unknown;
    Optional: (schema: unknown) => unknown;
  };
}

declare module "@mariozechner/pi-coding-agent" {
  export interface ExtensionAPI {
    on: (event: "session_start" | "session_shutdown", handler: (event: unknown, ctx: ExtensionContext) => Promise<void> | void) => void;
    registerCommand: (name: string, command: { description?: string; handler: (args: string, ctx: ExtensionContext) => Promise<void> | void }) => void;
    registerTool: (tool: unknown) => void;
  }

  export interface ExtensionContext {
    ui: {
      notify: (message: string, level?: "info" | "success" | "warning" | "error") => void;
    };
  }

  export function defineTool<TParams = any>(tool: {
    name: string;
    label?: string;
    description: string;
    promptSnippet?: string;
    promptGuidelines?: string[];
    parameters: unknown;
    execute: (toolCallId: string, params: TParams, signal: AbortSignal, onUpdate: unknown, ctx: ExtensionContext) => Promise<unknown> | unknown;
  }): unknown;
}
