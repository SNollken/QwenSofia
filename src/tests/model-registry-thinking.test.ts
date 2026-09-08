import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getModelContextWindow,
  getModelTokenDivisor,
} from "../core/model-registry.ts";

test("model-registry: exposes qwen3.8-max limits", () => {
  const contextWindow = getModelContextWindow("qwen3.8-max");
  assert.equal(contextWindow, 500000);

  const tokenDivisor = getModelTokenDivisor("qwen3.8-max");
  assert.equal(tokenDivisor, 2.2);
});

test("model-registry: returns defaults for unknown models", () => {
  const contextWindow = getModelContextWindow("unknown-model");
  assert.equal(contextWindow, 131072); // defaultContextWindow

  const tokenDivisor = getModelTokenDivisor("unknown-model");
  assert.equal(tokenDivisor, 2.0); // defaultTokenDivisor
});
