import { homedir } from "node:os";
import { join } from "node:path";

export const config = {
  /** Base URL of the gcp.sh proxy, e.g. https://gcp.sh */
  proxyUrl: (process.env.PROXY_URL ?? "https://gcp.sh").replace(/\/$/, ""),

  /**
   * Optional explicit key (power users / CI). When unset, the server generates
   * and persists a wallet on first run — see wallet.ts.
   */
  privateKeyEnv: process.env.WALLET_PRIVATE_KEY,

  /** Where the auto-generated wallet is stored. */
  walletFile: process.env.WALLET_FILE ?? join(homedir(), ".gcp-sh", "wallet.json"),

  /** Hard ceiling on what a single query may auto-pay, in USD. */
  maxPaymentUsd: Number(process.env.MAX_PAYMENT_USD ?? "1.00"),
} as const;
