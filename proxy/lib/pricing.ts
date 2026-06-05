// Turn a BigQuery dry-run byte count into a USDC price.
//
// The proxy is a metered reseller: BigQuery bills us for bytes *scanned*, so we
// charge for bytes scanned plus a markup, with a floor that clears settlement
// overhead, then convert to USDC base units for the x402 `exact` scheme.

import { config } from "./config";

export interface Quote {
  /** Exact bytes the real query will be billed for (from the dry run). */
  bytes: number;
  /** Billable bytes after applying the per-table minimum. */
  billableBytes: number;
  /** Price in USD (human-readable). */
  priceUsd: number;
  /** Price in USDC base units (6 decimals) as a decimal string. */
  priceBaseUnits: string;
}

/**
 * @param bytes      totalBytesProcessed from the dry run
 * @param tableCount number of referenced tables (for the 10 MB/table minimum)
 */
export function priceQuery(bytes: number, tableCount: number): Quote {
  // BigQuery bills a 10 MB minimum per referenced table.
  const billableBytes = Math.max(bytes, config.minBytesPerTable * Math.max(tableCount, 1));

  const rawCostUsd = billableBytes * config.usdPerByte;
  const priceUsd = Math.max(rawCostUsd * config.markup, config.priceFloorUsd);

  return {
    bytes,
    billableBytes,
    priceUsd,
    priceBaseUnits: usdToBaseUnits(priceUsd, config.network.usdcDecimals),
  };
}

/** Convert a USD amount to integer token base units, rounding up (never undercharge). */
export function usdToBaseUnits(usd: number, decimals: number): string {
  const units = Math.ceil(usd * 10 ** decimals);
  return String(units);
}

/** Human-friendly USD string for descriptions/logs, e.g. 0.0123 -> "$0.0123". */
export function formatUsd(usd: number): string {
  // Show enough precision for sub-cent micropayments.
  const digits = usd < 0.01 ? 6 : usd < 1 ? 4 : 2;
  return `$${usd.toFixed(digits)}`;
}
