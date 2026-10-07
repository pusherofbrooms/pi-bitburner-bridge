/** Low-RAM live smoke test. Run through the game terminal, not pi-agent.js. */
export async function main(ns) {
  const player = ns.getPlayer();
  const reset = ns.getResetInfo();
  const result = {
    ok: true,
    time: Date.now(),
    host: ns.getHostname(),
    bitNode: reset.currentNode,
    hacking: player.skills.hacking,
    money: player.money,
    homeRam: ns.getServerMaxRam("home"),
    processes: ns.ps("home"),
  };
  await ns.write("bridge-live-probe-result.txt", JSON.stringify(result), "w");
  ns.tprint(JSON.stringify(result));
}
