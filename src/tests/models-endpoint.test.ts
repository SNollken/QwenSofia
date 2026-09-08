import { test } from "node:test";
import assert from "node:assert/strict";

process.env.TEST_MOCK_QWEN_AUTH = "true";

import { app } from "../api/server.ts";

const modelsPayload = {
  data: [
    {
      id: "qwen3.8-max",
      owned_by: "qwen",
      info: {
        created_at: 123,
        meta: { max_context_length: 500000 },
      },
    },
    { id: "qwen3.7-plus", owned_by: "qwen" },
    { id: "qwen3.5-flash", owned_by: "qwen" },
  ],
};

function installModelsFetchMock(): typeof globalThis.fetch {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/models")) {
      return new Response(JSON.stringify(modelsPayload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return originalFetch(input, init);
  }) as typeof globalThis.fetch;
  return originalFetch;
}

test("models endpoint returns ETag and supports 304", async () => {
  const originalFetch = installModelsFetchMock();
  try {
    const first = await app.fetch(new Request("http://localhost/v1/models"));
    assert.equal(first.status, 200);
    const etag = first.headers.get("etag");
    assert.ok(etag, "ETag should be set");

    const body = (await first.json()) as any;
    assert.equal(body.object, "list");
    assert.deepEqual(body.data.map((model: any) => model.id), ["qwen3.8-max"]);
    assert.equal(body.data[0].owned_by, "QwenSofia");

    const second = await app.fetch(
      new Request("http://localhost/v1/models", {
        headers: { "If-None-Match": etag! },
      }),
    );
    assert.equal(second.status, 304);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("models endpoint returns a single model and 404 for missing model", async () => {
  const originalFetch = installModelsFetchMock();
  try {
    const found = await app.fetch(
      new Request("http://localhost/v1/models/qwen3.8-max"),
    );
    assert.equal(found.status, 200);
    const model = (await found.json()) as any;
    assert.equal(model.id, "qwen3.8-max");
    assert.equal(model.owned_by, "QwenSofia");

    const missing = await app.fetch(
      new Request("http://localhost/v1/models/not-a-model"),
    );
    assert.equal(missing.status, 404);
    const error = (await missing.json()) as any;
    assert.equal(error.error.code, "resource_not_found");

    const oldModel = await app.fetch(
      new Request("http://localhost/v1/models/qwen3.7-plus"),
    );
    assert.equal(oldModel.status, 404);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
