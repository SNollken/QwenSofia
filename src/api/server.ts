import crypto from "crypto";
import { v4 as uuidv4 } from "uuid";
import { Hono, type Context } from "hono";
import { serve } from "@hono/node-server";
import { config } from "../core/config.js";
import { metrics } from "../core/metrics.js";
import { logger, maskEmail } from "../core/logger.js";
import { MemoryCache } from "../cache/memory-cache.js";
import { Watchdog } from "../core/watchdog.js";
import { app as modelsApp } from "./models.js";
import { chatCompletions, chatCompletionsStop } from "../routes/chat.js";
import { uploadFile } from "../routes/upload.js";
import { anthropicApp } from "../routes/anthropic/index.js";
import { responsesApp } from "../routes/responses/index.js";
import { sendOpenAIError } from "./error-helpers.js";
import {
  AuthError,
  NotFoundError,
  PayloadTooLargeError,
} from "../core/errors.js";
import type { QwenAccount } from "../core/accounts.js";
import { adminApp } from "./admin.js";
import { dashboardHtml } from "../dashboard/page.js";
import { getAccountConcurrencyStats } from "../core/account-concurrency.ts";

// Module-level state (initialized in startServer)
let cache: MemoryCache | undefined;
let watchdog: Watchdog | undefined;
let server: any;
let startPromise: Promise<StartedServerInfo> | null = null;
let stopPromise: Promise<void> | null = null;
let accountPreparationPromise: Promise<void> | null = null;
let signalHandlersInstalled = false;

export function classifyStartupAccounts<
  T extends { cooldown_until?: number | null },
>(
  accounts: T[],
  now = Date.now(),
): {
  expiredCooldownAccounts: T[];
  availableAccounts: T[];
} {
  return {
    expiredCooldownAccounts: accounts.filter(
      (account) =>
        account.cooldown_until !== null &&
        account.cooldown_until !== undefined &&
        account.cooldown_until > 0 &&
        account.cooldown_until <= now,
    ),
    availableAccounts: accounts.filter(
      (account) => !account.cooldown_until || account.cooldown_until <= now,
    ),
  };
}

const app = new Hono();

// Module-level accessor for cross-module cache access
export function getCache(): MemoryCache | undefined {
  return cache;
}

export function setCacheForTesting(nextCache: MemoryCache | undefined): void {
  cache = nextCache;
}

// Middleware must be registered BEFORE routes
app.use("*", async (c, next) => {
  const requestId = c.req.header("X-Request-Id") || uuidv4();
  c.header("X-Request-Id", requestId);

  metrics.increment("requests.total");
  const start = Date.now();
  await next();
  const duration = Date.now() - start;
  metrics.histogram("latency.request", duration);
  c.header("X-Response-Time", `${duration}ms`);
});

function constantTimeStringEqual(provided: string, expected: string): boolean {
  const providedBuf = Buffer.from(provided);
  const expectedBuf = Buffer.from(expected);
  const providedHash = crypto.createHash("sha256").update(providedBuf).digest();
  const expectedHash = crypto.createHash("sha256").update(expectedBuf).digest();

  return (
    crypto.timingSafeEqual(providedHash, expectedHash) &&
    providedBuf.length === expectedBuf.length
  );
}

