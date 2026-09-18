import { config } from "../core/config.ts";
import { getAccountCredentials, loadAccounts } from "../core/accounts.ts";
import {
  getAccountCooldownInfo,
  getCooldownStatus,
} from "../core/account-manager.ts";
import {
  getRegistrationJob,
  startRegistration,
  type RegistrationJob,
} from "./account-registration.ts";
import {
  accountHasCapturedHeaders,
  ensureAccountHeaders,
  initPlaywrightForAccount,
} from "./playwright.ts";
import { maskEmail } from "../core/logger.ts";

export type AutoCreateTrigger =
  | "manual"
  | "rate-limit"
  | "all-cooldown"
  | "no-accounts";

export function isAccountCreationAllowed(trigger: AutoCreateTrigger): boolean {
  return trigger === "manual" || config.accountCreator.enabled;
}

export interface AutoCreateStatus {
  enabled: boolean;
  busy: boolean;
  trigger: AutoCreateTrigger | null;
  lastRunAt: number | null;
  lastError: string | null;
  lastAccountId: string | null;
  lastEmail: string | null;
  cooldownRemainingMs: number;
  activeJob: RegistrationJob | null;
  message: string;
}

interface AutoCreateResult {
  started: boolean;
  accountId?: string;
  email?: string;
  jobId?: string;
  ready?: boolean;
  error?: string;
  skippedReason?: string;
}

let busy = false;
let activeJobId: string | null = null;
let lastRunAt = 0;
let lastError: string | null = null;
let lastAccountId: string | null = null;
let lastEmail: string | null = null;
let lastTrigger: AutoCreateTrigger | null = null;
let lastMessage = "Pronto para criar contas.";
let pendingWaiters: Array<{
  resolve: (result: AutoCreateResult) => void;
}> = [];

function cooldownRemainingMs(): number {
  const cooldown = config.accountCreator.cooldownMs;
  if (!lastRunAt || cooldown <= 0) return 0;
  return Math.max(0, lastRunAt + cooldown - Date.now());
}

function setMessage(message: string): void {
  lastMessage = message;
}

export function getAutoCreateStatus(): AutoCreateStatus {
  const job = activeJobId ? getRegistrationJob(activeJobId) : undefined;
  return {
    enabled: config.accountCreator.enabled,
    busy,
    trigger: lastTrigger,
    lastRunAt: lastRunAt || null,
    lastError,
    lastAccountId,
    lastEmail,
    cooldownRemainingMs: cooldownRemainingMs(),
    activeJob: job ?? null,
    message: lastMessage,
  };
}

export function areAllAccountsUnavailable(): boolean {
  const accounts = loadAccounts();
  if (accounts.length === 0) return true;
  return accounts.every((account) => getAccountCooldownInfo(account.id) !== null);
}

export function countAvailableAccounts(): number {
  return loadAccounts().filter(
    (account) => getAccountCooldownInfo(account.id) === null,
  ).length;
}

async function waitForReadyJob(
  jobId: string,
  timeoutMs: number,
): Promise<RegistrationJob> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const job = getRegistrationJob(jobId);
    if (!job) throw new Error("Job de cadastro sumiu do runtime.");
    if (job.state === "completed" && job.ready && job.accountId) return job;
    if (job.state === "completed" && !job.ready) {
      throw new Error(
        "Cadastro terminou sem marcar a conta como pronta (auth incompleta).",
      );
    }
    if (job.state === "failed") {
      throw new Error(job.error || job.message || "Falha ao criar conta.");
    }
    setMessage(job.message || `Estado: ${job.state}`);
    await new Promise((resolve) => setTimeout(resolve, 1_500));
  }
  throw new Error(
    `Timeout de ${Math.round(timeoutMs / 1000)}s aguardando conta pronta.`,
  );
}

async function ensurePoolAuth(accountId: string): Promise<void> {
  const credentials = getAccountCredentials(accountId);
  if (!credentials) {
    throw new Error(`Conta ${accountId} não encontrada após o cadastro.`);
  }
  setMessage(`Validando pool auth: ${maskEmail(credentials.email)}…`);
  await initPlaywrightForAccount(credentials, config.playwright.headless);
  let ok = accountHasCapturedHeaders(accountId);
  if (!ok) ok = await ensureAccountHeaders(accountId, true);
  if (!ok) {
    throw new Error(
      `Headers bx-ua não capturados para ${maskEmail(credentials.email)}`,
    );
  }
}

