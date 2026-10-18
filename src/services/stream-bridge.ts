import type { Page } from "playwright";
import crypto from "crypto";
import { config } from "../core/config.ts";
import { logger } from "../core/logger.ts";
import { isAccessVerificationVisible } from "./aliyun-captcha-solver.ts";

const streamCallbacks = new Map<
  string,
  {
    onChunk: (chunk: string) => void;
    onEnd: () => void;
    onError: (msg: string) => void;
    onMeta: (meta: {
      status: number;
      statusText: string;
      contentType: string;
      headers: Record<string, string>;
    }) => void;
    onBody: (body: string) => void;
  }
>();

const abortControllers = new Map<string, () => void>();
const pagesWithExposed = new WeakSet<Page>();

export async function ensureStreamBridge(page: Page): Promise<void> {
  if (pagesWithExposed.has(page)) return;
  pagesWithExposed.add(page);
  try {
    const exposePromise = page.exposeFunction(
      "__streamRelay",
      (reqId: string, type: string, data: any) => {
        const cb = streamCallbacks.get(reqId);
        if (!cb) return;
        switch (type) {
          case "meta":
            cb.onMeta(data);
            break;
          case "chunk":
            cb.onChunk(data);
            break;
          case "end":
            cb.onEnd();
            streamCallbacks.delete(reqId);
            abortControllers.delete(reqId);
            break;
          case "error":
            cb.onError(data);
            streamCallbacks.delete(reqId);
            abortControllers.delete(reqId);
            break;
          case "body":
            cb.onBody(data);
            streamCallbacks.delete(reqId);
            abortControllers.delete(reqId);
            break;
        }
      },
    );
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("exposeFunction timed out")), 2000),
    );
    await Promise.race([exposePromise, timeoutPromise]);
  } catch (err: any) {
    logger.warn("[StreamBridge] ensureStreamBridge exposeFunction non-fatal:", {
      error: err?.message,
    });
  }
}

function startCaptchaWatcher(
  page: Page,
  timeoutMs: number,
  onCaptcha?: (reason: string) => void,
) {
  let finished = false;
  const promise = (async () => {
    const start = Date.now();
    while (!finished && Date.now() - start < timeoutMs) {
      try {
        if (page.isClosed()) break;
        const visible = await isAccessVerificationVisible(page).catch(() => false);
        if (visible) {
          console.warn("[Captcha] Access verification detected on page.");
          onCaptcha?.("FAIL_SYS_USER_VALIDATE");
          break;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 1000));
    }
  })();

  return {
    stop: () => {
      finished = true;
    },
    promise,
  };
}

export async function browserFetch(
  page: Page,
  url: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    timeoutMs?: number;
  } = {},
): Promise<{
  status: number;
  statusText: string;
  contentType: string;
  body: string;
  headers: Record<string, string>;
}> {
  console.log(`[TRACE BF 1] browserFetch for ${url}...`);
  const reqId = crypto.randomUUID();

  const timeoutMs = options.timeoutMs || 10000;
  const watcher = startCaptchaWatcher(page, timeoutMs);

  const doEvaluate = async () => {
    return await page.evaluate(
      async ({ url, options }: any) => {
        const controller = new AbortController();
        const timeoutId = setTimeout(
          () => controller.abort(),
          options.timeoutMs || 10000,
        );
        try {
          const resp = await fetch(url, {
            method: options.method || "POST",
            headers: options.headers || {},
            body: options.body || undefined,
            credentials: "include",
            signal: controller.signal,
          });
          clearTimeout(timeoutId);
          const respHeaders: Record<string, string> = {};
          resp.headers.forEach((v: string, k: string) => {
            respHeaders[k] = v;
          });
          const body = await resp.text();
          return {
            status: resp.status,
            statusText: resp.statusText,
            contentType: resp.headers.get("content-type") || "",
            body,
            headers: respHeaders,
          };
        } catch (e: any) {
          clearTimeout(timeoutId);
          throw new Error(`browserFetch failed: ${e.message}`, { cause: e });
        }
      },
      { url, options, reqId },
    );
  };

  try {
    if (page.isClosed()) throw new Error("Page is closed");
    const result = await doEvaluate();
    console.log(`[TRACE BF 3] page.evaluate finished! status: ${result.status}`);
    return result;
  } catch (err: any) {
    if (
      err.message?.includes("Execution context was destroyed") ||
      err.message?.includes("navigation")
    ) {
      console.log(`[TRACE BF 2.5] Navigation detected, waiting for domcontentloaded to retry...`);
      try {
        await page.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => {});
        if (!page.isClosed()) {
          const result = await doEvaluate();
          console.log(`[TRACE BF 3] retry page.evaluate finished! status: ${result.status}`);
          return result;
        }
      } catch (retryErr: any) {
        throw new Error(`browserFetch context lost: ${retryErr.message}`, {
          cause: retryErr,
        });
      }
    }
    if (
      err.message?.includes("Execution context was destroyed") ||
      err.message?.includes("Target closed") ||
      err.message?.includes("Page is closed")
    ) {
      throw new Error(`browserFetch context lost: ${err.message}`, {
        cause: err,
      });
    }
    throw err;
  } finally {
    watcher.stop();
  }
}

