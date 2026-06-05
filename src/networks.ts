// Network metadata the client needs to display balances and funding info.
// (Paying is network-driven by the 402 response, so this is only for the
// human-facing wallet/balance side.)

export interface ClientNetwork {
  id: "base" | "base-sepolia";
  chainId: number;
  usdcAddress: `0x${string}`;
  rpcUrl: string;
  label: string;
  faucetHint?: string;
}

export const NETWORKS: Record<string, ClientNetwork> = {
  base: {
    id: "base",
    chainId: 8453,
    usdcAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    rpcUrl: "https://mainnet.base.org",
    label: "Base mainnet",
  },
  "base-sepolia": {
    id: "base-sepolia",
    chainId: 84532,
    usdcAddress: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    rpcUrl: "https://sepolia.base.org",
    label: "Base Sepolia (testnet)",
    faucetHint: "Get free testnet USDC at https://faucet.circle.com (select Base Sepolia).",
  },
};

export function networkById(id: string): ClientNetwork {
  return NETWORKS[id] ?? NETWORKS["base-sepolia"];
}
