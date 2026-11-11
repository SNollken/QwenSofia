/**
 * Helpers to inspect the Qwen access token.
 *
 * The `authorization: Bearer *** token issued by
 * `auth.qwen.ai/api/v2/auths/refresh` is a short-lived JWT (15 minutes).
 * The proxy caches headers, warm-pool chats and persisted sessions for much
 * longer than that, so a cached token can silently expire and every API call
 * then fails with "Unauthorized: You do not have permission to access this
 * resource.". These helpers make the expiry visible so callers can refresh
 * before sending a request.
 */

const JWT_EXPIRY_SKEW_MS = 60_000;

interface JwtPayload {
  exp?: number;
  iat?: number;
  typ?: string;
}

/** Decodes the payload of a JWT without verifying its signature. */
export function decodeJwtPayload(token: string): JwtPayload | null {
  const parts = token.split('.');
  if (parts.length < 2) return null;
  try {
    const json = Buffer.from(parts[1], 'base64url').toString('utf8');
    const payload = JSON.parse(json);
    return typeof payload === 'object' && payload !== null ? payload : null;
  } catch {
    return null;
  }
}

/** Extracts the raw JWT from an `authorization` header value. */
export function extractBearerToken(authorization?: string | null): string | null {
  if (!authorization) return null;
  const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  return match ? match[1].trim() : null;
}

/**
 * Returns the expiry timestamp (ms) of the bearer token, or null when it
 * cannot be determined (missing header, opaque token, malformed JWT).
 */
export function getBearerTokenExpiryMs(authorization?: string | null): number | null {
  const token = extractBearerToken(authorization);
  if (!token) return null;
  const payload = decodeJwtPayload(token);
  if (!payload || typeof payload.exp !== 'number') return null;
  return payload.exp * 1000;
}

/**
 * True when the bearer token is expired or about to expire.
 *
 * Tokens without a readable expiry are reported as valid, so opaque tokens
 * are never discarded because of a parsing problem.
 */
export function isBearerTokenExpired(authorization?: string | null, skewMs = JWT_EXPIRY_SKEW_MS): boolean {
  const expiry = getBearerTokenExpiryMs(authorization);
  if (expiry === null) return false;
  return expiry - skewMs <= Date.now();
}

/**
 * True when the headers carry a bearer token that is expired. Headers
 * without any bearer token are not considered expired: the caller may be
 * able to obtain one through the regular capture flow.
 */
export function hasExpiredBearerToken(headers: Record<string, string> | undefined | null): boolean {
  if (!headers) return false;
  const authorization = headers['authorization'];
  if (!authorization) return false;
  return isBearerTokenExpired(authorization);
}
