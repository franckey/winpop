const { spawn } = require("child_process");
const electronPath = require("electron");

// Remove ELECTRON_RUN_AS_NODE so the Electron binary runs as Electron, not Node
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronPath, ["."].concat(process.argv.slice(2)), {
  stdio: "inherit",
  env,
  cwd: __dirname,
});

child.on("close", (code) => process.exit(code));
