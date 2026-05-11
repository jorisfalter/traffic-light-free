import { execFileSync, spawnSync } from "node:child_process";

function localIp() {
  for (const iface of ["en0", "en1"]) {
    const result = spawnSync("ipconfig", ["getifaddr", iface], { encoding: "utf8" });
    const ip = result.stdout.trim();
    if (result.status === 0 && ip) {
      return ip;
    }
  }

  throw new Error("Could not find a local Wi-Fi IP address on en0 or en1.");
}

const ip = process.env.CAP_LIVE_HOST ?? localIp();
const port = process.env.CAP_LIVE_PORT ?? "5173";
const url = `http://${ip}:${port}`;

console.log(`Syncing iOS app for live reload from ${url}`);

execFileSync("npx", ["cap", "sync", "ios"], {
  stdio: "inherit",
  env: {
    ...process.env,
    CAP_SERVER_URL: url,
  },
});
