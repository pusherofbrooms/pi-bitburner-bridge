import { Type } from "@mariozechner/pi-ai";
import { defineTool, type ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { BitburnerRemoteApiServer } from "./remote-api-server.ts";

const bridge = new BitburnerRemoteApiServer({
  host: process.env.BITBURNER_REMOTE_API_HOST ?? "127.0.0.1",
  port: Number(process.env.BITBURNER_REMOTE_API_PORT ?? 12525),
});

function text(content: unknown, details: Record<string, unknown> = {}) {
  const body = typeof content === "string" ? content : JSON.stringify(content, null, 2);
  return { content: [{ type: "text" as const, text: body }], details };
}

function fileParams() {
  return Type.Object({
    filename: Type.String({ description: "Bitburner filename, e.g. /scripts/foo.js or foo.js" }),
    server: Type.Optional(Type.String({ description: "Bitburner server hostname. Defaults to home." })),
  });
}

const statusTool = defineTool({
  name: "bb_status",
  label: "Bitburner status",
  description: "Show the Bitburner Remote API bridge status.",
  parameters: Type.Object({}),
  async execute() {
    return text({ listening: bridge.isListening, connected: bridge.isConnected, url: bridge.url });
  },
});

const getFileTool = defineTool({
  name: "bb_get_file",
  label: "Bitburner get file",
  description: "Read a file from Bitburner via Remote API.",
  parameters: fileParams(),
  async execute(_id, params) {
    const server = params.server ?? "home";
    const content = await bridge.getFile(params.filename, server);
    return text(content, { filename: params.filename, server });
  },
});

const pushFileTool = defineTool({
  name: "bb_push_file",
  label: "Bitburner push file",
  description: "Create or update a file in Bitburner via Remote API.",
  parameters: Type.Object({
    filename: Type.String({ description: "Bitburner filename to write." }),
    content: Type.String({ description: "Full file contents." }),
    server: Type.Optional(Type.String({ description: "Bitburner server hostname. Defaults to home." })),
  }),
  async execute(_id, params) {
    const server = params.server ?? "home";
    const result = await bridge.pushFile(params.filename, params.content, server);
    return text(result, { filename: params.filename, server });
  },
});

const deleteFileTool = defineTool({
  name: "bb_delete_file",
  label: "Bitburner delete file",
  description: "Delete a file from Bitburner via Remote API.",
  parameters: fileParams(),
  async execute(_id, params) {
    const server = params.server ?? "home";
    const result = await bridge.deleteFile(params.filename, server);
    return text(result, { filename: params.filename, server });
  },
});

const listFilesTool = defineTool({
  name: "bb_list_files",
  label: "Bitburner list files",
  description: "List files on a Bitburner server via Remote API.",
  parameters: Type.Object({
    server: Type.Optional(Type.String({ description: "Bitburner server hostname. Defaults to home." })),
  }),
  async execute(_id, params) {
    const server = params.server ?? "home";
    return text(await bridge.getFileNames(server), { server });
  },
});

const getAllFilesTool = defineTool({
  name: "bb_get_all_files",
  label: "Bitburner get all files",
  description: "Read every file from a Bitburner server via Remote API.",
  parameters: Type.Object({
    server: Type.Optional(Type.String({ description: "Bitburner server hostname. Defaults to home." })),
  }),
  async execute(_id, params) {
    const server = params.server ?? "home";
    return text(await bridge.getAllFiles(server), { server });
  },
});

const calculateRamTool = defineTool({
  name: "bb_calculate_ram",
  label: "Bitburner calculate RAM",
  description: "Calculate the in-game RAM cost of a Bitburner script.",
  parameters: fileParams(),
  async execute(_id, params) {
    const server = params.server ?? "home";
    const ram = await bridge.calculateRam(params.filename, server);
    return text(`${ram} GB`, { filename: params.filename, server, ram });
  },
});

const getDefinitionFileTool = defineTool({
  name: "bb_get_definition_file",
  label: "Bitburner NS definitions",
  description: "Fetch Bitburner's current Netscript TypeScript definition file.",
  parameters: Type.Object({}),
  async execute() {
    return text(await bridge.getDefinitionFile());
  },
});

const getAllServersTool = defineTool({
  name: "bb_get_all_servers",
  label: "Bitburner get all servers",
  description: "List all Bitburner servers with basic access metadata.",
  parameters: Type.Object({}),
  async execute() {
    return text(await bridge.getAllServers());
  },
});

export default function bitburnerBridgeExtension(pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    await bridge.start();
    ctx.ui.notify(`Bitburner bridge listening at ${bridge.url}. Connect in Bitburner: Options -> Remote API.`, "info");
  });

  pi.on("session_shutdown", async () => {
    await bridge.stop();
  });

  pi.registerCommand("bb-status", {
    description: "Show Bitburner Remote API bridge status",
    handler: async (_args, ctx) => {
      ctx.ui.notify(`Bitburner bridge: ${bridge.isConnected ? "connected" : "waiting"} at ${bridge.url}`, bridge.isConnected ? "success" : "info");
    },
  });

  for (const tool of [
    statusTool,
    getFileTool,
    pushFileTool,
    deleteFileTool,
    listFilesTool,
    getAllFilesTool,
    calculateRamTool,
    getDefinitionFileTool,
    getAllServersTool,
  ]) {
    pi.registerTool(tool);
  }
}
