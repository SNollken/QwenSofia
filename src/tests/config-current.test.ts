import { test } from "node:test";
import assert from "node:assert/strict";
process.env.TEST_MOCK_QWEN_AUTH = "true";
import { config } from "../core/config.ts";
import { buildFinalContext } from "../routes/chat/context.ts";

test("plain requests reset stale account tool instructions in personalization mode", async () => {
  const original = config.qwen.personalizationFromRequest;
  config.qwen.personalizationFromRequest = true;
  try {
    const context = await buildFinalContext({
      messages: [{ role: "user", content: "210" }],
      systemPrompt: "",
      prompt: "User: 210",
      currentPrompt: "User: 210",
      modelId: "qwen3.8-max",
      enableThinking: true,
      conversationKey: null,
      hasExplicitConversationKey: false,
      isInternalSummarizationRequest: false,
    });
    const instruction = context.requestPersonalizationInstruction;
    assert.ok(instruction);
    assert.match(instruction, /no tools/i);
    assert.strictEqual(context.finalPrompt, "User: 210");
  } finally {
    config.qwen.personalizationFromRequest = original;
  }
});

test("config exposes only Playwright/thread-native current auth and context settings", () => {
  assert.equal(typeof config.playwright.headless, "boolean");
  assert.match(config.playwright.browser, /^(chromium|chrome|edge)$/);

  assert.equal("enabled" in config.playwright, false);
  assert.equal("rateLimit" in config, false);
  assert.equal("topicDetection" in config, false);
  assert.equal("mode" in config.context, false);

  assert.equal(typeof config.context.summarization.enabled, "boolean");
  assert.equal(config.context.summarization.model, "qwen3.8-max");
  assert.equal(
    typeof config.context.threadNative.persistenceEnabled,
    "boolean",
  );
  assert.equal(typeof config.qwen.personalizationFromRequest, "boolean");
  assert.deepEqual(config.qwen.chatPoolModels, ["qwen3.8-max"]);
  assert.equal(typeof config.playwright.initBatchSize, "number");
  assert.equal(typeof config.playwright.contextCloseTimeoutMs, "number");
  assert.equal(typeof config.playwright.idleContextTtlMs, "number");
  assert.equal(typeof config.accountRequests.maxConcurrent, "number");
  assert.equal(typeof config.accountRequests.queueTimeoutMs, "number");
  assert.equal(typeof config.sessionKeeper.enabled, "boolean");
  assert.equal(typeof config.sessionKeeper.intervalMs, "number");
  assert.equal(typeof config.sessionKeeper.idleMs, "number");
  assert.equal(typeof config.sessionKeeper.navigationIntervalMs, "number");
  assert.equal(typeof config.accountCreator.enabled, "boolean");
  assert.equal(typeof config.accountCreator.timeoutMs, "number");
  assert.equal(typeof config.accountCreator.cooldownMs, "number");
  assert.equal(typeof config.accountCreator.maxBatch, "number");
  assert.equal(typeof config.accountCreator.autoAuth, "boolean");
});

test("config keeps Qwen anti-bot static config limited to bx-v fallback", () => {
  assert.equal(typeof config.auth.userAgent, "string");
  assert.equal(typeof config.auth.bxV, "string");
  assert.equal("bxUa" in config.auth, false);
  assert.equal("bxUmidtoken" in config.auth, false);
});
