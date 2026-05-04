import { readFile } from "node:fs/promises";
import { basename, isAbsolute, resolve } from "node:path";
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

const numberParam = (description: string) => ({ type: "number", description });
const filenameOrPidParam = (description: string) => ({
  anyOf: [Type.String({ description: "Script filename." }), numberParam("Script PID.")],
  description,
});
const scriptArgsParam = (description: string) => ({
  type: "array",
  items: { anyOf: [Type.String(), { type: "number" }, { type: "boolean" }] },
  description,
});

const agentScriptUrl = new URL("./pi-agent.js", import.meta.url);

const statusTool = defineTool({
  name: "bb_status",
  label: "Bitburner status",
  description: "Show the Bitburner Remote API bridge status.",
  promptSnippet: "Show Bitburner Remote API bridge connection status",
  promptGuidelines: ["Use bb_status to check whether Bitburner is connected before using other bb_* tools."],
  parameters: Type.Object({}),
  async execute() {
    return text({ listening: bridge.isListening, connected: bridge.isConnected, url: bridge.url });
  },
});

const getFileTool = defineTool({
  name: "bb_get_file",
  label: "Bitburner get file",
  description: "Read a file from Bitburner via Remote API.",
  promptSnippet: "Read an in-game Bitburner file via Remote API",
  promptGuidelines: ["Use bb_get_file when the user asks to inspect a file inside the running Bitburner game."],
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
  description: "Create or update a file in Bitburner via Remote API. Prefer localPath for project files; use content only for generated or one-off content.",
  promptSnippet: "Create or update an in-game Bitburner file via Remote API from a local file path or inline content",
  promptGuidelines: ["Use bb_push_file to copy completed script changes into the running Bitburner game when requested. Prefer localPath for repeatable pushes of project files; use content only for generated or one-off content."],
  parameters: Type.Object({
    filename: Type.Optional(Type.String({ description: "Bitburner filename to write. Defaults to basename(localPath) when localPath is provided." })),
    content: Type.Optional(Type.String({ description: "Full file contents." })),
    localPath: Type.Optional(Type.String({ description: "Local file path to read and push. Relative paths are resolved against pi's current working directory." })),
    server: Type.Optional(Type.String({ description: "Bitburner server hostname. Defaults to home." })),
  }),
  async execute(_id, params) {
    const server = params.server ?? "home";
    const localPath = params.localPath;
    const filename = params.filename ?? (localPath ? basename(localPath) : undefined);
    if (!filename) throw new Error("bb_push_file requires filename, or localPath to infer one.");
    if (params.content === undefined && localPath === undefined) {
      throw new Error("bb_push_file requires either content or localPath.");
    }

    let content = params.content;
    let resolvedLocalPath: string | undefined;
    if (localPath !== undefined) {
      const pathToRead = isAbsolute(localPath) ? localPath : resolve(process.cwd(), localPath);
      resolvedLocalPath = pathToRead;
      content = await readFile(pathToRead, "utf8");
    }

    const result = await bridge.pushFile(filename, content ?? "", server);
    return text(result, { filename, server, localPath: resolvedLocalPath });
  },
});

const deleteFileTool = defineTool({
  name: "bb_delete_file",
  label: "Bitburner delete file",
  description: "Delete a file from Bitburner via Remote API.",
  promptSnippet: "Delete an in-game Bitburner file via Remote API",
  promptGuidelines: ["Use bb_delete_file only when the user explicitly asks to remove a Bitburner file."],
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
  promptSnippet: "List in-game Bitburner files on a server via Remote API",
  promptGuidelines: ["Use bb_list_files to discover files on a Bitburner server before reading or modifying them."],
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
  promptSnippet: "Read all in-game Bitburner files from a server via Remote API",
  promptGuidelines: ["Use bb_get_all_files when the user wants a full snapshot of scripts/files from a Bitburner server."],
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
  promptSnippet: "Calculate in-game RAM cost for a Bitburner script",
  promptGuidelines: ["Use bb_calculate_ram after pushing or editing a Bitburner script when the user wants in-game RAM validation."],
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
  promptSnippet: "Fetch current Bitburner Netscript TypeScript definitions",
  promptGuidelines: ["Use bb_get_definition_file to verify API types against the running Bitburner game."],
  parameters: Type.Object({}),
  async execute() {
    return text(await bridge.getDefinitionFile());
  },
});

const installAgentTool = defineTool({
  name: "bb_install_agent",
  label: "Bitburner install diagnostic agent",
  description: "Install pi-agent.js on Bitburner home. Run it in-game once to enable process/log/run diagnostic tools.",
  promptSnippet: "Install the in-game Bitburner diagnostic agent script",
  promptGuidelines: ["Use bb_install_agent before bb_ps, bb_get_script_logs, bb_run_script, or other agent-backed tools if pi-agent.js is not installed."],
  parameters: Type.Object({}),
  async execute() {
    const agentScript = await readFile(agentScriptUrl, "utf8");
    const result = await bridge.pushFile("pi-agent.js", agentScript, "home");
    return text(`${result}\nRun in Bitburner: run pi-agent.js`, { filename: "pi-agent.js", server: "home" });
  },
});

const agentStatusTool = defineTool({
  name: "bb_agent_status",
  label: "Bitburner diagnostic agent status",
  description: "Ping the in-game pi-agent.js diagnostic agent.",
  promptSnippet: "Check whether pi-agent.js is running in Bitburner",
  promptGuidelines: ["Use bb_agent_status to verify the in-game diagnostic agent is running before agent-backed tools."],
  parameters: Type.Object({}),
  async execute() {
    return text(await bridge.agentRequest("ping"));
  },
});