function verifyApiKey(c: Context): Response | null {
  const apiKey = process.env.API_KEY || config.apiKey;
  if (!apiKey) return null;

  const auth = c.req.header("Authorization");
  if (!auth?.startsWith("Bearer ")) {
    return sendOpenAIError(
      c,
      new AuthError("Missing or invalid Authorization header"),
    );
  }
  const token = auth.slice(7);
  if (!constantTimeStringEqual(token, apiKey)) {
    return sendOpenAIError(c, new AuthError("Invalid API key"));
  }
  return null;
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

/**
 * Falha de forma clara quando o bind é não local sem credenciais. Loopback
 * segue permitido sem exigências; qualquer outro HOST requer API_KEY e
 * ADMIN_TOKEN configurados.
 */
export function assertExposureCredentials(opts: {
  host: string;
  apiKey?: string;
  adminToken?: string;
}): void {
  if (LOOPBACK_HOSTS.has(opts.host)) return;
  const missing: string[] = [];
  if (!opts.apiKey) missing.push("API_KEY");
  if (!opts.adminToken) missing.push("ADMIN_TOKEN");
  if (missing.length > 0) {
    throw new Error(
      `[Server] Refusing to bind non-loopback HOST "${opts.host}" without credentials (${missing.join(", ")} unset). Set them or keep HOST on loopback.`,
    );
  }
}

app.use("/v1/*", async (c, next) => {
  const error = verifyApiKey(c);
  if (error) return error;
  await next();
});

// Teto de transporte para corpos de requisição (QP-03): rejeita com 413
// ANTES de materializar o payload inteiro em memória. Content-Length acima do
// teto cai imediato; corpos sem Content-Length são lidos em stream com teto.
// O teto é lido por requisição (testes variam o valor sem recarregar módulo).
const DEFAULT_MAX_REQUEST_BODY_BYTES = 125_829_120; // 120 MiB

function maxRequestBodyBytes(): number {
  const value = Number(process.env.MAX_REQUEST_BODY_BYTES);
  return Number.isFinite(value) && value > 0
    ? value
    : DEFAULT_MAX_REQUEST_BODY_BYTES;
}

app.use("*", async (c, next) => {
  if (c.req.method === "GET" || c.req.method === "HEAD") {
    return next();
  }
  const maxBytes = maxRequestBodyBytes();
  const contentLength = Number(c.req.header("content-length") || 0);
  if (contentLength > maxBytes) {
    return sendOpenAIError(
      c,
      new PayloadTooLargeError(`request body exceeds ${maxBytes} bytes`),
    );
  }

  const body = c.req.raw.body;
  if (body && contentLength === 0) {
    // Sem Content-Length (chunked/stream): limita enquanto lê
    let received = 0;
    const capped = body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          received += chunk.byteLength;
          if (received > maxBytes) {
            controller.error(
              new PayloadTooLargeError(
                `request body exceeds ${maxBytes} bytes`,
              ),
            );
            return;
          }
          controller.enqueue(chunk);
        },
      }),
    );
    c.req.raw = new Request(c.req.url, {
      method: c.req.method,
      headers: c.req.raw.headers,
      body: capped,
      duplex: "half",
      signal: c.req.raw.signal,
    } as RequestInit);
  }
  await next();
});

// Routes
app.route("", modelsApp);
app.post("/v1/chat/completions", chatCompletions);
app.post("/v1/chat/completions/stop", chatCompletionsStop);
app.post("/v1/upload", uploadFile);

// Anthropic API compatible routes
app.route("", anthropicApp);

// OpenAI Responses API compatible routes
app.route("", responsesApp);

const ADMIN_RATE_WINDOW_MS = 60_000;
const ADMIN_RATE_MAX_REQUESTS = 60;
const LIVE_CAPTCHA_RATE_MAX_REQUESTS = 1_200;
const adminRequestTimestamps = new Map<string, number[]>();
const liveCaptchaRequestTimestamps = new Map<string, number[]>();

function isRequestRateLimited(
  timestampsByClient: Map<string, number[]>,
  clientIp: string,
  maxRequests: number,
): boolean {
  const now = Date.now();
  const recent = (timestampsByClient.get(clientIp) ?? []).filter(
    (at) => now - at < ADMIN_RATE_WINDOW_MS,
  );
  recent.push(now);
  timestampsByClient.set(clientIp, recent);
  return recent.length > maxRequests;
}

function isLiveCaptchaRequest(pathname: string): boolean {
  return /^\/api\/admin\/registrations\/[^/]+\/captcha(?:\/pointer)?$/.test(
    pathname,
  );
}

app.use("/api/admin/*", async (c, next) => {
  const clientIp =
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const liveCaptcha = isLiveCaptchaRequest(new URL(c.req.url).pathname);
  const rateLimited = liveCaptcha
    ? isRequestRateLimited(
        liveCaptchaRequestTimestamps,
        clientIp,
        LIVE_CAPTCHA_RATE_MAX_REQUESTS,
      )
    : isRequestRateLimited(
        adminRequestTimestamps,
        clientIp,
        ADMIN_RATE_MAX_REQUESTS,
      );
  if (rateLimited) {
    return c.json(
      { error: "Muitas requisições administrativas; tente novamente em instantes" },
      429,
    );
  }
  if (!LOOPBACK_HOSTS.has(config.server.host)) {
    const expected = process.env.ADMIN_TOKEN;
    if (!expected) {
      return c.json(
        { error: "Administração desabilitada: configure ADMIN_TOKEN para habilitar" },
        503,
      );
    }
    const provided = c.req.header("X-Admin-Token");
    if (!provided || !constantTimeStringEqual(provided, expected)) {
      return c.json({ error: "Token administrativo inválido" }, 401);
    }
  }
  await next();
});
app.route("", adminApp);
app.get("/", (c) => {
  c.header("Cache-Control", "no-store");
  return c.html(dashboardHtml);
});

