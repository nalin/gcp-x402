// Wallet lifecycle: generate-on-first-run, persist locally, load thereafter.
//
// The agent's wallet is created automatically the first time the MCP server
// starts. The private key is written to a 0600 file in a per-project `.gcp-sh`
// directory so it survives restarts; the user just funds the printed address
// with Base USDC. A pasted WALLET_PRIVATE_KEY env var overrides this.

import { mkdirSync, readFileSync, writeFileSync, existsSync, chmodSync } from "node:fs";
import { dirname, join } from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { PrivateKeyAccount, Hex } from "viem";
import { config } from "./config.js";

interface Keystore {
  address: string;
  privateKey: Hex;
  createdAt: string;
  note: string;
}

let _account: PrivateKeyAccount | null = null;
/** True when the wallet was created on this run (so we can nudge the user to fund it). */
export let freshlyCreated = false;

export function getAccount(): PrivateKeyAccount {
  if (_account) return _account;

  // 1) Explicit env override always wins.
  if (config.privateKeyEnv) {
    const pk = (config.privateKeyEnv.startsWith("0x") ? config.privateKeyEnv : `0x${config.privateKeyEnv}`) as Hex;
    _account = privateKeyToAccount(pk);
    return _account;
  }

  // 2) Load an existing keystore.
  if (existsSync(config.walletFile)) {
    const ks = JSON.parse(readFileSync(config.walletFile, "utf8")) as Keystore;
    _account = privateKeyToAccount(ks.privateKey);
    return _account;
  }

  // 3) First run — generate and persist a new wallet.
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  const ks: Keystore = {
    address: account.address,
    privateKey,
    createdAt: new Date().toISOString(),
    note: "gcp.sh agent wallet. Keep this file secret. Fund the address with USDC on Base.",
  };
  const dir = dirname(config.walletFile);
  mkdirSync(dir, { recursive: true });
  // Safety net: a project-local keystore holds a private key — make sure it can
  // never be accidentally committed, regardless of the project's own .gitignore.
  try {
    writeFileSync(join(dir, ".gitignore"), "*\n", { flag: "wx" });
  } catch {
    /* already exists / unwritable — fine */
  }
  writeFileSync(config.walletFile, JSON.stringify(ks, null, 2), { mode: 0o600 });
  try {
    chmodSync(config.walletFile, 0o600);
  } catch {
    /* best effort on platforms without POSIX perms */
  }
  _account = account;
  freshlyCreated = true;
  return _account;
}
