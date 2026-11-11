import * as database from "./database.ts";

/**
 * Tracks which models are out of quota for which account.
 *
 * Qwen enforces a daily limit per model: once an account exhausts
 * "Qwen3.8-Max" it can still serve every other model. Blocking the whole
 * account would throw away a perfectly usable account, so the limit is
 * recorded per (account, model) pair instead.
 *
 * The state is persisted so a proxy restart does not immediately re-pick an
 * account that is known to be out of quota.
 */

export interface ModelLimitEntry {
  accountId: string;
  model: string;
  until: number;
  reason: string;
  updatedAt: number;
}

type PersistedModelLimitRow = {
  account_id: string;
  model: string;
  until: number;
  reason: string;
  updated_at: number;
};

/**
 * Persistence contract implemented by database.ts. Kept optional because the
 * store is best-effort: a missing or failing implementation must never break
 * account selection.
 */
interface ModelLimitStore {
  listPersistedModelLimits(): PersistedModelLimitRow[];
  upsertModelLimit(entry: {
    accountId: string;
    model: string;
    until: number;
    reason: string;
    updatedAt: number;
  }): void;
  deleteModelLimit(accountId: string, model: string): void;
  deleteModelLimitsForAccount(accountId: string): void;
}

const store = database as unknown as Partial<ModelLimitStore>;

const modelLimits = new Map<string, ModelLimitEntry>();

const KEY_SEPARATOR = "::";

function limitKey(accountId: string, model: string): string {
  return `${accountId}${KEY_SEPARATOR}${model}`;
}

/** Normalizes a model id so "qwen3.8-max" and "Qwen3.8-Max" share a limit. */
export function normalizeModelId(model: string): string {
  return (model || "")
    .trim()
    .toLowerCase()
    .replace(/-no-thinking$/, "");
}

/** Persistence is optional: never let a database failure break selection. */
function safe(run: () => void): void {
  try {
    run();
  } catch {
    /* persistence is optional */
  }
}

/**
 * Records that an account cannot use a model for `durationMs`.
 * An already longer limit is kept: limits only ever extend.
 */
export function markAccountModelLimited(
  accountId: string,
  model: string,
  durationMs: number,
  reason = "MembershipLimit",
): void {
  const normalized = normalizeModelId(model);
  if (!accountId || !normalized) return;
  const now = Date.now();
  const until = Math.max(
    getModelLimit(accountId, normalized)?.until ?? 0,
    now + Math.max(0, durationMs),
  );
  const entry: ModelLimitEntry = {
    accountId,
    model: normalized,
    until,
    reason,
    updatedAt: now,
  };
  modelLimits.set(limitKey(accountId, normalized), entry);
  safe(() => store.upsertModelLimit?.(entry));
}

/** Returns the active limit entry for the account/model pair, if any. */
export function getModelLimit(
  accountId: string,
  model: string,
): ModelLimitEntry | null {
  const normalized = normalizeModelId(model);
  if (!accountId || !normalized) return null;
  const key = limitKey(accountId, normalized);
  const entry = modelLimits.get(key);
  if (!entry) return null;
  if (entry.until <= Date.now()) {
    modelLimits.delete(key);
    safe(() => store.deleteModelLimit?.(entry.accountId, normalized));
    return null;
  }
  return entry;
}

/** True when the account is known to be out of quota for the model. */
export function isAccountModelLimited(accountId: string, model: string): boolean {
  return getModelLimit(accountId, model) !== null;
}

/** Milliseconds until the model becomes usable again, or 0 when it is usable. */
export function getModelLimitRemainingMs(accountId: string, model: string): number {
  const entry = getModelLimit(accountId, model);
  if (!entry) return 0;
  return Math.max(0, entry.until - Date.now());
}

/** Clears the limit for one account/model pair. */
export function clearAccountModelLimit(accountId: string, model: string): void {
  const normalized = normalizeModelId(model);
  if (!accountId || !normalized) return;
  modelLimits.delete(limitKey(accountId, normalized));
  safe(() => store.deleteModelLimit?.(accountId, normalized));
}

/** Clears every model limit for an account, or for every account when omitted. */
export function clearAllAccountModelLimits(accountId?: string): void {
  for (const [key, entry] of [...modelLimits]) {
    if (!accountId || entry.accountId === accountId) {
      modelLimits.delete(key);
    }
  }
  if (accountId) {
    safe(() => store.deleteModelLimitsForAccount?.(accountId));
    return;
  }
  safe(() => {
    for (const row of store.listPersistedModelLimits?.() ?? []) {
      store.deleteModelLimit?.(row.account_id, row.model);
    }
  });
}

/** Snapshot of the active limits, for the admin dashboard. */
export function listModelLimits(model?: string): ModelLimitEntry[] {
  const now = Date.now();
  const wanted = model === undefined ? null : normalizeModelId(model);
  const out: ModelLimitEntry[] = [];
  for (const [key, entry] of [...modelLimits]) {
    if (entry.until <= now) {
      modelLimits.delete(key);
      continue;
    }
    if (wanted !== null && entry.model !== wanted) continue;
    out.push(entry);
  }
  return out;
}

/** Loads persisted limits into memory on startup. */
export function loadModelLimits(): void {
  safe(() => {
    for (const row of store.listPersistedModelLimits?.() ?? []) {
      if (row.until <= Date.now()) continue;
      const model = normalizeModelId(row.model);
      if (!model) continue;
      modelLimits.set(limitKey(row.account_id, model), {
        accountId: row.account_id,
        model,
        until: row.until,
        reason: row.reason,
        updatedAt: row.updated_at,
      });
    }
  });
}
