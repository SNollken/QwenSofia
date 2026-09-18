/**
 * QwenSofia - Responses API state persistence tests
 *
 * The Responses API (previous_response_id) must survive service restarts:
 * entries are write-through persisted to SQLite and re-hydrated on demand.
 */
import test from "node:test";
import assert from "node:assert";

process.env.TEST_MOCK_QWEN_AUTH = "true";

import {
  storeResponse,
  getResponseHistory,
  getStoredResponse,
  hasResponse,
  deleteStoredResponse,
  clearStore,
  clearMemoryCache,
} from "../routes/responses/state.ts";
import type { ResponsesResponse } from "../routes/responses/types.ts";

const MAX_AGE_MS = 24 * 60 * 60 * 1000;

function fakeResponse(id: string): ResponsesResponse {
  return {
    id,
    object: "response",
    created_at: Math.floor(Date.now() / 1000),
    status: "completed",
  } as unknown as ResponsesResponse;
}

function fakeMessages(text: string) {
  return [
    { role: "user" as const, content: text },
    { role: "assistant" as const, content: `reply to: ${text}` },
  ];
}

test("Responses state: entry survives an in-memory wipe (restart) via SQLite", () => {
  clearStore();

  const id = "resp-restart-1";
  storeResponse(id, fakeResponse(id), fakeMessages("hello") as any);

  // Sanity: present in memory
  assert.ok(hasResponse(id));

  // Simulate process restart: memory cache gone, SQLite intact
  clearMemoryCache();

  assert.ok(hasResponse(id), "entry should be found after restart");
  const history = getResponseHistory(id);
  assert.ok(history, "history should be hydrated from SQLite");
  assert.strictEqual(history![0].content, "hello");
  assert.strictEqual(history![1].content, "reply to: hello");

  const stored = getStoredResponse(id);
  assert.ok(stored, "stored response should be hydrated from SQLite");
  assert.strictEqual((stored as any).id, id);

  clearStore();
});

test("Responses state: delete removes memory AND persisted row", () => {
  clearStore();

  const id = "resp-delete-1";
  storeResponse(id, fakeResponse(id), fakeMessages("bye") as any);
  clearMemoryCache();

  assert.ok(hasResponse(id));
  assert.strictEqual(deleteStoredResponse(id), true);
  assert.strictEqual(hasResponse(id), false);

  // Even after another memory wipe the row must stay gone
  clearMemoryCache();
  assert.strictEqual(getResponseHistory(id), null);

  clearStore();
});

test("Responses state: entries older than 24h expire on read", () => {
  clearStore();

  const id = "resp-expired-1";
  const staleAt = Date.now() - MAX_AGE_MS - 60_000;
  storeResponse(id, fakeResponse(id), fakeMessages("old") as any, staleAt);
  clearMemoryCache();

  assert.strictEqual(getResponseHistory(id), null);
  assert.strictEqual(hasResponse(id), false);

  clearStore();
});

test("Responses state: clearStore wipes persisted rows too", () => {
  clearStore();

  const id = "resp-clear-1";
  storeResponse(id, fakeResponse(id), fakeMessages("wipe") as any);
  clearStore();

  assert.strictEqual(getResponseHistory(id), null);
});