app.get("/health", async (c) => {
  const status = await watchdog?.getStatus();
  const { getPlaywrightStatus } = await import("../services/playwright.ts");
  const runtimes = Object.values(getPlaywrightStatus());
  return c.json({
    status: status?.overall || "unknown",
    timestamp: Date.now(),
    metrics: {
      cache: await cache?.getStats(),
    },
    accountConcurrency: getAccountConcurrencyStats(),
    accountRuntime: {
      initialized: runtimes.filter((runtime) => runtime.initialized).length,
      withHeaders: runtimes.filter((runtime) => runtime.initialized && runtime.hasHeaders).length,
      prepareAll: process.env.PREPARE_ALL_ON_STARTUP === "true",
      keepAlive: config.sessionKeeper.enabled,
      idleCloseMs: config.playwright.idleContextTtlMs,
    },
  });
});

app.get("/metrics", (c) => {
  const error = verifyApiKey(c);
  if (error) return error;
  return c.text(metrics.formatPrometheus(), {
    headers: { "Content-Type": "text/plain; version=0.0.4" },
  });
});

app.onError((err, c) => {
  const requestId = c.req.header("X-Request-Id") || "unknown";
  metrics.increment("requests.errors");
  logger.error("API Error", {
    requestId,
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  });
  return sendOpenAIError(c, err);
});

app.notFound((c) => sendOpenAIError(c, new NotFoundError("Not found")));

export interface StartedServerInfo {
  host: string;
  port: number;
  url: string;
}

