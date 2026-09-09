import { test } from "node:test";
import assert from "node:assert/strict";

process.env.TEST_MOCK_QWEN_AUTH = "true";
// Teto pequeno para exercitar o limite sem alocar payloads grandes.
// Definido ANTES de importar o servidor: cada arquivo de teste roda em
// processo próprio, então não afeta as demais suítes.
process.env.MAX_REQUEST_BODY_BYTES = "512";

import { app } from "../api/server.ts";
import { assertDataUriWithinLimit } from "../routes/upload.ts";

test("QP-03: JSON body above the transport cap is rejected with 413 before parsing", async () => {
  const payload = JSON.stringify({
    model: "qwen3-max",
    messages: [{ role: "user", content: "A".repeat(1024) }],
  });
  assert.ok(payload.length > 512);

  const response = await app.fetch(
    new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: payload,
    }),
  );

  assert.equal(response.status, 413);
  const body = (await response.json()) as {
    error: { code: string; type: string };
  };
  assert.equal(body.error.code, "payload_too_large");
});

test("QP-03: chunked body without Content-Length is capped while streaming", async () => {
  const chunk = new TextEncoder().encode("B".repeat(256));
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < 8; i++) controller.enqueue(chunk); // 2048 bytes
      controller.close();
    },
  });

  const request = new Request("http://localhost/v1/chat/completions", {
    method: "POST",
    // ReadableStream body não carrega Content-Length
    body: stream,
    duplex: "half",
  } as RequestInit);

  const response = await app.fetch(request);
  assert.equal(response.status, 413);
});

test("QP-03: body within the cap passes the transport gate", async () => {
  const payload = JSON.stringify({
    model: "qwen3-max",
    messages: [{ role: "user", content: "ok" }],
  });
  assert.ok(payload.length <= 512);

  const response = await app.fetch(
    new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: payload,
    }),
  );

  // Pode falhar por outro motivo (validação/upstream mock), nunca 413
  assert.notEqual(response.status, 413);
});

test("QP-03: assertDataUriWithinLimit enforces per-type caps before decoding", () => {
  const MB = 1024 * 1024;
  // base64 length para N bytes decodificados ≈ N * 4/3

  // 10 MiB de imagem: dentro do teto de 20 MiB
  assert.doesNotThrow(() =>
    assertDataUriWithinLimit(Math.ceil((10 * MB * 4) / 3), "image/png"),
  );
  // 30 MiB de imagem: acima do teto de 20 MiB
  assert.throws(
    () => assertDataUriWithinLimit(Math.ceil((30 * MB * 4) / 3), "image/png"),
    /Data URI too large/,
  );
  // 60 MiB de áudio: acima do teto de 50 MiB
  assert.throws(
    () => assertDataUriWithinLimit(Math.ceil((60 * MB * 4) / 3), "audio/mpeg"),
    /Data URI too large/,
  );
  // 110 MiB de vídeo: acima do teto de 100 MiB
  assert.throws(
    () => assertDataUriWithinLimit(Math.ceil((110 * MB * 4) / 3), "video/mp4"),
    /Data URI too large/,
  );
  // 90 MiB de vídeo: dentro do teto de 100 MiB
  assert.doesNotThrow(() =>
    assertDataUriWithinLimit(Math.ceil((90 * MB * 4) / 3), "video/mp4"),
  );
});
