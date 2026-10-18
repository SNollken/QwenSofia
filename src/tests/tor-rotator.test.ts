import test from "node:test";
import assert from "node:assert";
import { rotateTorCircuitForProxy } from "../utils/tor-rotator.ts";

test("rotateTorCircuitForProxy: ignores empty or non-proxy urls", async () => {
  const r1 = await rotateTorCircuitForProxy(undefined);
  assert.strictEqual(r1, false);

  const r2 = await rotateTorCircuitForProxy("http://direct");
  assert.strictEqual(r2, false);

  const r3 = await rotateTorCircuitForProxy("socks5://127.0.0.1:9999");
  assert.strictEqual(r3, false);
});
