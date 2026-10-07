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

## Standalone daemon and agent-neutral CLI (OpenClaw)

No Pi runtime is required by these entry points. The existing transport is shared;
there is no additional HTTP server, tool plugin, or dependency to install.
Run on the **same machine as the game** (for OpenClaw, use node execution there).

```bash
cd ~/ai/pi-bitburner-bridge
nix develop --command npm run --silent daemon
# In another command invocation:
nix develop --command npm run --silent bb -- --help
nix develop --command npm run --silent bb -- status
nix develop --command npm run --silent bb -- push /absolute/path/probe.js
nix develop --command npm run --silent bb -- ram probe.js
nix develop --command npm run --silent bb -- get probe-result.txt
nix develop --command npm run --silent bb -- save --out /absolute/path/before-reset.json
```

Alternatively, load the environment already configured by `~/ai/.envrc` and run
`npm run --silent bb -- ...`. This machine's `.envrc` delegates to
`~/ai/dev-workspace/envrc`; its noninteractive equivalent is
`nix develop ~/ai/dev-workspace --command ...`, which also supplies Pi for testing.

`daemon` runs in the foreground until SIGINT/SIGTERM or `bb stop`. Supervise it
with your existing process runner when it should survive command/agent turns.
Do not repeatedly spawn it for individual calls. The CLI **attaches only** and
fails with instructions if no daemon is running. CLI success/error output is JSON;
help is plain text, and daemon readiness is logged to stderr.

Connect the game through **Options → Remote API**, `127.0.0.1:12525`, WSS off.
Use identical `BITBURNER_REMOTE_API_HOST`, `BITBURNER_REMOTE_API_PORT`, and
`BITBURNER_BRIDGE_SOCKET` settings across all clients. CDP access to Electron's UI
is separate from this connection and uses a different port.

### Lifecycle and Pi compatibility

- Pi still auto-starts a client-owned daemon when none exists. That daemon exits
  after its final client disconnects, exactly as before.
- The standalone entry point uses `--persistent`: it stays up with zero clients.
- Pi attaches to an existing standalone daemon. Quitting Pi disconnects only Pi;
  it does not stop the persistent daemon or the game connection.
- `bb stop` stops the **shared daemon and every client's game connection**. It
  does not terminate Bitburner or erase its save.
- Only one daemon owns the game WebSocket port. Starting a second one fails
  rather than replacing the first. Diagnostic requests share a serialized queue.
- The Unix control socket is restricted to its owner (`0600`). The WebSocket
  listener defaults to loopback; this is a local bridge, not a public API.

### Fresh BN1.1 and tool semantics

File operations, definitions, server metadata, save export, and RAM calculation
use the Remote API directly and do not consume Netscript RAM. `install-agent`
only copies `pi-agent.js`; it does not run it. Process/log/run/kill diagnostics
require that agent running on `home`, so use the UI terminal and a tiny reporting
script when fresh-game RAM is insufficient. Do not interpret a diagnostic timeout
as failure of the Remote API itself.

`run` returns a PID; **0 means the game did not launch the script**, even if the
RPC succeeded. `kill` returns the game's boolean result. Mutations are not retried
automatically; after a timeout, inspect live state before retrying.

`get --out` and `definitions --out` write raw text. `save --out` writes the full
Remote API save object as JSON (including its `save` field), not a modified game
save. Keep it locally; export does not reset or import anything. Output files may
be overwritten; choose backup filenames deliberately. Full command descriptions,
parameters, prerequisites, and examples are in `bb --help`.

### Compatibility smoke test with real Pi

```bash
nix develop ~/ai/dev-workspace --command npm run test:pi
```

This starts real Pi in offline RPC mode with only the bridge and a temporary
observer extension. It checks all 18 tools, `bb-status` registration, session
startup/shutdown, automatic daemon exit, and persistent-daemon survival. It makes
no model calls, does not read/write a game, and uses isolated ports/sockets.

The default control socket is now `/tmp/pi-bitburner-bridge-<uid>-<port>.sock`,
independent of `TMPDIR` (Nix dev shells change it between invocations). Restart
older running bridge/Pi sessions when updating, or explicitly set
`BITBURNER_BRIDGE_SOCKET` consistently to keep a custom path.
