import { config } from "./config.ts";

interface AccountUsage {
  active: number;
  starts: number[];
  waiting: Array<() => void>;
}

const usage = new Map<string, AccountUsage>();
let peakActivePerAccount = 0;

export class AccountCapacityError extends Error {
  readonly upstreamStatus = 503;

  constructor() {
    super("Account request queue timed out. Retry when a request slot is free.");
    this.name = "AccountCapacityError";
  }
}

export function getAccountRequestCount(accountId: string): number {
  return usage.get(accountId)?.active ?? 0;
}

export function getAccountConcurrencyStats() {
  const accounts = Array.from(usage, ([accountId, item]) => ({
    accountId,
    activeRequests: item.active,
    queuedRequests: item.waiting.length,
  }));
  return {
    limitPerAccount: config.accountRequests.maxConcurrent,
    activeRequests: accounts.reduce((sum, item) => sum + item.activeRequests, 0),
    queuedRequests: accounts.reduce((sum, item) => sum + item.queuedRequests, 0),
    peakActivePerAccount,
    accounts,
  };
}

export async function acquireAccountRequestSlot(
  accountId: string,
  signal?: AbortSignal,
  timeoutMs = config.accountRequests.queueTimeoutMs,
): Promise<() => void> {
  signal?.throwIfAborted();
  let state = usage.get(accountId);
  if (!state) {
    state = { active: 0, starts: [], waiting: [] };
    usage.set(accountId, state);
  }
  const accountState = state;
  const prune = () => {
    if (accountState.active === 0 && accountState.waiting.length === 0) {
      usage.delete(accountId);
    }
  };
  const grant = (): (() => void) => {
    accountState.active++;
    const now = Date.now();
    accountState.starts.push(now);
    peakActivePerAccount = Math.max(peakActivePerAccount, accountState.active);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const idx = accountState.starts.indexOf(now);
      if (idx === -1) return;
      accountState.starts.splice(idx, 1);
      accountState.active = Math.max(0, accountState.active - 1);
      accountState.waiting.shift()?.();
      prune();
    };
  };

  if (accountState.active < config.accountRequests.maxConcurrent) {
    return grant();
  }

  return new Promise<() => void>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    };
    const remove = () => {
      const index = accountState.waiting.indexOf(waiter);
      if (index !== -1) accountState.waiting.splice(index, 1);
      cleanup();
      prune();
    };
    const waiter = () => {
      cleanup();
      resolve(grant());
    };
    const abort = () => {
      remove();
      reject(signal?.reason ?? new DOMException("Client disconnected", "AbortError"));
    };
    const timer = setTimeout(() => {
      remove();
      reject(new AccountCapacityError());
    }, timeoutMs);
    timer.unref?.();
    accountState.waiting.push(waiter);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
}

export function sweepStaleAccountSlots(
  now = Date.now(),
  maxAgeMs = 15 * 60 * 1000,
): number {
  let swept = 0;
  for (const [accountId, state] of usage.entries()) {
    const alive: number[] = [];
    let dropped = 0;
    for (const ts of state.starts) {
      if (now - ts <= maxAgeMs) {
        alive.push(ts);
      } else {
        dropped++;
      }
    }
    if (dropped > 0) {
      state.starts = alive;
      state.active = Math.max(0, state.active - dropped);
      swept += dropped;
      console.warn(
        `[AccountConcurrency] Force-released ${dropped} stale slot(s) for account ${accountId} (held > ${Math.round(maxAgeMs / 1000)}s)`,
      );
      for (let i = 0; i < dropped; i++) {
        state.waiting.shift()?.();
      }
      if (state.active === 0 && state.waiting.length === 0) {
        usage.delete(accountId);
      }
    }
  }
  return swept;
}

if (typeof setInterval !== "undefined") {
  const sweepTimer = setInterval(() => {
    try {
      sweepStaleAccountSlots();
    } catch (err: any) {
      console.warn("[AccountConcurrency] Stale slot sweep error:", err?.message);
    }
  }, 60_000);
  sweepTimer.unref?.();
}

