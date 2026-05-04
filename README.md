# pi-bitburner-bridge

Pi extension for Bitburner 3.0's Remote API.

It starts a local WebSocket server. Bitburner connects to it, then pi can read/write in-game files and query script RAM/API data.

## Run

```bash
cd ~/ai/pi-bitburner-bridge
pi -e ./src/index.ts
```

In Bitburner: **Options → Remote API**

- Host: `127.0.0.1`
- Port: `12525`
- Click **Connect**

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

```bash
nix develop --command npm install
nix develop --command npm test
nix develop --command npm run typecheck
```
