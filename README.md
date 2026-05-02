# pi-bitburner-bridge

A pi extension that hosts a Bitburner 3.0 Remote API WebSocket server.

Bitburner connects to this process from **Options -> Remote API**. Once connected, pi gets tools for reading/writing in-game files and querying Remote API data.

## Current tools

- `bb_status`
- `bb_get_file`
- `bb_push_file`
- `bb_delete_file`
- `bb_list_files`
- `bb_get_all_files`
- `bb_calculate_ram`
- `bb_get_definition_file`
- `bb_get_all_servers`

## Use with pi

From this repo:

```bash
pi -e ./src/index.ts
```

Then in Bitburner Steam/web:

1. Open **Options -> Remote API**.
2. Set host to `127.0.0.1`.
3. Set port to `12525`.
4. Press **Connect**.

Environment overrides:

- `BITBURNER_REMOTE_API_HOST`
- `BITBURNER_REMOTE_API_PORT`

## Development

```bash
nix develop --command npm install
nix develop --command npm test
nix develop --command npm run typecheck
```
