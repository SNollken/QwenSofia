/**
 * Copyright (c) 2025 johngbl
 * QwenSofia - OpenAI-compatible proxy for Qwen
 */

export class Mutex {
  private queue: Array<() => void> = [];
  private locked = false;

  async acquire(
    timeoutMs = 300_000,
    signal?: AbortSignal,
  ): Promise<() => void> {
    signal?.throwIfAborted();

    if (!this.locked) {
      this.locked = true;
      return this.createRelease();
    }

    return new Promise<() => void>((resolve, reject) => {
      let settled = false;
      const removeWaiter = () => {
        const index = this.queue.indexOf(waiter);
        if (index !== -1) this.queue.splice(index, 1);
      };
      const cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
      };
      const waiter = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(this.createRelease());
      };
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        removeWaiter();
        cleanup();
        reject(new Error(`Mutex acquire timeout after ${timeoutMs}ms`));
      }, timeoutMs);
      const onAbort = () => {
        if (settled) return;
        settled = true;
        removeWaiter();
        cleanup();
        reject(
          signal?.reason ?? new DOMException("The operation was aborted", "AbortError"),
        );
      };
      timer.unref?.();
      this.queue.push(waiter);
      signal?.addEventListener("abort", onAbort, { once: true });

      if (signal?.aborted) onAbort();
    });
  }

  async withLock<T>(
    fn: () => Promise<T> | T,
    timeoutMs?: number,
    signal?: AbortSignal,
  ): Promise<T> {
    const release = await this.acquire(timeoutMs, signal);
    try {
      return await fn();
    } finally {
      release();
    }
  }

  private createRelease(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.release();
    };
  }

  private release(): void {
    const next = this.queue.shift();
    if (next) {
      next();
      return;
    }

    this.locked = false;
  }

  /** Returns true if the mutex is not locked and has no waiting queue. */
  isIdle(): boolean {
    return !this.locked && this.queue.length === 0;
  }
}
