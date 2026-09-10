import { Hono } from "hono";
import fs from "node:fs";
import path from "node:path";
import {
  addAccount,
  getAccountCredentials,
  listAccounts,
  removeAccount,
} from "../core/accounts.ts";
import { getCooldownStatus } from "../core/account-manager.ts";
import { config, setAccountMaxConcurrent } from "../core/config.ts";
import {
  accountHasCapturedHeaders,
  closePlaywrightForAccount,
  getActivePlaywrightAccountIds,
  getPlaywrightStatus,
  initPlaywrightForAccount,
} from "../services/playwright.ts";
import {
  getRegistrationJob,
  listRegistrationJobs,
  startRegistration,
} from "../services/account-registration.ts";
import {
  createAccountsManually,
  getAutoCreateStatus,
} from "../services/auto-account-creator.ts";

export const adminApp = new Hono();

export function isAccountAuthenticated(
  accountId: string,
  activeAccountIds: ReadonlySet<string>,
): boolean {
  return activeAccountIds.has(accountId);
}

function accountView() {
  const active = new Set(getActivePlaywrightAccountIds());
  const runtime = getPlaywrightStatus();
  const cooldowns = getCooldownStatus();
  return listAccounts().map((account) => ({
    id: account.id,
    email: account.email,
    authenticated: isAccountAuthenticated(account.id, active),
    runtime: runtime[account.id] ?? null,
    cooldown: cooldowns[account.id] ?? null,
  }));
}

adminApp.get("/api/admin/overview", (c) =>
  c.json({
    accounts: accountView(),
    registrations: listRegistrationJobs(),
    autoCreator: getAutoCreateStatus(),
    proxy: { running: true, baseUrl: `${new URL(c.req.url).origin}/v1` },
  }),
);

adminApp.put("/api/admin/account-concurrency", async (c) => {
  const body: { maxConcurrent?: number } = await c.req
    .json<{ maxConcurrent?: number }>()
    .catch(() => ({}));
  try {
    const maxConcurrent = setAccountMaxConcurrent(Number(body.maxConcurrent));
    return c.json({ ok: true, maxConcurrent });
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : String(error) },
      400,
    );
  }
});

adminApp.post("/api/admin/accounts", async (c) => {
  const body = await c.req.json<{
    email?: string;
    password?: string;
    authenticate?: boolean;
  }>();
  if (!body.password) return c.json({ error: "Senha é obrigatória" }, 400);

  const account = addAccount(body.email ?? "", body.password ?? "");
  const shouldAuth =
    body.authenticate !== false && config.accountCreator.autoAuth;

  let authenticated = false;
  let authError: string | undefined;
  if (shouldAuth) {
    try {
      await initPlaywrightForAccount(account, config.playwright.headless);
      authenticated = true;
    } catch (error) {
      authError = error instanceof Error ? error.message : String(error);
      console.warn(
        `⚠️  [Admin] Conta adicionada, mas autenticação automática falhou: ${authError}`,
      );
    }
  }

  return c.json(
    {
      id: account.id,
      email: account.email,
      authenticated,
      ready: authenticated,
      authError,
    },
    201,
  );
});

adminApp.delete("/api/admin/accounts/:id", async (c) => {
  const id = c.req.param("id");
  await closePlaywrightForAccount(id).catch(() => {});
  if (!removeAccount(id)) return c.json({ error: "Conta não encontrada" }, 404);
  const profilesRoot = path.resolve("data", "qwen_profiles");
  const profilePath = path.resolve(profilesRoot, id);
  if (profilePath.startsWith(`${profilesRoot}${path.sep}`)) {
    await fs.promises
      .rm(profilePath, { recursive: true, force: true })
      .catch(() => {});
  }
  return c.json({ ok: true });
});

adminApp.post("/api/admin/accounts/:id/authenticate", async (c) => {
  const account = getAccountCredentials(c.req.param("id"));
  if (!account) return c.json({ error: "Conta não encontrada" }, 404);
  await closePlaywrightForAccount(account.id).catch(() => {});
  await initPlaywrightForAccount(account, config.playwright.headless);
  const hasHeaders = accountHasCapturedHeaders(account.id);
  return c.json({ ok: true, authenticated: true, ready: true, hasHeaders });
});

adminApp.post("/api/admin/registrations", async (c) => {
  const body = await c.req.json<{
    email?: string;
    password?: string;
    displayName?: string;
    useTempEmail?: boolean;
  }>();
  try {
    const hasEmail = Boolean(body.email?.trim());
    return c.json(
      startRegistration({
        email: body.email,
        password: body.password,
        displayName: body.displayName,
        // Explicit user email => no temp mailbox unless forced
        useTempEmail: body.useTempEmail ?? !hasEmail,
      }),
      202,
    );
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : String(error) },
      400,
    );
  }
});

adminApp.get("/api/admin/registrations/:id", (c) => {
  const job = getRegistrationJob(c.req.param("id"));
  return job ? c.json(job) : c.json({ error: "Cadastro não encontrado" }, 404);
});

adminApp.get("/api/admin/account-creator", (c) => c.json(getAutoCreateStatus()));

adminApp.post("/api/admin/account-creator/run", async (c) => {
  const body = await c.req
    .json<{ count?: number }>()
    .catch(() => ({ count: 1 }));
  const count = Math.max(
    1,
    Math.min(config.accountCreator.maxBatch, Number(body.count) || 1),
  );

  const wait = c.req.query("wait") === "1" || c.req.query("wait") === "true";

  if (!wait) {
    void createAccountsManually(count).catch((err) => {
      console.error(
        `❌ [Admin] Manual account creation failed:`,
        err instanceof Error ? err.message : String(err),
      );
    });
    return c.json(
      {
        accepted: true,
        count,
        message: `Criação completa de ${count} conta(s) iniciada (temp-mail + captcha + auth). Só fica pronta ao final.`,
        status: getAutoCreateStatus(),
      },
      202,
    );
  }

  const result = await createAccountsManually(count);
  if (result.error || !result.ready) {
    return c.json(
      {
        ok: false,
        ...result,
        status: getAutoCreateStatus(),
      },
      500,
    );
  }
  return c.json({
    ok: true,
    ...result,
    status: getAutoCreateStatus(),
  });
});