const psTool = defineTool({
  name: "bb_ps",
  label: "Bitburner process list",
  description: "List running scripts on a Bitburner server via the in-game diagnostic agent.",
  promptSnippet: "List running Bitburner scripts on a server",
  promptGuidelines: ["Use bb_ps to inspect running scripts. Requires pi-agent.js running on home; install it with bb_install_agent first."],
  parameters: Type.Object({
    server: Type.Optional(Type.String({ description: "Bitburner server hostname. Defaults to home." })),
  }),
  async execute(_id, params) {
    const server = params.server ?? "home";
    return text(await bridge.agentRequest("ps", { server }), { server });
  },
});

const getScriptLogsTool = defineTool({
  name: "bb_get_script_logs",
  label: "Bitburner script logs",
  description: "Read logs for a running Bitburner script via the in-game diagnostic agent.",
  promptSnippet: "Read running Bitburner script logs",
  promptGuidelines: ["Use bb_get_script_logs to debug running scripts. Prefer pid when available. Requires pi-agent.js running on home."],
  parameters: Type.Object({
    fn: Type.Optional(filenameOrPidParam("Script filename or PID. If omitted, returns pi-agent.js logs.")),
    host: Type.Optional(Type.String({ description: "Script host. Defaults to home." })),
    args: Type.Optional(scriptArgsParam("Script args when identifying by filename.")),
  }),
  async execute(_id, params) {
    return text(await bridge.agentRequest("getScriptLogs", params));
  },
});

const getRunningScriptTool = defineTool({
  name: "bb_get_running_script",
  label: "Bitburner running script info",
  description: "Get RunningScript metadata for a running Bitburner script via the in-game diagnostic agent.",
  promptSnippet: "Get Bitburner RunningScript metadata",
  promptGuidelines: ["Use bb_get_running_script to inspect script runtime stats and logs. Prefer pid when available. Requires pi-agent.js running on home."],
  parameters: Type.Object({
    fn: Type.Optional(filenameOrPidParam("Script filename or PID. If omitted, returns pi-agent.js info.")),
    host: Type.Optional(Type.String({ description: "Script host. Defaults to home." })),
    args: Type.Optional(scriptArgsParam("Script args when identifying by filename.")),
  }),
  async execute(_id, params) {
    return text(await bridge.agentRequest("getRunningScript", params));
  },
});

const getRecentScriptsTool = defineTool({
  name: "bb_get_recent_scripts",
  label: "Bitburner recent scripts",
  description: "Get recently killed Bitburner scripts with logs via the in-game diagnostic agent.",
  promptSnippet: "Get recently killed Bitburner scripts and logs",
  promptGuidelines: ["Use bb_get_recent_scripts to inspect logs from scripts that already exited. Requires pi-agent.js running on home."],
  parameters: Type.Object({}),
  async execute() {
    return text(await bridge.agentRequest("getRecentScripts"));
  },
});

const runScriptTool = defineTool({
  name: "bb_run_script",
  label: "Bitburner run script",
  description: "Run a Bitburner script with ns.exec via the in-game diagnostic agent.",
  promptSnippet: "Run an in-game Bitburner script",
  promptGuidelines: ["Use bb_run_script only when the user asks to run a script. Requires pi-agent.js running on home."],
  parameters: Type.Object({
    filename: Type.String({ description: "Script filename to run." }),
    server: Type.Optional(Type.String({ description: "Host to run on. Defaults to home." })),
    threads: Type.Optional(numberParam("Thread count. Defaults to 1.")),
    args: Type.Optional(scriptArgsParam("Script args.")),
  }),
  async execute(_id, params) {
    return text(await bridge.agentRequest("runScript", params));
  },
});

const killScriptTool = defineTool({
  name: "bb_kill_script",
  label: "Bitburner kill script",
  description: "Kill a Bitburner script PID via the in-game diagnostic agent.",
  promptSnippet: "Kill an in-game Bitburner script by PID",
  promptGuidelines: ["Use bb_kill_script only when the user asks to kill a script. Requires pi-agent.js running on home."],
  parameters: Type.Object({
    pid: numberParam("Process ID to kill."),
  }),
  async execute(_id, params) {
    return text(await bridge.agentRequest("killScript", params));
  },
});

const getServerTool = defineTool({
  name: "bb_get_server",
  label: "Bitburner get server",
  description: "Get detailed server state via the in-game diagnostic agent.",
  promptSnippet: "Get detailed Bitburner server state",
  promptGuidelines: ["Use bb_get_server to inspect money/security/RAM on a server. Requires pi-agent.js running on home."],
  parameters: Type.Object({
    server: Type.Optional(Type.String({ description: "Bitburner server hostname. Defaults to home." })),
  }),
  async execute(_id, params) {
    const server = params.server ?? "home";
    return text(await bridge.agentRequest("getServer", { server }), { server });
  },
});

const getAllServersTool = defineTool({
  name: "bb_get_all_servers",
  label: "Bitburner get all servers",
  description: "List all Bitburner servers with basic access metadata.",
  promptSnippet: "List all Bitburner servers and basic access metadata",
  promptGuidelines: ["Use bb_get_all_servers when the user asks about servers known to the running Bitburner game."],
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
    installAgentTool,
    agentStatusTool,
    psTool,
    getScriptLogsTool,
    getRunningScriptTool,
    getRecentScriptsTool,
    runScriptTool,
    killScriptTool,
    getServerTool,
    getAllServersTool,
  ]) {
    pi.registerTool(tool);
  }
}