function resolveWaiters(result: AutoCreateResult): void {
  const waiters = pendingWaiters;
  pendingWaiters = [];
  for (const waiter of waiters) waiter.resolve(result);
}

async function runAutoCreate(
  trigger: AutoCreateTrigger,
  count = 1,
): Promise<AutoCreateResult> {
  if (!isAccountCreationAllowed(trigger)) {
    return {
      started: false,
      skippedReason: "Criação automática de contas desativada.",
    };
  }

  if (busy) {
    return new Promise((resolve) => {
      pendingWaiters.push({ resolve });
    });
  }

  const remaining = cooldownRemainingMs();
  if (remaining > 0 && trigger !== "manual") {
    return {
      started: false,
      skippedReason: `Cooldown de criação ativo por mais ${Math.ceil(remaining / 1000)}s.`,
    };
  }

  busy = true;
  lastTrigger = trigger;
  lastError = null;
  lastRunAt = Date.now();
  setMessage(`Iniciando criação automática completa (trigger=${trigger})…`);

  let result: AutoCreateResult = { started: true };
  try {
    const total = Math.max(1, Math.min(count, config.accountCreator.maxBatch));
    let createdAccountId: string | undefined;
    let createdEmail: string | undefined;
    let lastJobId: string | undefined;

    for (let i = 0; i < total; i++) {
      setMessage(
        `Criando conta pronta ${i + 1}/${total} (temp-mail + captcha + auth)…`,
      );

      // Empty email => temp mailbox + full verification pipeline
      const job = startRegistration({
        useTempEmail: true,
      });
      activeJobId = job.id;
      lastJobId = job.id;

      const completed = await waitForReadyJob(
        job.id,
        config.accountCreator.timeoutMs,
      );
      if (!completed.accountId || !completed.ready) {
        throw new Error("Cadastro não produziu conta pronta.");
      }

      // Double-check pool headers
      await ensurePoolAuth(completed.accountId);

      createdAccountId = completed.accountId;
      createdEmail = completed.email;
      lastAccountId = completed.accountId;
      lastEmail = completed.email;
      setMessage(
        `Conta PRONTA: ${maskEmail(completed.email)} (${completed.accountId})`,
      );
      console.log(
        `✅ [AutoCreator] Conta pronta | trigger=${trigger} | ${maskEmail(completed.email)} | id=${completed.accountId}`,
      );
    }

    result = {
      started: true,
      accountId: createdAccountId,
      email: createdEmail,
      jobId: lastJobId,
      ready: true,
    };
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    lastError = message;
    setMessage(`Falha na criação automática: ${message}`);
    console.error(`❌ [AutoCreator] ${message}`);
    result = {
      started: true,
      error: message,
      jobId: activeJobId ?? undefined,
      ready: false,
    };
    return result;
  } finally {
    busy = false;
    activeJobId = null;
    resolveWaiters(result);
  }
}

export async function ensureAccountForRateLimit(
  trigger: AutoCreateTrigger = "rate-limit",
): Promise<AutoCreateResult> {
  if (!config.accountCreator.enabled) {
    return {
      started: false,
      skippedReason: "Criação automática de contas desativada.",
    };
  }

  if (!areAllAccountsUnavailable() && trigger !== "manual") {
    return {
      started: false,
      skippedReason: "Ainda há contas disponíveis no pool.",
    };
  }

  console.warn(
    `⚠️  [AutoCreator] Pool sem contas utilizáveis | trigger=${trigger} | cooldowns=${JSON.stringify(getCooldownStatus())}`,
  );
  return runAutoCreate(trigger, 1);
}

export async function createAccountsManually(
  count = 1,
): Promise<AutoCreateResult> {
  return runAutoCreate("manual", count);
}

export function scheduleEnsureAccountForRateLimit(
  trigger: AutoCreateTrigger = "rate-limit",
): void {
  if (!config.accountCreator.enabled) return;
  if (busy) return;
  if (!areAllAccountsUnavailable() && trigger !== "manual") return;
  void ensureAccountForRateLimit(trigger).catch((err) => {
    console.error(
      `❌ [AutoCreator] schedule failed:`,
      err instanceof Error ? err.message : String(err),
    );
  });
}
