/**
 * Validação de destino para mídia remota (anti-SSRF).
 * Nenhuma URL fornecida por cliente pode alcançar rede privada,
 * loopback, link-local ou endpoint de metadados.
 */
import dns from "node:dns/promises";
import net from "node:net";

export class UnsafeRemoteMediaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeRemoteMediaError";
  }
}

/**
 * Bloqueia endereços privados/reservados. Aceita IPv4, IPv6 e IPv4-mapped
 * (::ffff:a.b.c.d). Qualquer formato não reconhecido é bloqueado por padrão.
 */
export function isBlockedAddress(rawIp: string): boolean {
  let ip = rawIp.toLowerCase().trim();
  // Remove zone id (ex: fe80::1%eth0)
  const zoneIdx = ip.indexOf("%");
  if (zoneIdx !== -1) ip = ip.slice(0, zoneIdx);
  // Normaliza IPv4-mapped IPv6
  if (ip.startsWith("::ffff:")) ip = ip.slice(7);

  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 0 || a === 127 || a === 10) return true; // 0/8, loopback, 10/8
    if (a === 169 && b === 254) return true; // link-local / metadata
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
    if (a === 192 && b === 168) return true; // 192.168/16
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
    return false;
  }

  if (net.isIPv6(ip)) {
    if (ip === "::" || ip === "::1") return true;
    if (ip.startsWith("fc") || ip.startsWith("fd")) return true; // ULA fc00::/7
    if (/^fe[89ab]/.test(ip)) return true; // link-local fe80::/10
    return false;
  }

  return true; // formato desconhecido => bloqueia
}

/**
 * Valida esquema e destino de uma URL de mídia. Para hostnames, resolve DNS
 * e bloqueia se QUALQUER registro apontar para faixa proibida. Lança
 * UnsafeRemoteMediaError quando o destino não é seguro.
 */
export async function assertSafeMediaUrl(url: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new UnsafeRemoteMediaError("URL de mídia inválida");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new UnsafeRemoteMediaError(
      `esquema não permitido para mídia: ${parsed.protocol}`,
    );
  }

  const host = parsed.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host)) {
    if (isBlockedAddress(host)) {
      throw new UnsafeRemoteMediaError("destino de mídia bloqueado");
    }
    return parsed;
  }

  let records: Array<{ address: string; family: number }>;
  try {
    records = await dns.lookup(host, { all: true, verbatim: true });
  } catch {
    throw new UnsafeRemoteMediaError("hostname de mídia não resolve");
  }
  if (records.length === 0) {
    throw new UnsafeRemoteMediaError("hostname de mídia não resolve");
  }
  for (const record of records) {
    if (isBlockedAddress(record.address)) {
      throw new UnsafeRemoteMediaError("destino de mídia bloqueado");
    }
  }
  return parsed;
}
