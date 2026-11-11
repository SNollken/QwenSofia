import test from "node:test";
import assert from "node:assert/strict";
import {
  clearAllAccountModelLimits,
  getModelLimit,
} from "../core/account-model-limits.ts";
import { processNonStreamingResponse } from "../routes/chat/streaming.ts";
import { RetryableQwenStreamError } from "../services/qwen.ts";

const accountId = "acc-streaming-quota-test";
const model = "qwen3.5-plus";

function fakeStream(lines: unknown[]): ReadableStream<Uint8Array> {
  const body = lines
    .map((line) => `data: ${typeof line === "string" ? line : JSON.stringify(line)}\n\n`)
    .join("");
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(body));
      controller.close();
    },
  });
}

function baseParams(stream: ReadableStream<Uint8Array>) {
  return {
    c: { json: (body: unknown) => Response.json(body) } as any,
    completionId: "chatcmpl-test",
    stream,
    uiSessionId: "ui-test",
    activeAccountId: accountId,
    logicalSessionId: null,
    body: { model, messages: [] } as any,
    finalPrompt: "hi",
    userPrompt: "hi",
    shouldParseToolCalls: false,
    declaredTools: [],
  } as any;
}

test("quota notice in stream marks the model limit and throws retryable quota_limit", async () => {
  clearAllAccountModelLimits(accountId);
  const quotaText =
    "Você atingiu o limite de hoje para este modelo. Mude para outro modelo.";
  const stream = fakeStream([
    { choices: [{ delta: { phase: "answer", content: quotaText } }] },
    "[DONE]",
  ]);

  await assert.rejects(
    () => processNonStreamingResponse(baseParams(stream)),
    (err: any) => {
      assert.ok(
        err instanceof RetryableQwenStreamError,
        `expected RetryableQwenStreamError, got ${err?.name}: ${err?.message}`,
      );
      assert.equal((err as any).upstreamCode, "quota_limit");
      return true;
    },
  );

  const limit = getModelLimit(accountId, model);
  assert.ok(limit, "expected the account/model limit to be recorded");
  assert.equal(limit.reason, "DailyLimit");
  assert.ok(limit.until > Date.now(), "expected limit to expire in the future");

  clearAllAccountModelLimits(accountId);
});
