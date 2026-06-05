// Signed, tamper-evident quote token.
//
// The token binds a price to a specific SQL string (sha256) with a short
// expiry. The server's authoritative anti-tamper check is the re-dry-run on the
// paid call (see route.ts); this token is the client's receipt — it lets the
// agent confirm it is paying for the exact query it priced, and lets the proxy
// detect a swapped body cheaply before doing any onchain work.

import { createHmac, createHash, timingSafeEqual } from "node:crypto";
import { config } from "./config";

export interface QuotePayload {
  /** sha256(sql) — binds the quote to one query. */
  qhash: string;
  /** Bytes the query will scan (dry-run estimate). */
  bytes: number;
  /** Price in USDC base units. */
  priceBaseUnits: string;
  /** Unix epoch seconds when this quote expires. */
  exp: number;
}

export function sha256(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

function sign(data: string): string {
  return createHmac("sha256", config.quoteSecret).update(data).digest("base64url");
}

/** Encode a quote as `<base64url(json)>.<hmac>`. */
export function signQuote(payload: QuotePayload): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${body}.${sign(body)}`;
}

/** Verify + decode a quote token. Returns null if tampered or malformed. */
export function verifyQuote(token: string): QuotePayload | null {
  const dot = token.lastIndexOf(".");
  if (dot < 0) return null;
  const body = token.slice(0, dot);
  const mac = token.slice(dot + 1);

  const expected = sign(body);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as QuotePayload;
  } catch {
    return null;
  }
}
