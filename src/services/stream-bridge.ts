import type { Page } from "playwright";
import crypto from "crypto";
import { config } from "../core/config.ts";
import { logger } from "../core/logger.ts";
import { Mutex } from "../core/mutex.ts";
import { isAccessVerificationVisible } from "./aliyun-captcha-solver.ts";

const pageMutexes = new WeakMap<Page, Mutex>();

function getPageMutex(page: Page): Mutex {
  let m = pageMutexes.get(page);
  if (!m) {
    m = new Mutex();
    pageMutexes.set(page, m);
  }
  return m;
}

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
    files?: Array<{ name: string; mimeType?: string; buffer?: Buffer; url?: string }>;
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
  const pageMutex = getPageMutex(page);
  const releaseLock = await pageMutex.acquire(
    options.timeoutMs || 120000,
    options.signal,
  );
  let lockReleased = false;
  const safeReleaseLock = () => {
    if (!lockReleased) {
      lockReleased = true;
      releaseLock();
    }
  };
  options.signal?.addEventListener("abort", safeReleaseLock, { once: true });

  const enc = new TextEncoder();
  const startTime = Date.now();
  const maxTimeoutMs = options.timeoutMs || 120000;

  try {
    // Sempre garante que a aba comece em uma conversa limpa (/c/new-chat) sem mensagens residuais
    const currentMsgCount = await page
      .evaluate(
        () => document.querySelectorAll(".response-message-content").length,
      )
      .catch(() => 0);

    const currentUrl = page.url();
    const needsReset =
      currentMsgCount > 0 ||
      (currentUrl.includes("/c/") && !currentUrl.includes("/c/new-chat"));

    if (needsReset) {
      console.log(
        `[UIStream 2] Resetting DOM to clean state (msgs=${currentMsgCount}, url=${currentUrl})...`,
      );
      // Tenta clicar no botão .new-chat para reset instantâneo na SPA sem reload
      const clickedNewChat = await page
        .evaluate(() => {
          const btn = document.querySelector(".new-chat, button.new-chat-btn");
          if (btn) {
            (btn as HTMLElement).click();
            return true;
          }
          return false;
        })
        .catch(() => false);

      if (clickedNewChat) {
        await page.waitForTimeout(400);
      }

      // Se ainda tiver mensagens residuais ou a URL continuar em chat antigo, navega para /c/new-chat
      const remainingMsgs = await page
        .evaluate(
          () => document.querySelectorAll(".response-message-content").length,
        )
        .catch(() => 0);

      if (
        remainingMsgs > 0 ||
        (page.url().includes("/c/") && !page.url().includes("/c/new-chat"))
      ) {
        await page
          .goto("https://chat.qwen.ai/c/new-chat", {
            waitUntil: "domcontentloaded",
            timeout: 15000,
          })
          .catch(() => {});
        await page.waitForTimeout(500);
      }
    } else {
      const isAlreadyAtRootOrNew =
        currentUrl === "https://chat.qwen.ai/" ||
        currentUrl === "https://chat.qwen.ai" ||
        currentUrl.includes("/c/new-chat");
      if (!isAlreadyAtRootOrNew) {
        console.log(`[UIStream 2] Navigating to /c/new-chat...`);
        await page
          .goto("https://chat.qwen.ai/c/new-chat", {
            waitUntil: "domcontentloaded",
            timeout: 15000,
          })
          .catch(() => {});
        await page.waitForTimeout(500);
      }
    }

  console.log(`[UIStream 3] Cleaning overlays and finding textarea...`);
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

  await page.waitForSelector("textarea", { timeout: 8000 });
  await page.focus("textarea");

  if (options.files && options.files.length > 0) {
    try {
      console.log(`[UIStream 4.5] Attaching ${options.files.length} file(s)...`);
      let fileInput = await page.$('input[type="file"]');
      if (!fileInput) {
        const uploadBtn = await page.$(
          'button[aria-label*="upload" i], button[aria-label*="anexar" i], button[aria-label*="file" i], .chat-input-upload, [class*="upload"] button',
        );
        if (uploadBtn) {
          await uploadBtn.click().catch(() => {});
          await page.waitForTimeout(300);
          fileInput = await page.$('input[type="file"]');
        }
      }
      if (fileInput) {
        const payloadFiles = options.files
          .filter((f) => f.buffer && f.buffer.length > 0)
          .map((f) => ({
            name: f.name || "attachment.png",
            mimeType: f.mimeType || "image/png",
            buffer: f.buffer!,
          }));
        if (payloadFiles.length > 0) {
          await fileInput.setInputFiles(payloadFiles);
          console.log(
            `[UIStream 4.5] Attached ${payloadFiles.length} file(s) to DOM`,
          );
          await page.waitForTimeout(1200);
        }
      } else {
        console.warn(`[UIStream 4.5] input[type="file"] not found in DOM`);
      }
    } catch (err: any) {
      console.warn(`[UIStream] Failed to attach files: ${err.message}`);
    }
  }

  console.log(`[UIStream 5] Inserting prompt (${prompt.length} chars)...`);
  const initialResponses = await page.evaluate(
    () => document.querySelectorAll(".response-message-content").length,
  );

  await page.focus("textarea", { timeout: 3000 }).catch(() => {});
  try {
    await page.fill("textarea", prompt, { timeout: 8000 });
  } catch {
    await page.evaluate((text) => {
      const ta = document.querySelector("textarea");
      if (!ta) return;
      const tracker = (ta as any)._valueTracker;
      if (tracker) tracker.setValue("");
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      if (setter) setter.call(ta, text);
      else ta.value = text;
      ta.dispatchEvent(new Event("input", { bubbles: true }));
      ta.dispatchEvent(new Event("change", { bubbles: true }));
    }, prompt);
  }

  await page.waitForTimeout(300);

  console.log(`[UIStream 6] Clicking send button...`);
  const sendBtn = await page
    .waitForSelector(
      "button.send-button:not([disabled]), button[aria-label*='enviar' i]:not([disabled]), button[aria-label*='send' i]:not([disabled]), .chat-prompt-send-button:not([disabled])",
      { timeout: 4000 },
    )
    .catch(() => null);

  if (sendBtn) {
    console.log(`[UIStream 6] Send button found, clicking...`);
    await sendBtn.click({ force: true }).catch(() => {});
  } else {
    console.log(
      `[UIStream 6] Send button not enabled, focusing textarea and pressing Enter...`,
    );
    await page.focus("textarea").catch(() => {});
    await page.keyboard.press("Enter").catch(() => {});
  }

  // Self-healing check: if textarea still retains the prompt, retry submit
  await page.waitForTimeout(400);
  const stillHasPrompt = await page
    .evaluate(() => {
      const ta = document.querySelector("textarea");
      return (ta?.value || "").trim().length > 0;
    })
    .catch(() => false);

  if (stillHasPrompt) {
    console.log(
      `[UIStream 6.5] Textarea retained content after click, retrying submit via Enter and button...`,
    );
    await page.focus("textarea").catch(() => {});
    await page.keyboard.press("Enter").catch(() => {});
    const retryBtn = await page.$(
      "button.send-button:not([disabled]), button[aria-label*='enviar' i]:not([disabled]), button[aria-label*='send' i]:not([disabled]), .chat-prompt-send-button:not([disabled])",
    );
    if (retryBtn) {
      await retryBtn.click({ force: true }).catch(() => {});
    }
  }

  console.log(`[UIStream 7] Sent! Returning ReadableStream...`);
  let detectedChatId =
    options.chatSessionId &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      options.chatSessionId,
    )
      ? options.chatSessionId
      : "";
  const initialUrlMatch = page.url().match(/\/c\/([a-f0-9-]{36})/i);
  if (initialUrlMatch) {
    detectedChatId = initialUrlMatch[1];
  }

  let isDone = false;
  let intervalId: NodeJS.Timeout | undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let isProcessing = false;
      let lastLength = 0;
      let lastThoughtLength = 0;
      let ticks = 0;

      intervalId = setInterval(async () => {
        if (isDone || isProcessing) return;
        isProcessing = true;
        try {
          ticks++;
          if (options.signal?.aborted || Date.now() - startTime > maxTimeoutMs) {
            if (!isDone) {
              isDone = true;
              if (intervalId) clearInterval(intervalId);
              try { controller.close(); } catch {}
              safeReleaseLock();
            }
            return;
          }

          const state = await page.evaluate(
            ({ initialResponses }) => {
              const els = document.querySelectorAll(
                ".response-message-content, [class*='response-message-content']",
              );
              const stopBtn = document.querySelector(
                ".stop-generating-button, [aria-label*='stop' i], .stop-button, [aria-label*='parar' i]",
              );
              const isGenerating = !!stopBtn;

              if (els.length <= initialResponses) {
                return {
                  text: "",
                  thoughtText: "",
                  isGenerating,
                  hasNewMessage: false,
                };
              }

              const last = els[els.length - 1];
              if (!last) {
                return {
                  text: "",
                  thoughtText: "",
                  isGenerating,
                  hasNewMessage: false,
                };
              }

              const thoughtEl = last.querySelector(
                ".thought-content, .reasoning-content, details.think-block, [class*='thinking-content']",
              );
              const thoughtText = thoughtEl
                ? (thoughtEl.textContent || "").trim()
                : "";

              const clone = last.cloneNode(true) as HTMLElement;
              clone
                .querySelectorAll(
                  ".thought-content, .reasoning-content, details.think-block, [class*='thinking-content']",
                )
                .forEach((el) => el.remove());
              clone
                .querySelectorAll(
                  "button, .code-block-header, [class*='code-header'], [class*='code-block-header']",
                )
                .forEach((el) => el.remove());
              const text = (clone.textContent || "").trim();

              return { text, thoughtText, isGenerating, hasNewMessage: true };
            },
            { initialResponses },
          );

          if (isDone) return;

          // Fail fast if submission never started generation within 15 seconds
          if (ticks > 150 && !state?.hasNewMessage && !state?.isGenerating) {
            console.warn(
              `[UIStream] No generation started within 15s (ticks=${ticks}), failing fast for failover`,
            );
            isDone = true;
            clearInterval(intervalId);
            try {
              controller.error(
                new Error(
                  "UI Stream prompt submission failed to start generation within 15s",
                ),
              );
            } catch {}
            safeReleaseLock();
            return;
          }

          if (ticks % 25 === 0) {
            const currentUrlMatch = page.url().match(/\/c\/([a-f0-9-]{36})/i);
            if (currentUrlMatch) {
              detectedChatId = currentUrlMatch[1];
            }

            const domDebug = await page
              .evaluate(() => {
                const ta = document.querySelector("textarea");
                const taVal = ta ? (ta.value || "").slice(0, 30) : "no-ta";
                const msgEls = document.querySelectorAll(
                  "[class*='message']",
                ).length;
                const resEls = document.querySelectorAll(
                  ".response-message-content",
                ).length;
                const stopBtn = !!document.querySelector(
                  ".stop-generating-button, [aria-label*='stop' i], .stop-button, [aria-label*='parar' i]",
                );
                return {
                  taVal,
                  msgEls,
                  resEls,
                  stopBtn,
                  url: window.location.href,
                };
              })
              .catch(() => null);

            console.log(
              `[UIStream tick #${ticks}] hasState=${!!state}, textLen=${state?.text?.length ?? 0}, thoughtLen=${state?.thoughtText?.length ?? 0}, isGen=${state?.isGenerating ?? false} | DOM: ${JSON.stringify(domDebug)}`,
            );
          }

          if (ticks % 10 === 0 && (state?.isGenerating || state?.hasNewMessage)) {
            try {
              controller.enqueue(enc.encode(": heartbeat\n\n"));
            } catch {}
          }

          // 1. Emite pensamento/raciocínio se presente
          if (state?.thoughtText && state.thoughtText.length > lastThoughtLength) {
            lastThoughtLength = state.thoughtText.length;
            const thoughtChunk =
              "data: " +
              JSON.stringify({
                response_id: detectedChatId,
                choices: [
                  {
                    delta: {
                      content: state.thoughtText,
                      phase: "thinking_summary",
                    },
                  },
                ],
              }) +
              "\n\n";
            try { controller.enqueue(enc.encode(thoughtChunk)); } catch {}
          }

          // 2. Emite resposta textual
          if (state && state.text.length > lastLength) {
            lastLength = state.text.length;
            const chunk =
              "data: " +
              JSON.stringify({
                response_id: detectedChatId,
                choices: [{ delta: { content: state.text, phase: "answer" } }],
              }) +
              "\n\n";
            try { controller.enqueue(enc.encode(chunk)); } catch {}
          }

          if (
            state &&
            state.hasNewMessage &&
            lastLength > 0 &&
            !state.isGenerating
          ) {
            isDone = true;
            clearInterval(intervalId);
            console.log(
              `[UIStream complete] Finished with text=${lastLength} chars, thought=${lastThoughtLength} chars!`,
            );
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
            safeReleaseLock();
          }
        } catch (err: any) {
          if (!isDone) {
            isDone = true;
            clearInterval(intervalId);
            console.error(`[UIStream error]`, err?.message);
            try { controller.error(err); } catch {}
            safeReleaseLock();
          }
        } finally {
          isProcessing = false;
        }
      }, 100);
    },
    cancel() {
      if (!isDone) {
        isDone = true;
        clearInterval(intervalId);
      }
      safeReleaseLock();
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
  } catch (err) {
    safeReleaseLock();
    throw err;
  }
}
