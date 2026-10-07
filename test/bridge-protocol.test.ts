import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultControlSocketPath } from "../src/bridge-protocol.ts";

test("default rendezvous path is independent of Nix TMPDIR; override wins", () => {
  const oldSocket = process.env.BITBURNER_BRIDGE_SOCKET;
  const oldTmp = process.env.TMPDIR;
  try {
    delete process.env.BITBURNER_BRIDGE_SOCKET;
    process.env.TMPDIR = "/tmp/nix-develop-first";
    const first = defaultControlSocketPath(12525);
    process.env.TMPDIR = "/tmp/nix-develop-second";
    assert.equal(defaultControlSocketPath(12525), first);
    assert.match(first, /^\/tmp\/pi-bitburner-bridge-/);
    process.env.BITBURNER_BRIDGE_SOCKET = "/tmp/explicit.sock";
    assert.equal(defaultControlSocketPath(12525), "/tmp/explicit.sock");
  } finally {
    if (oldSocket === undefined) delete process.env.BITBURNER_BRIDGE_SOCKET; else process.env.BITBURNER_BRIDGE_SOCKET = oldSocket;
    if (oldTmp === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = oldTmp;
  }
});
