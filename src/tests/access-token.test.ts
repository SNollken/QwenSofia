import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decodeJwtPayload,
  extractBearerToken,
  getBearerTokenExpiryMs,
  isBearerTokenExpired,
  hasExpiredBearerToken,
} from "../utils/access-token.ts";

const b64url = (value: unknown): string =>
  Buffer.from(JSON.stringify(value)).toString("base64url");

/** Builds a synthetic JWT; the signature is never verified. */
function makeJwt(payload: Record<string, unknown>): string {
  return [b64url({ alg: "HS256", typ: "JWT" }), b64url(payload), "c2lnbmF0dXJl"].join(".");
}

const nowSec = () => Math.floor(Date.now() / 1000);
const bearer = (token: string) => `Bearer ${token}`;

test("decodeJwtPayload: le payload sem verificar assinatura", () => {
  const token = makeJwt({ sub: "abc", exp: 1700000000 });
  assert.deepEqual(decodeJwtPayload(token), { sub: "abc", exp: 1700000000 });
});

test("decodeJwtPayload: token opaco ou malformado => null", () => {
  assert.equal(decodeJwtPayload("opaque-token"), null);
  assert.equal(decodeJwtPayload("a.@@@nao-e-json@@@.c"), null);
});

test("extractBearerToken: prefixo Bearer case-insensitive e trim", () => {
  assert.equal(extractBearerToken("Bearer abc.def.ghi"), "abc.def.ghi");
  assert.equal(extractBearerToken("bearer abc.def.ghi"), "abc.def.ghi");
  assert.equal(extractBearerToken("BEARER   abc.def.ghi  "), "abc.def.ghi");
  assert.equal(extractBearerToken("Basic abc"), null);
  assert.equal(extractBearerToken(undefined), null);
  assert.equal(extractBearerToken(""), null);
});

test("getBearerTokenExpiryMs: exp do JWT em milissegundos", () => {
  const exp = 1700000000;
  assert.equal(getBearerTokenExpiryMs(bearer(makeJwt({ exp }))), exp * 1000);
});

test("getBearerTokenExpiryMs: opaco/sem exp/header ausente => null", () => {
  assert.equal(getBearerTokenExpiryMs("Bearer token-opaco"), null);
  assert.equal(getBearerTokenExpiryMs(bearer(makeJwt({ sub: "sem-exp" }))), null);
  assert.equal(getBearerTokenExpiryMs(undefined), null);
  assert.equal(getBearerTokenExpiryMs(null), null);
});

test("isBearerTokenExpired: exp no passado => expirado", () => {
  assert.equal(isBearerTokenExpired(bearer(makeJwt({ exp: nowSec() - 3600 }))), true);
});

test("isBearerTokenExpired: exp no futuro => valido", () => {
  assert.equal(isBearerTokenExpired(bearer(makeJwt({ exp: nowSec() + 900 }))), false);
});

test("isBearerTokenExpired: exp a menos de 60s => expirado (skew)", () => {
  assert.equal(isBearerTokenExpired(bearer(makeJwt({ exp: nowSec() + 30 }))), true);
  assert.equal(isBearerTokenExpired(bearer(makeJwt({ exp: nowSec() + 59 }))), true);
});

test("isBearerTokenExpired: token opaco sem exp => nao expirado", () => {
  assert.equal(isBearerTokenExpired("Bearer token-opaco"), false);
  assert.equal(isBearerTokenExpired(bearer(makeJwt({ sub: "sem-exp" }))), false);
  assert.equal(isBearerTokenExpired(undefined), false);
});

test("hasExpiredBearerToken: header ausente/opaco => false", () => {
  assert.equal(hasExpiredBearerToken(undefined), false);
  assert.equal(hasExpiredBearerToken(null), false);
  assert.equal(hasExpiredBearerToken({}), false);
  assert.equal(hasExpiredBearerToken({ authorization: "" }), false);
  assert.equal(hasExpiredBearerToken({ authorization: "Bearer token-opaco" }), false);
});

test("hasExpiredBearerToken: detecta expirado e valido", () => {
  assert.equal(hasExpiredBearerToken({ authorization: bearer(makeJwt({ exp: nowSec() - 60 })) }), true);
  assert.equal(hasExpiredBearerToken({ authorization: bearer(makeJwt({ exp: nowSec() + 900 })) }), false);
  assert.equal(hasExpiredBearerToken({ authorization: `bearer ${makeJwt({ exp: nowSec() - 60 })}` }), true);
});