export async function browserStreamFetch(
  page: Page,
  url: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    timeoutMs?: number;
  } = {},
): Promise<{
  status: number;
  statusText: string;
  contentType: string;
  headers: Record<string, string>;
  stream: ReadableStream<Uint8Array>;
  body: string;
  reqId: string;
  abort: () => void;
}> {
  await ensureStreamBridge(page);
  const reqId = crypto.randomUUID();
  const enc = new TextEncoder();

  let metaResolve!: (value: {
    status: number;
    statusText: string;
    contentType: string;
    headers: Record<string, string>;
  }) => void;
  let metaReject!: (reason: Error) => void;
  const metaPromise = new Promise<{
    status: number;
    statusText: string;
    contentType: string;
    headers: Record<string, string>;
  }>((resolve, reject) => {
    metaResolve = resolve;
    metaReject = reject;
  });

  const metaTimeoutMs = options.timeoutMs || config.timeouts.chat;
  const metaTimeout = setTimeout(() => {
    streamCallbacks.delete(reqId);
    abortControllers.delete(reqId);
    metaReject(
      new Error(
        `Browser stream fetch timed out waiting for response metadata after ${metaTimeoutMs}ms`,
      ),
    );
  }, metaTimeoutMs);

  streamCallbacks.set(reqId, {
    onMeta: (meta) => {
      clearTimeout(metaTimeout);
      metaResolve(meta);
    },
    onChunk: () => {},
    onEnd: () => {},
    onError: (msg: string) => {
      clearTimeout(metaTimeout);
      metaReject(new Error(msg));
    },
    onBody: () => {},
  });

  let bodyResolve!: (value: string) => void;
  let bodyReject!: (reason: Error) => void;
  const bodyPromise = new Promise<string>((resolve, reject) => {
    bodyResolve = resolve;
    bodyReject = reject;
  });
  bodyPromise.catch(() => {});

  const watcher = startCaptchaWatcher(page, metaTimeoutMs, (reason) => {
    const cb = streamCallbacks.get(reqId);
    if (cb) {
      cb.onError(`Qwen anti-bot challenge: ${reason}`);
    }
  });

  try {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const cb = streamCallbacks.get(reqId);
        if (!cb) return;
        cb.onChunk = (chunk: string) => {
          try {
            controller.enqueue(enc.encode(chunk));
          } catch {
            /* ignore */
          }
        };
        cb.onEnd = () => {
          try {
            controller.close();
          } catch {
            /* ignore */
          }
          bodyResolve("");
          streamCallbacks.delete(reqId);
          abortControllers.delete(reqId);
        };
        cb.onError = (msg: string) => {
          try {
            controller.error(new Error(msg));
          } catch {
            /* ignore */
          }
          bodyReject(new Error(msg));
          streamCallbacks.delete(reqId);
          abortControllers.delete(reqId);
        };
        cb.onBody = (text: string) => {
          bodyResolve(text);
          streamCallbacks.delete(reqId);
          abortControllers.delete(reqId);
        };

        page
          .evaluate(
            async ({ url, options, reqId, evalTimeoutMs }: any) => {
              const controller = new AbortController();
              (window as any).__abortControllers =
                (window as any).__abortControllers || {};
              (window as any).__abortControllers[reqId] = controller;
              const timeoutId = setTimeout(
                () => controller.abort(),
                options.timeoutMs || evalTimeoutMs,
              );
              try {
                const resp = await fetch(url, {
                  method: options.method || "POST",
                  headers: options.headers || {},
                  body: options.body || undefined,
                  credentials: "include",
                  signal: controller.signal,
                });
                clearTimeout(timeoutId);
                const respHeaders: Record<string, string> = {};
                resp.headers.forEach((v: string, k: string) => {
                  respHeaders[k] = v;
                });
                (window as any).__streamRelay(reqId, "meta", {
                  status: resp.status,
                  statusText: resp.statusText,
                  contentType: resp.headers.get("content-type") || "",
                  headers: respHeaders,
                });

                const responseContentType =
                  resp.headers.get("content-type") || "";
                if (
                  !resp.ok ||
                  !resp.body ||
                  !responseContentType.includes("text/event-stream")
                ) {
                  const bodyText = await resp.text().catch(() => "");
                  (window as any).__streamRelay(reqId, "body", bodyText);
                  delete (window as any).__abortControllers[reqId];
                  return;
                }

                const reader = resp.body.getReader();
                const decoder = new TextDecoder();
                const FLUSH_BYTES = 512;
                const FLUSH_INTERVAL_MS = 8;
                let pending = "";
                let flushTimer: any = null;
                let firstChunkSent = false;
                try {
                  while (true) {
                    const { done, value } = await reader.read();
                    if (done) {
                      if (flushTimer) {
                        clearTimeout(flushTimer);
                        flushTimer = null;
                      }
                      if (pending) {
                        (window as any).__streamRelay(reqId, "chunk", pending);
                        pending = "";
                      }
                      (window as any).__streamRelay(reqId, "end", null);
                      break;
                    }
                    pending += decoder.decode(value, { stream: true });
                    if (!firstChunkSent) {
                      if (flushTimer) {
                        clearTimeout(flushTimer);
                        flushTimer = null;
                      }
                      (window as any).__streamRelay(reqId, "chunk", pending);
                      pending = "";
                      firstChunkSent = true;
                    } else if (pending.length >= FLUSH_BYTES) {
                      if (flushTimer) {
                        clearTimeout(flushTimer);
                        flushTimer = null;
                      }
                      (window as any).__streamRelay(reqId, "chunk", pending);
                      pending = "";
                    } else if (!flushTimer) {
                      flushTimer = setTimeout(() => {
                        flushTimer = null;
                        if (pending) {
                          (window as any).__streamRelay(
                            reqId,
                            "chunk",
                            pending,
                          );
                          pending = "";
                        }
                      }, FLUSH_INTERVAL_MS);
                    }
                  }
                } finally {
                  if (flushTimer) {
                    clearTimeout(flushTimer);
                    flushTimer = null;
                  }
                }
                delete (window as any).__abortControllers[reqId];
              } catch (e: any) {
                clearTimeout(timeoutId);
                (window as any).__streamRelay(reqId, "error", e.message);
                delete (window as any).__abortControllers[reqId];
              }
            },
            { url, options, reqId, evalTimeoutMs: metaTimeoutMs },
          )
          .catch((e: any) => {
            const cb = streamCallbacks.get(reqId);
            if (cb) {
              cb.onError(e.message);
            }
          });
      },
      cancel() {
        page
          .evaluate((reqId: string) => {
            const c = (window as any).__abortControllers?.[reqId];
            if (c) {
              c.abort();
              delete (window as any).__abortControllers[reqId];
            }
          }, reqId)
          .catch(() => {});
        streamCallbacks.delete(reqId);
        abortControllers.delete(reqId);
      },
    });

    const meta = await metaPromise;

    const abortFn = () => {
      page
        .evaluate((reqId: string) => {
          const c = (window as any).__abortControllers?.[reqId];
          if (c) {
            c.abort();
            delete (window as any).__abortControllers[reqId];
          }
        }, reqId)
        .catch(() => {});
      streamCallbacks.delete(reqId);
      abortControllers.delete(reqId);
    };

    abortControllers.set(reqId, abortFn);

    return {
      ...meta,
      stream,
      body: meta.contentType.includes("text/event-stream")
        ? ""
        : await bodyPromise,
      reqId,
      abort: abortFn,
    };
  } finally {
    watcher.stop();
  }
}

