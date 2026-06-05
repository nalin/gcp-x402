// Network + USDC asset metadata for the x402 `exact` scheme.
// The `extra` field carries the EIP-712 domain the client needs to sign the
// EIP-3009 transferWithAuthorization for USDC.

export interface X402Network {
  /** x402 network identifier sent in PaymentRequirements. */
  id: "base" | "base-sepolia";
  /** EVM chain id (informational / client convenience). */
  chainId: number;
  /** USDC contract address on this network. */
  usdcAddress: `0x${string}`;
  /** USDC decimals — always 6 for Circle USDC. */
  usdcDecimals: number;
  /** EIP-712 domain for the USDC contract (used by the exact scheme). */
  eip712: { name: string; version: string };
}

// Circle-native USDC. Same EIP-712 domain (name "USDC", version "2") on both.
export const base: X402Network = {
  id: "base",
  chainId: 8453,
  usdcAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  usdcDecimals: 6,
  eip712: { name: "USDC", version: "2" },
};

export const baseSepolia: X402Network = {
  id: "base-sepolia",
  chainId: 84532,
  usdcAddress: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  usdcDecimals: 6,
  eip712: { name: "USDC", version: "2" },
};
