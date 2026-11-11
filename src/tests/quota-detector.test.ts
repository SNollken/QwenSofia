import { test } from "node:test";
import assert from "node:assert/strict";
import {
  detectQuotaLimitMessage,
  isQuotaLimitMessage,
  quotaLimitModel,
  QUOTA_MESSAGE_MAX_LENGTH,
} from "../utils/quota-detector.ts";

test("isQuotaLimitMessage: detects English daily-limit phrases", () => {
  assert.strictEqual(
    isQuotaLimitMessage("You have reached the daily usage limit for this model."),
    true,
  );
  assert.strictEqual(isQuotaLimitMessage("Quota exceeded for this account."), true);
  assert.strictEqual(isQuotaLimitMessage("You have reached the limit."), true);
  assert.strictEqual(isQuotaLimitMessage("You've hit today's limit, upgrade your membership."), true);
  assert.strictEqual(isQuotaLimitMessage("Daily usage limit reached."), true);
  assert.strictEqual(isQuotaLimitMessage("Please switch to another model to continue."), true);
});

test("isQuotaLimitMessage: detects Portuguese quota phrases", () => {
  assert.strictEqual(
    isQuotaLimitMessage("Você atingiu o limite diário deste modelo."),
    true,
  );
  assert.strictEqual(isQuotaLimitMessage("O limite de hoje foi atingido."), true);
  assert.strictEqual(isQuotaLimitMessage("Sua cota diária esgotou."), true);
  assert.strictEqual(isQuotaLimitMessage("Faça upgrade da sua membership para continuar."), true);
});

test("isQuotaLimitMessage: detects Chinese quota phrases", () => {
  assert.strictEqual(isQuotaLimitMessage("您已达到今日的使用限额。"), true);
  assert.strictEqual(isQuotaLimitMessage("每日额度已用完，请明天再试。"), true);
  assert.strictEqual(isQuotaLimitMessage("今日限额已用尽"), true);
  assert.strictEqual(isQuotaLimitMessage("额度不足，请升级会员。"), true);
});

test("isQuotaLimitMessage: ignores normal answers", () => {
  assert.strictEqual(isQuotaLimitMessage("The capital of France is Paris."), false);
  assert.strictEqual(isQuotaLimitMessage("Aqui está a solução para o seu problema."), false);
  assert.strictEqual(isQuotaLimitMessage("Here is the code you asked for:\nconsole.log(1)"), false);
  assert.strictEqual(isQuotaLimitMessage("你好，我可以帮你写代码。"), false);
});

test("isQuotaLimitMessage: empty and missing input", () => {
  assert.strictEqual(isQuotaLimitMessage(""), false);
  assert.strictEqual(isQuotaLimitMessage("   "), false);
  assert.strictEqual(isQuotaLimitMessage(null), false);
  assert.strictEqual(isQuotaLimitMessage(undefined), false);
});

test("quota message longer than the max length is not treated as a quota limit", () => {
  const long = "You have reached the daily usage limit. " + "x".repeat(QUOTA_MESSAGE_MAX_LENGTH);
  assert.strictEqual(long.length > QUOTA_MESSAGE_MAX_LENGTH, true);
  assert.strictEqual(isQuotaLimitMessage(long), false);
  assert.strictEqual(detectQuotaLimitMessage(long).isQuotaLimit, false);

  const atLimit = "daily usage limit " + "x".repeat(QUOTA_MESSAGE_MAX_LENGTH - "daily usage limit ".length);
  assert.strictEqual(atLimit.length, QUOTA_MESSAGE_MAX_LENGTH);
  assert.strictEqual(isQuotaLimitMessage(atLimit), true);
});

test("detectQuotaLimitMessage: extracts the model named in the notice", () => {
  const hit = detectQuotaLimitMessage(
    "You have reached the daily usage limit for qwen3.8-max. Switch to another model to continue.",
  );
  assert.strictEqual(hit.isQuotaLimit, true);
  assert.strictEqual(hit.model, "qwen3.8-max");
  assert.strictEqual(quotaLimitModel("每日额度已用完：qwen3.8-max"), "qwen3.8-max");
});

test("detectQuotaLimitMessage: trims trailing punctuation from the model", () => {
  assert.strictEqual(quotaLimitModel("Você atingiu o limite diário de Qwen3.5-Plus."), "Qwen3.5-Plus");
  assert.strictEqual(quotaLimitModel("Quota exceeded for Qwen2.5-Coder-32B, please switch."), "Qwen2.5-Coder-32B");
});

test("detectQuotaLimitMessage: quota notice without a model name", () => {
  const hit = detectQuotaLimitMessage("Quota exceeded for your account.");
  assert.deepStrictEqual(hit, { isQuotaLimit: true, model: undefined });
  assert.strictEqual(quotaLimitModel("Quota exceeded for your account."), null);
});

test("detectQuotaLimitMessage: returns null model when the text is not a quota notice", () => {
  assert.deepStrictEqual(detectQuotaLimitMessage("Paris is the capital of France."), { isQuotaLimit: false });
  assert.strictEqual(quotaLimitModel("Paris is the capital of France."), null);
  assert.strictEqual(quotaLimitModel(null), null);
  assert.strictEqual(quotaLimitModel("   "), null);
});
