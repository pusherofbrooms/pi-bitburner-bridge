# Bridge live verification — 2026-10-07

## Environment

- Shared `~/ai/.envrc` environment: `nix develop ~/ai/dev-workspace --command …`.
- Actual Pi 1.0.4, Node 24.21.0.
- Existing packaged Electron app:
  `~/ai/bitburner-src/.build/bitburner-darwin-universal/bitburner.app`.
- Live renderer title: `Bitburner v3.0.2 (ddffed21c)`; Electron 41.4.0.
- Launched on the Mac with `--remote-debugging-port=9223`.
- Named agent-browser session `bitburner-bridge-live` attached to that renderer.
- Remote API connected to `127.0.0.1:12525`, WSS off.
- The existing game was already near-starting BN1; no reset was needed.
  This does not establish that the packaged build is the latest upstream release.

## Passed

- TypeScript typecheck and 11 automated tests.
- Real Pi offline RPC smoke test, no model calls: all 18 tools and `bb-status`
  registered; automatic daemon exits on Pi shutdown; standalone daemon survives.
- Standalone persistent daemon and CLI connect across separate Nix invocations.
- CLI pushes `scripts/live-probe.js` as `bridge-live-probe.js` to home.
- Live game RAM calculation: **3.4 GB**.
- UI terminal executes `run bridge-live-probe.js`.
- CLI retrieves `bridge-live-probe-result.txt`; raw evidence is `live-probe.json`:
  `ok=true`, BN1, hacking=1, home RAM=8 GB, PID=1.
- No `pi-agent.js` was installed or running for this test.
- Direct Remote API server metadata, definitions, and save export succeeded.
  Definitions and save snapshot were written locally to
  `/tmp/bitburner-bridge-live-definitions.d.ts` and
  `/tmp/bitburner-bridge-live-save.json`; save contents are not checked into Git.

## Issues found and corrected

- Nix sets a different TMPDIR for separate shell invocations. Default socket now
  uses stable `/tmp/pi-bitburner-bridge-<uid>-<port>.sock`; override still works.
- Auto-started child previously ignored the client's constructor port. It now
  inherits that port explicitly; regression assertion checks the actual URL.
- Raw browser fill/key-selection appended to the hostname. Replaced fields via
  the native DOM input setter and bubbling input/change events, verified the
  rendered `127.0.0.1` hostname, then connected successfully.
- An offline-progress modal initially blocked UI actions; dismissed before testing.

## Scope

No old gameplay scripts were consulted or deployed. No OpenClaw configuration,
automation, global packages, or additional runtime dependencies were installed.
OpenClaw uses the CLI; native OpenClaw tool registration is not included.
Agent-backed diagnostics were tested with simulated game replies, not with a
live pi-agent, because the no-agent fresh-game path was the intended live test.
Full Electron close/relaunch recovery and a latest-release launch procedure
remain separate work from this bridge change.

The repository-local macOS dev shell was enabled in `flake.nix`. Its additional
bootstrap check was cancelled while fetching the pinned nixpkgs source after
several minutes; no failure was observed, but that independent shell is not
verified. All completed checks above used the user's shared `~/ai` dev shell.
