const { spawnSync } = require("node:child_process");
const path = require("node:path");

if (String(process.env.npm_config_global).toLowerCase() === "true") {
  const cli = path.join(__dirname, "..", "bin", "cli.js");
  spawnSync(process.execPath, [cli, "install", "--postinstall"], { stdio: "ignore", windowsHide: true });
}
