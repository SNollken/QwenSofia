const { app, BrowserWindow, dialog } = require("electron");
const { spawn } = require("node:child_process");
const path = require("node:path");

let server;
const port = process.env.PORT || "3000";

async function waitForServer() {
  for (let i = 0; i < 80; i++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("O servidor QwenSofia não iniciou a tempo.");
}

async function createWindow() {
  server = spawn(process.execPath, [path.join(__dirname, "..", "node_modules", "tsx", "dist", "cli.mjs"), path.join(__dirname, "..", "src", "index.ts")], {
    cwd: path.join(__dirname, ".."),
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", HOST: "127.0.0.1", PORT: port },
    stdio: "inherit",
  });
  try {
    await waitForServer();
  } catch (error) {
    dialog.showErrorBox("QwenSofia", error.message);
    app.quit();
    return;
  }
  const window = new BrowserWindow({ width: 1180, height: 780, minWidth: 900, minHeight: 620, backgroundColor: "#07090d", title: "QwenSofia", webPreferences: { contextIsolation: true, sandbox: true } });
  await window.loadURL(`http://127.0.0.1:${port}/`);
}

app.whenReady().then(createWindow);
app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => server?.kill());
