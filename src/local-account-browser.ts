import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";

const HOST = "127.0.0.1";
const HELPER_PORT = 9223;
const CDP_PORT = 9222;
const ALLOWED_ORIGINS = new Set([
  "http://127.0.0.1:3000",
  "http://localhost:3000",
]);
let chromeProcess: ChildProcess | null = null;

function chromeCandidates(): string[] {
  const programFiles = process.env.ProgramFiles || "C:\\Program Files";
  const programFilesX86 =
    process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
  const localAppData =
    process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
  return [
    path.join(programFiles, "Google", "Chrome", "Application", "chrome.exe"),
    path.join(programFilesX86, "Google", "Chrome", "Application", "chrome.exe"),
    path.join(localAppData, "Google", "Chrome", "Application", "chrome.exe"),
  ];
}

function findChrome(): string {
  const chrome = chromeCandidates().find((candidate) => fs.existsSync(candidate));
  if (!chrome) throw new Error("Google Chrome não encontrado neste PC.");
  return chrome;
}

function isPortOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: HOST, port });
    const finish = (open: boolean) => {
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(500);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

async function waitForChrome(): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (await isPortOpen(CDP_PORT)) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Chrome local não abriu a porta de automação a tempo.");
}

async function ensureChrome(): Promise<void> {
  if (await isPortOpen(CDP_PORT)) return;
  const localAppData =
    process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
  const profilePath = path.join(localAppData, "QwenSofia", "signup-browser");
  fs.mkdirSync(profilePath, { recursive: true });
  chromeProcess = spawn(
    findChrome(),
    [
      `--remote-debugging-address=${HOST}`,
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=${profilePath}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-blink-features=AutomationControlled",
      "about:blank",
    ],
    { stdio: "ignore", windowsHide: false },
  );
  chromeProcess.once("exit", () => {
    chromeProcess = null;
  });
  await waitForChrome();
}

function allowRequest(request: http.IncomingMessage): boolean {
  const origin = request.headers.origin;
  return !origin || ALLOWED_ORIGINS.has(origin);
}

function sendJson(
  response: http.ServerResponse,
  status: number,
  body: Record<string, unknown>,
  origin?: string,
): void {
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
  }
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

const server = http.createServer(async (request, response) => {
  const origin = request.headers.origin;
  if (!allowRequest(request)) {
    sendJson(response, 403, { error: "Origem não permitida." });
    return;
  }
  if (request.method === "OPTIONS") {
    if (origin) response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    response.writeHead(204).end();
    return;
  }
  if (request.method === "GET" && request.url === "/status") {
    sendJson(response, 200, { ok: true, chromeReady: await isPortOpen(CDP_PORT) }, origin);
    return;
  }
  if (request.method === "POST" && request.url === "/launch") {
    try {
      await ensureChrome();
      sendJson(response, 200, { ok: true, chromeReady: true }, origin);
    } catch (error) {
      sendJson(
        response,
        500,
        { error: error instanceof Error ? error.message : String(error) },
        origin,
      );
    }
    return;
  }
  sendJson(response, 404, { error: "Rota não encontrada." }, origin);
});

server.listen(HELPER_PORT, HOST, () => {
  console.log(`[QwenSofia] Worker local pronto em http://${HOST}:${HELPER_PORT}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => server.close(() => process.exit(0)));
}
