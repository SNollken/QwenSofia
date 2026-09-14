import { config } from "./config.ts";

interface AccountUsage {
  active: number;
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
    state = { active: 0, waiting: [] };
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
    peakActivePerAccount = Math.max(peakActivePerAccount, accountState.active);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      accountState.active--;
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