function buildStartedServerInfo(): StartedServerInfo {
  const host =
    config.server.host === "0.0.0.0" ? "127.0.0.1" : config.server.host;
  return {
    host,
    port: config.server.port,
    url: `http://${host}:${config.server.port}`,
  };
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function warmConfiguredChatPools(
  warmQwenChatPool: (
    accountId: string | undefined,
    modelId: string,
  ) => Promise<void>,
  accountId?: string,
): Promise<void> {
  await Promise.all(
    config.qwen.chatPoolModels.map((model) =>
      warmQwenChatPool(accountId, model).catch(() => {}),
    ),
  );
}

async function prepareQwenRuntime(params: {
  accountId?: string;
  successMessage: string;
  failureMessage: string;
  initAuth: () => Promise<void>;
  disableNativeTools: (accountId?: string) => Promise<void>;
  warmQwenChatPool: (
    accountId: string | undefined,
    modelId: string,
  ) => Promise<void>;
}): Promise<boolean> {
  try {
    await params.initAuth();
    await params.disableNativeTools(params.accountId).catch(() => {});
    await warmConfiguredChatPools(params.warmQwenChatPool, params.accountId);
    if (params.accountId) {
      const { getAccountCooldownInfo } =
        await import("../core/account-manager.ts");
      const cooldownInfo = getAccountCooldownInfo(params.accountId);
      if (cooldownInfo) {
        console.warn(
          `⚠️  [Server] Account not ready: cooldown ${Math.ceil(cooldownInfo.remainingMs / 1000)}s (${cooldownInfo.reason})`,
        );
        return false;
      }
    }
    console.log(`✅ ${params.successMessage}`);
    return true;
  } catch (error) {
    console.warn(`❌ ${params.failureMessage}`, getErrorMessage(error));
    return false;
  }
}

async function prepareAccountRuntime(
  account: QwenAccount,
  getAccountCredentials: (accountId: string) => QwenAccount | undefined,
  initPlaywrightForAccount: (
    account: QwenAccount,
    headless: boolean,
    browserType?: "chromium" | "chrome" | "edge",
  ) => Promise<void>,
  disableNativeTools: (accountId?: string) => Promise<void>,
  warmQwenChatPool: (
    accountId: string | undefined,
    modelId: string,
  ) => Promise<void>,
): Promise<boolean> {
  return prepareQwenRuntime({
    accountId: account.id,
    successMessage: `[Server] Account ready: ${maskEmail(account.email)}`,
    failureMessage: `[Server] Account init failed ${maskEmail(account.email)}:`,
    initAuth: () => {
      const credentials = getAccountCredentials(account.id);
      if (!credentials) {
        throw new Error(`Account ${account.id} credentials not found`);
      }
      return initPlaywrightForAccount(
        credentials,
        config.playwright.headless,
        config.playwright.browser,
      );
    },
    disableNativeTools,
    warmQwenChatPool,
  });
}

async function prepareRemainingAccountsInBackground(params: {
  accounts: QwenAccount[];
  batchSize: number;
  getAccountCredentials: (accountId: string) => QwenAccount | undefined;
  initPlaywrightForAccount: (
    account: QwenAccount,
    headless: boolean,
    browserType?: "chromium" | "chrome" | "edge",
  ) => Promise<void>;
  disableNativeTools: (accountId?: string) => Promise<void>;
  warmQwenChatPool: (
    accountId: string | undefined,
    modelId: string,
  ) => Promise<void>;
}): Promise<void> {
  const remaining = params.accounts;
  if (remaining.length === 0) return;

  console.log(
    `🔄 [Server] Preparing ${remaining.length} additional account(s) in background...`,
  );

  let ready = 0;
  for (let i = 0; i < remaining.length; i += params.batchSize) {
    const batch = remaining.slice(i, i + params.batchSize);
    const results = await Promise.all(
      batch.map((account) =>
        prepareAccountRuntime(
          account,
          params.getAccountCredentials,
          params.initPlaywrightForAccount,
          params.disableNativeTools,
          params.warmQwenChatPool,
        ),
      ),
    );
    ready += results.filter(Boolean).length;
  }

  console.log(
    `✅ [Server] Background preparation complete: ${ready}/${remaining.length} ready`,
  );
}

async function cleanupServerResources(): Promise<void> {
  const { stopSessionKeeper } = await import("../services/session-keeper.ts");
  await stopSessionKeeper();
  const pendingAccountPreparation = accountPreparationPromise;
  if (pendingAccountPreparation) {
    await pendingAccountPreparation;
  }

  watchdog?.stop();
  watchdog = undefined;
  metrics.stopCollection();

  try {
    await cache?.close();
  } finally {
    cache = undefined;
  }

  if (config.qwen.deleteAllChatsOnShutdown) {
    try {
      const { deleteChatsForConfiguredAccounts } =
        await import("../services/chat-cleanup.ts");
      const result = await deleteChatsForConfiguredAccounts();
      console.log(
        `🗑️  [Server] Deleted Qwen chats on shutdown: ${result.succeeded}/${result.attempted} scope(s)`,
      );
    } catch (error) {
      console.error(
        `❌ [Server] Failed to delete Qwen chats on shutdown:`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  const { closeAllPlaywright } = await import("../services/playwright.ts");
  await closeAllPlaywright();

  const { closeDatabase } = await import("../core/database.ts");
  closeDatabase();

  const activeServer = server;
  server = undefined;
  if (activeServer?.close) {
    await new Promise<void>((resolve) => {
      try {
        if (activeServer.close.length > 0) {
          activeServer.close(() => resolve());
        } else {
          activeServer.close();
          resolve();
        }
      } catch {
        resolve();
      }
    });
  }
}

async function handleSignal(signal: string): Promise<never> {
  console.log(`🛑 [Server] Shutdown | ${signal}`);
  await stopServer();
  process.exit(0);
}

function installSignalHandlers(): void {
  if (signalHandlersInstalled) return;
  process.on("SIGINT", () => {
    void handleSignal("SIGINT");
  });
  process.on("SIGTERM", () => {
    void handleSignal("SIGTERM");
  });
  signalHandlersInstalled = true;
}

export async function stopServer(): Promise<void> {
  if (stopPromise) {
    await stopPromise;
    return;
  }

  stopPromise = (async () => {
    if (!server && !cache && !watchdog) return;
    await cleanupServerResources();
  })();

  try {
    await stopPromise;
  } finally {
    stopPromise = null;
  }
}

export async function startServer(options?: {
  installSignalHandlers?: boolean;
}): Promise<StartedServerInfo> {
  if (server) {
    if (options?.installSignalHandlers !== false) installSignalHandlers();
    return buildStartedServerInfo();
  }

  if (startPromise) {
    return startPromise;
  }

  startPromise = (async () => {
    cache = new MemoryCache();
    await cache.connect();

    assertExposureCredentials({
      host: config.server.host,
      apiKey: process.env.API_KEY || config.apiKey,
      adminToken: process.env.ADMIN_TOKEN,
    });

    const { loadAccounts, getAccountCredentials } =
      await import("../core/accounts.ts");
    const accounts = loadAccounts();

    const { clearAccountCooldown } = await import("../core/account-manager.ts");
    const now = Date.now();
    const { expiredCooldownAccounts, availableAccounts } =
      classifyStartupAccounts(accounts, now);
    for (const account of expiredCooldownAccounts) {
      clearAccountCooldown(account.id);
    }
    if (expiredCooldownAccounts.length > 0) {
      console.log(
        `🧹 [Server] Cleared expired cooldowns for ${expiredCooldownAccounts.length} account(s)`,
      );
    }
    const { disableNativeTools, warmQwenChatPool } =
      await import("../services/qwen.ts");
    const { initPlaywrightForAccount, getActivePlaywrightAccountIds } =
      await import("../services/playwright.ts");

    const BATCH_SIZE = config.playwright.initBatchSize;

    if (availableAccounts.length > 0) {
      const preparationPromise = (async () => {
        console.log(`🔐 [Server] Preparing first available Qwen account...`);
        let readyAccountIndex = -1;
        for (let i = 0; i < availableAccounts.length; i++) {
          const ok = await prepareAccountRuntime(
            availableAccounts[i],
            getAccountCredentials,
            initPlaywrightForAccount,
            disableNativeTools,
            warmQwenChatPool,
          );
          if (ok) {
            readyAccountIndex = i;
            break;
          }
        }

        const remainingAccounts = availableAccounts.filter(
          (_account, index) => index !== readyAccountIndex,
        );
        if (readyAccountIndex === -1) {
          console.warn(
            `⚠️  [Server] No account ready during startup; continuing in background`,
          );
        }
        if (process.env.PREPARE_ALL_ON_STARTUP === "true") {
          await prepareRemainingAccountsInBackground({
            accounts: remainingAccounts,
            batchSize: BATCH_SIZE,
            getAccountCredentials,
            initPlaywrightForAccount,
            disableNativeTools,
            warmQwenChatPool,
          });
        } else {
          console.log(
            `⏭️  [Server] Background account preparation disabled; accounts will init on first request.`,
          );
        }
      })().catch((error) => {
        console.warn(
          `❌ [Server] Initial account preparation failed: ${getErrorMessage(error)}`,
        );
      });
      accountPreparationPromise = preparationPromise;
      void preparationPromise.finally(() => {
        if (accountPreparationPromise === preparationPromise) {
          accountPreparationPromise = null;
        }
      });
    } else if (accounts.length > 0) {
      console.warn(
        `⚠️  [Server] All Qwen accounts are on cooldown; skipping startup preparation.`,
      );
    } else {
      console.warn(
        `⚠️  [Server] No Qwen accounts configured. Add accounts with npm run login before sending requests.`,
      );
    }

    watchdog = new Watchdog();
    watchdog.start();

    metrics.startCollection();

    const { startSessionKeeper } =
      await import("../services/session-keeper.ts");
    startSessionKeeper({
      prepareMissingAccounts: process.env.PREPARE_ALL_ON_STARTUP === "true"
        ? async () => {
            await accountPreparationPromise;
            const activeIds = new Set(getActivePlaywrightAccountIds());
            const { availableAccounts: currentAccounts } = classifyStartupAccounts(loadAccounts());
            await prepareRemainingAccountsInBackground({
              accounts: currentAccounts.filter((account) => !activeIds.has(account.id)),
              batchSize: BATCH_SIZE,
              getAccountCredentials,
              initPlaywrightForAccount,
              disableNativeTools,
              warmQwenChatPool,
            });
          }
        : undefined,
    });

    server = serve({
      fetch: app.fetch,
      port: config.server.port,
      hostname: config.server.host,
    });

    if (options?.installSignalHandlers !== false) {
      installSignalHandlers();
    }

    const started = buildStartedServerInfo();
    console.log(`\n🚀✨ [Server] Listening on ${started.url}/v1 ✨🚀\n`);
    return started;
  })();

  try {
    return await startPromise;
  } catch (error) {
    await cleanupServerResources().catch(() => {});
    throw error;
  } finally {
    startPromise = null;
  }
}

export { app };
