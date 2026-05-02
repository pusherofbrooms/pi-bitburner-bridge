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

## Dev

```bash
nix develop --command npm install
nix develop --command npm test
nix develop --command npm run typecheck
```
