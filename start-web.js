// Wrapper: changes into web/ then starts the Vite dev server.
// Passes PORT env var (set by preview_start) to Vite's --port flag.
const path = require("path");
const { spawnSync } = require("child_process");
const webDir = path.join(__dirname, "web");
const vite = path.join(webDir, "node_modules", "vite", "bin", "vite.js");
const port = process.env.PORT;
const args = port
  ? [vite, "--port", port, "--strictPort", "--host", "0.0.0.0"]
  : [vite];
spawnSync(process.execPath, args, { cwd: webDir, stdio: "inherit" });
