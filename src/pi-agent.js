/** @param {NS} ns */
export async function main(ns) {
  const commandFile = "pi-bridge-command.txt";
  const responsePrefix = "pi-bridge-response-";
  ns.disableLog("ALL");
  ns.print("pi-agent.js ready");
  while (true) {
    const raw = ns.read(commandFile);
    if (raw) {
      await ns.write(commandFile, "", "w");
      try {
        const command = JSON.parse(raw);
        if (command.id) {
          const result = await handle(command.method, command.params ?? {});
          await ns.write(responsePrefix + command.id + ".txt", JSON.stringify({ id: command.id, result }), "w");
        }
      } catch (error) {
        try {
          const command = JSON.parse(raw);
          if (command.id) {
            await ns.write(responsePrefix + command.id + ".txt", JSON.stringify({ id: command.id, error: String(error?.stack ?? error) }), "w");
          }
        } catch {
          ns.print("Failed to process bridge command: " + String(error));
        }
      }
    }
    await ns.sleep(200);
  }

  async function handle(method, params) {
    switch (method) {
      case "ping":
        return { ok: true, hostname: ns.getHostname(), time: Date.now() };
      case "ps":
        return ns.ps(params.server ?? "home");
      case "getScriptLogs":
        if (params.fn === undefined) return ns.getScriptLogs();
        if (typeof params.fn === "number") return ns.getScriptLogs(params.fn);
        return ns.getScriptLogs(params.fn, params.host ?? "home", ...(params.args ?? []));
      case "getRunningScript":
        if (params.fn === undefined) return ns.getRunningScript();
        if (typeof params.fn === "number") return ns.getRunningScript(params.fn);
        return ns.getRunningScript(params.fn, params.host ?? "home", ...(params.args ?? []));
      case "getRecentScripts":
        return ns.getRecentScripts();
      case "getServer":
        return ns.getServer(params.server ?? "home");
      case "runScript":
        return ns.exec(params.filename, params.server ?? "home", params.threads ?? 1, ...(params.args ?? []));
      case "killScript":
        return ns.kill(params.pid);
      default:
        throw new Error("Unknown pi-agent method: " + method);
    }
  }
}