async function dismissAgeModalInline(page: Page): Promise<void> {
  try {
    const modal = page.locator(".age-confirmation-modal");
    if (
      (await modal.count()) > 0 &&
      (await modal.first().isVisible({ timeout: 1500 }).catch(() => false))
    ) {
      const continueBtn = page.locator(
        '.age-confirmation-modal .qwen-chat-v2-btn-black:has-text("Continuar"), ' +
          '.age-confirmation-modal button:has-text("Continuar"), ' +
          '.age-confirmation-modal button:has-text("Continue"), ' +
          '.age-confirmation-modal button:has-text("Confirm"), ' +
          '.age-confirmation-modal button:has-text("Agree")',
      );
      if (await continueBtn.first().isVisible().catch(() => false)) {
        await continueBtn.first().click().catch(() => {});
      }
    }
  } catch {
    // Ignore modal errors
  }
}

export async function browserUiStreamFetch(
  page: Page,
  prompt: string,
  options: {
    chatSessionId?: string | null;
    modelId?: string;
    timeoutMs?: number;
    signal?: AbortSignal;
  } = {},
): Promise<{
  stream: ReadableStream<Uint8Array>;
  chatSessionId: string;
  createdNewChat: boolean;
  status: number;
  contentType: string;
}> {
  console.log(`[UIStream 1] Starting browserUiStreamFetch. Current URL: ${page.url()}`);
  options.signal?.throwIfAborted();
  const enc = new TextEncoder();
  const startTime = Date.now();
  const maxTimeoutMs = options.timeoutMs || 120000;

  if (options.chatSessionId) {
    if (!page.url().includes(`/c/${options.chatSessionId}`)) {
      console.log(`[UIStream 2] Navigating to existing chat /c/${options.chatSessionId}...`);
      await page.goto(`https://chat.qwen.ai/c/${options.chatSessionId}`, {
        waitUntil: "domcontentloaded",
        timeout: 15000,
      });
    }
  } else {
    let resetViaSidebar = false;
    if (page.url().includes("chat.qwen.ai")) {
      console.log(`[UIStream 2] Attempting reset via sidebar...`);
      resetViaSidebar = await page.evaluate(() => {
        const el = document.querySelector(
          ".sidebar-entry-fixed-list-content, [aria-label*='nova' i], .new-chat-button",
        ) as HTMLElement;
        if (el) {
          el.click();
          return true;
        }
        return false;
      }).catch(() => false);
    }
    if (!resetViaSidebar && !page.url().includes("/c/new-chat")) {
      console.log(`[UIStream 2.5] Navigating to /c/new-chat...`);
      await page.goto("https://chat.qwen.ai/c/new-chat", {
        waitUntil: "domcontentloaded",
        timeout: 15000,
      });
    }
  }

  console.log(`[UIStream 3] Waiting for splash screen hidden...`);
  await page
    .locator("#splash-screen, #splash-main-container")
    .waitFor({ state: "hidden", timeout: 6000 })
    .catch(() => {});

  console.log(`[UIStream 4] Dismissing modal and finding textarea...`);
  await page
    .evaluate(() => {
      document
        .querySelectorAll("#splash-screen, #splash-main-container")
        .forEach((e) => e.remove());
      const btns = Array.from(
        document.querySelectorAll("button, [role=\"button\"]"),
      );
      for (const b of btns) {
        const t = (b.textContent || "").toLowerCase();
        if (
          t.includes("aceitar todos") ||
          t.includes("accept all") ||
          t.includes("usar apenas") ||
          t.includes("fechar aviso")
        ) {
          (b as HTMLElement).click();
        }
      }
      const closeBtns = document.querySelectorAll(
        ".close, [aria-label*=\"close\" i], .ant-modal-close",
      );
      closeBtns.forEach((b) => (b as HTMLElement).click());
    })
    .catch(() => {});

  await page.waitForSelector("textarea", { timeout: 15000 });
  await page.focus("textarea");

  console.log(`[UIStream 5] Inserting prompt...`);
  const initialResponses = await page.evaluate(
    () => document.querySelectorAll(".response-message-content").length,
  );

  await page.focus("textarea");
  await page.evaluate((text) => {
    const ta = document.querySelector("textarea");
    if (ta) {
      ta.focus();
      ta.value = text;
      ta.dispatchEvent(new Event("input", { bubbles: true }));
      ta.dispatchEvent(new Event("change", { bubbles: true }));
    }
    document.execCommand("insertText", false, text);
  }, prompt);

  await page.waitForTimeout(250);

  console.log(`[UIStream 6] Clicking send button...`);
  const sendBtn = await page
    .waitForSelector(
      "button.send-button:not([disabled]), button[aria-label*='enviar' i]:not([disabled]), button[aria-label*='send' i]:not([disabled]), .chat-prompt-send-button:not([disabled])",
      { timeout: 4000 },
    )
    .catch(() => null);

  if (sendBtn) {
    await sendBtn.click({ force: true }).catch(() => {});
  } else {
    await page.keyboard.press("Enter").catch(() => {});
  }

  console.log(`[UIStream 7] Sent! Returning ReadableStream...`);
  let detectedChatId = options.chatSessionId || "ui-session";

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let isDone = false;
      let isProcessing = false;
      let lastLength = 0;
      let ticks = 0;

      const intervalId = setInterval(async () => {
        if (isDone || isProcessing) return;
        isProcessing = true;
        try {
          ticks++;
          if (options.signal?.aborted || Date.now() - startTime > maxTimeoutMs) {
            if (!isDone) {
              isDone = true;
              clearInterval(intervalId);
              try { controller.close(); } catch {}
            }
            return;
          }

          const state = await page.evaluate(
            ({ initialResponses }) => {
              const els = document.querySelectorAll(
                ".response-message-content",
              );
              if (els.length <= initialResponses) return null;
              const last = els[els.length - 1];
              const text = last ? last.textContent || "" : "";
              const stopBtn = document.querySelector(
                ".stop-generating-button, [aria-label*='stop' i], .stop-button, [aria-label*='parar' i]",
              );
              return { text, isGenerating: !!stopBtn };
            },
            { initialResponses },
          );

          if (isDone) return;

          if (ticks % 25 === 0) {
            console.log(
              `[UIStream tick #${ticks}] hasState=${!!state}, textLen=${state?.text?.length ?? 0}, isGen=${state?.isGenerating ?? false}`,
            );
          }

          if (state && state.text.length > lastLength) {
            lastLength = state.text.length;
            console.log(`[UIStream emit] state.text (${lastLength} chars)`);
            const chunk =
              "data: " +
              JSON.stringify({
                response_id: detectedChatId,
                choices: [{ delta: { content: state.text, phase: "answer" } }],
              }) +
              "\n\n";
            try { controller.enqueue(enc.encode(chunk)); } catch {}
          }

          if (state && lastLength > 0 && !state.isGenerating) {
            isDone = true;
            clearInterval(intervalId);
            console.log(`[UIStream complete] Finished with ${lastLength} chars!`);
            try {
              controller.enqueue(
                enc.encode(
                  "data: " +
                    JSON.stringify({
                      response_id: detectedChatId,
                      choices: [
                        {
                          delta: { content: state.text, phase: "answer" },
                          finish_reason: "stop",
                        },
                      ],
                    }) +
                    "\n\n",
                ),
              );
              controller.enqueue(enc.encode("data: [DONE]\n\n"));
              controller.close();
            } catch {}
          }
        } catch (err: any) {
          if (!isDone) {
            isDone = true;
            clearInterval(intervalId);
            console.error(`[UIStream error]`, err?.message);
            try { controller.error(err); } catch {}
          }
        } finally {
          isProcessing = false;
        }
      }, 100);
    },
  });

  const createdNewChat = !options.chatSessionId;
  return {
    stream,
    chatSessionId: detectedChatId,
    createdNewChat,
    status: 200,
    contentType: "text/event-stream",
  };
}
