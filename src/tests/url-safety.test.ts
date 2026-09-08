import { test } from "node:test";
import assert from "node:assert/strict";

process.env.TEST_MOCK_QWEN_AUTH = "true";

import {
  UnsafeRemoteMediaError,
  assertSafeMediaUrl,
  isBlockedAddress,
} from "../core/url-safety.ts";
import {
  fetchRemoteMediaSafe,
  readBodyCapped,
} from "../routes/upload.ts";

test("QP-02: isBlockedAddress covers private, loopback, link-local and metadata ranges", () => {
  const blocked = [
    "127.0.0.1",
    "127.8.9.10",
    "10.0.0.1",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254",
    "0.0.0.0",
    "100.64.0.1",
    "::1",
    "::",
    "::ffff:127.0.0.1",
    "::ffff:10.0.0.1",
    "fc00::1",
    "fd12:3456::1",
    "fe80::1",
    "feb0::1",
  ];
  for (const ip of blocked) {
    assert.equal(isBlockedAddress(ip), true, `expected blocked: ${ip}`);
  }

  const allowed = [
    "8.8.8.8",
    "1.1.1.1",
    "93.184.216.34",
    "172.32.0.1",
    "172.15.255.255",
    "100.128.0.1",
    "2606:4700:4700::1111",
  ];
  for (const ip of allowed) {
    assert.equal(isBlockedAddress(ip), false, `expected allowed: ${ip}`);
  }

  // Formato desconhecido bloqueia por padrão
  assert.equal(isBlockedAddress("not-an-ip"), true);
});

test("QP-02: assertSafeMediaUrl rejects non-http schemes", async () => {
  for (const url of [
    "ftp://example.com/file.png",
    "file:///etc/passwd",
    "data:image/png;base64,AAAA",
    "gopher://example.com/",
  ]) {
    await assert.rejects(
      () => assertSafeMediaUrl(url),
      UnsafeRemoteMediaError,
      `should reject ${url}`,
    );
  }
});

test("QP-02: assertSafeMediaUrl rejects internal IP literals including IPv6 variants", async () => {
  for (const url of [
    "http://127.0.0.1/x.png",
    "http://127.0.0.1:8080/x.png",
    "https://10.0.0.1/x.png",
    "http://192.168.0.10/x.png",
    "http://169.254.169.254/latest/meta-data/",
    "http://[::1]/x.png",
    "http://[::ffff:127.0.0.1]/x.png",
    "http://[fc00::5]/x.png",
    "http://[fe80::1]/x.png",
    "http://0.0.0.0/x.png",
  ]) {
    await assert.rejects(
      () => assertSafeMediaUrl(url),
      UnsafeRemoteMediaError,
      `should reject ${url}`,
    );
  }
});

test("QP-02: assertSafeMediaUrl rejects localhost (resolves to loopback)", async () => {
  await assert.rejects(
    () => assertSafeMediaUrl("http://localhost:9999/x.png"),
    UnsafeRemoteMediaError,
  );
});

test("QP-02: assertSafeMediaUrl accepts public IP literals", async () => {
  const parsed = await assertSafeMediaUrl("https://93.184.216.34/file.png");
  assert.equal(parsed.hostname, "93.184.216.34");
});

function fakeFetch(handler: (url: string) => Response): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    return handler(typeof input === "string" ? input : input.toString());
  }) as typeof fetch;
}

test("QP-02: redirect to internal destination is rejected", async () => {
  const fetchFn = fakeFetch((url) => {
    if (url.includes("/start")) {
      return new Response(null, {
        status: 302,
        headers: { location: "http://169.254.169.254/latest/meta-data/" },
      });
    }
    return new Response("should never reach here");
  });

  await assert.rejects(
    () => fetchRemoteMediaSafe("http://93.184.216.34/start", fetchFn),
    UnsafeRemoteMediaError,
  );
});

test("QP-02: redirect to loopback hostname is rejected", async () => {
  const fetchFn = fakeFetch((url) => {
    if (url.includes("/start")) {
      return new Response(null, {
        status: 301,
        headers: { location: "http://localhost:3000/admin" },
      });
    }
    return new Response("should never reach here");
  });

  await assert.rejects(
    () => fetchRemoteMediaSafe("http://93.184.216.34/start", fetchFn),
    UnsafeRemoteMediaError,
  );
});

test("QP-02: relative redirect is resolved against current URL and validated", async () => {
  let hops = 0;
  const fetchFn = fakeFetch((url) => {
    hops++;
    if (url.includes("/start")) {
      return new Response(null, {
        status: 302,
        headers: { location: "/final.png" },
      });
    }
    return new Response("ok", {
      headers: { "content-type": "image/png" },
    });
  });

  const response = await fetchRemoteMediaSafe(
    "http://93.184.216.34/start",
    fetchFn,
  );
  assert.equal(response.status, 200);
  assert.equal(hops, 2);
});

test("QP-02: redirect loop is cut at the configured maximum", async () => {
  const fetchFn = fakeFetch(() => {
    return new Response(null, {
      status: 302,
      headers: { location: "http://93.184.216.34/again" },
    });
  });

  await assert.rejects(
    () => fetchRemoteMediaSafe("http://93.184.216.34/start", fetchFn),
    UnsafeRemoteMediaError,
  );
});

test("QP-02: body larger than the cap is rejected while streaming (no Content-Length)", async () => {
  const bigChunk = new Uint8Array(16).fill(65);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // 4 x 16 bytes = 64 bytes, sem Content-Length
      for (let i = 0; i < 4; i++) controller.enqueue(bigChunk);
      controller.close();
    },
  });
  const response = new Response(stream);

  await assert.rejects(
    () => readBodyCapped(response, 32),
    /too large/,
  );
});

test("QP-02: oversized Content-Length is rejected before reading the body", async () => {
  const response = new Response("x", {
    headers: { "content-length": String(10 * 1024 * 1024) },
  });
  await assert.rejects(
    () => readBodyCapped(response, 1024),
    /too large/,
  );
});

test("QP-02: body within the cap is returned intact", async () => {
  const response = new Response("conteudo-ok");
  const buffer = await readBodyCapped(response, 1024);
  assert.equal(buffer.toString(), "conteudo-ok");
});
