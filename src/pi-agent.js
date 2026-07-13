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
      case "ps": {
        const server = params.server ?? "home";
        let processes = ns.ps(server);

        if (params.pid !== undefined) {
          processes = processes.filter((process) => process.pid === params.pid);
        }
        if (params.filename) {
          processes = processes.filter((process) => process.filename === params.filename);
        }
        if (params.filenameIncludes) {
          processes = processes.filter((process) => process.filename.includes(params.filenameIncludes));
        }
        if (params.argsIncludes) {
          const needle = String(params.argsIncludes);
          processes = processes.filter((process) => (process.args ?? []).some((arg) => String(arg).includes(needle)));
        }

        const total = processes.length;
        if (params.summary) {
          const byFilename = new Map();
          for (const process of processes) {
            const item = byFilename.get(process.filename) ?? { filename: process.filename, count: 0, threads: 0 };
            item.count += 1;
            item.threads += process.threads ?? 0;
            byFilename.set(process.filename, item);
          }
          return {
            server,
            total,
            byFilename: [...byFilename.values()].sort((a, b) => b.count - a.count || a.filename.localeCompare(b.filename)),
          };
        }

        const offset = Math.max(0, Math.trunc(Number(params.offset ?? 0)) || 0);
        const requestedLimit = Math.trunc(Number(params.limit ?? 100)) || 100;
        const limit = Math.min(1000, Math.max(0, requestedLimit));
        const page = processes.slice(offset, offset + limit);
        return {
          server,
          total,
          returned: page.length,
          offset,
          limit,
          truncated: offset + page.length < total,
          processes: page,
        };
      }
      case "getScriptLogs": {
        const fn = normalizeFilenameOrPid(params.fn);
        if (fn === undefined) return ns.getScriptLogs();
        if (typeof fn === "number") return ns.getScriptLogs(fn);
        return ns.getScriptLogs(fn, params.host ?? "home", ...(params.args ?? []));
      }
      case "getRunningScript": {
        const fn = normalizeFilenameOrPid(params.fn);
        if (fn === undefined) return ns.getRunningScript();
        if (typeof fn === "number") return ns.getRunningScript(fn);
        return ns.getRunningScript(fn, params.host ?? "home", ...(params.args ?? []));
      }
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

  function normalizeFilenameOrPid(fn) {
    return typeof fn === "string" && /^\d+$/.test(fn) ? Number(fn) : fn;
  }
}
