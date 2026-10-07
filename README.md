# pi-bitburner-bridge

Pi extension for Bitburner 3.0's Remote API.

It automatically starts a managed local bridge daemon. Bitburner connects to the daemon's WebSocket server, while pi talks to it through a per-user Unix socket. The daemon exits after the last pi session disconnects, so starting and quitting pi still manages the API lifecycle.

## Run

```bash
cd ~/ai/pi-bitburner-bridge
pi -e ./src/index.ts
```

In Bitburner: **Options → Remote API**

- Host: `127.0.0.1`
- Port: `12525`
- Click **Connect**

The daemon is started automatically by the extension and owns the single Bitburner connection on port `12525`. Pi sessions share it over a local Unix socket; no separate daemon command is required. When the last pi client exits, the daemon closes the API and exits.

Environment overrides:

- `BITBURNER_REMOTE_API_HOST` / `BITBURNER_REMOTE_API_PORT`: Bitburner-facing WebSocket address.
- `BITBURNER_BRIDGE_SOCKET`: pi-facing Unix socket path.

## Tools

`bb_status`, `bb_get_file`, `bb_push_file`, `bb_delete_file`, `bb_list_files`, `bb_get_all_files`, `bb_calculate_ram`, `bb_get_definition_file`, `bb_get_all_servers`

Diagnostic tools backed by an in-game Netscript agent: `bb_install_agent`, `bb_agent_status`, `bb_ps`, `bb_get_script_logs`, `bb_get_running_script`, `bb_get_recent_scripts`, `bb_run_script`, `bb_kill_script`, `bb_get_server`.

To enable diagnostic tools in a pi session:

1. Start this extension and connect Bitburner's Remote API as above.
2. Use `bb_install_agent` to write the bundled `src/pi-agent.js` to `home` as `pi-agent.js`.
3. In Bitburner, run `run pi-agent.js` once.
4. Use `bb_agent_status` to verify the agent is responding.

`pi-agent.js` remains installed on `home` after step 2, but it must be running for diagnostic tools to work. After restarting Bitburner, or if the process is killed, run `run pi-agent.js` again. Re-run `bb_install_agent` after updating the bridge if you want to refresh the in-game copy.

The Remote API itself only exposes file/server metadata, so these tools communicate with `pi-agent.js` through small command/response files.

## Dev

Requires Node.js 22.19 or newer. The extension is typechecked against real pi 1.0.4 APIs; the development dependencies pin that version. At runtime, pi supplies the `@earendil-works/*` peer libraries.

Tests run without Bitburner and cover the bridge plus extension registration, notifications, and session-relative file pushes using simulated peers.

```bash
nix develop --command npm install
nix develop --command npm test
nix develop --command npm run typecheck
```
