// ─────────────────────────────────────────────────────────────────────────────
// src/chains.ts  –  Single source of truth for all chain metadata
//
// Canonical key: lowercase Axelar testnet name (e.g. "ethereum-sepolia").
// Chains that only exist in Wormhole (no Axelar equivalent) use the
// lowercase Wormhole name as the key (e.g. "injective", "sui", "aptos").
//
// Adding a new protocol later:
//   1. Add a field to ChainInfo (e.g. layerzeroName?: string)
//   2. Add the chain entries below
//   3. Add a supportsLayerZero() helper at the bottom
// ─────────────────────────────────────────────────────────────────────────────

// ── Axelar contract addresses (testnet) ──────────────────────────────────────
// These are YOUR deployed Airdrop/Gateway contracts per chain.
// Chains without a deployed contract have contractAddress: undefined —
// the RouteSelector will skip Axelar for those chains until you deploy one.

export interface AxelarContracts {
  /** Your deployed Airdrop contract address on this chain */
  contractAddress?: string;
}

// ── Per-chain metadata ────────────────────────────────────────────────────────

export interface ChainInfo {
  /** Display name shown to users */
  displayName: string;

  /** Axelar testnet chain name (used in Axelar SDK calls). Undefined = not supported by Axelar. */
  axelarName?: string;

  /** Wormhole chain name (used in Wormhole SDK calls). Undefined = not supported by Wormhole. */
  wormholeName?: string;

  /** Native gas token symbol */
  nativeToken: string;

  /** Circle USDC contract address on this chain's testnet (used by Wormhole) */
  usdcAddress?: string;

  /**
   * Axelar's aUSDC contract address on this chain.
   * Different from Circle USDC — this is Axelar's own wrapped representation.
   * Used as the `tokenAddress` in approve() and as reference for balance checks.
   */
  axelarUsdcAddress?: string;

  /** aUSDC symbol used by Axelar (always "aUSDC" on testnet) */
  axelarTokenSymbol?: string;

  /** True for L2s — Axelar fee estimator needs this for executeData */
  isL2?: boolean;

  /** Your deployed Axelar Airdrop contract addresses */
  axelarContracts?: AxelarContracts;
}

// ─────────────────────────────────────────────────────────────────────────────
// Chain registry
// Key = canonical lowercase identifier (prefer Axelar testnet name where possible)
// ─────────────────────────────────────────────────────────────────────────────

export const CHAINS: Record<string, ChainInfo> = {

  // ── Ethereum / Sepolia ────────────────────────────────────────────────────
  "ethereum-sepolia": {
    displayName:        "Ethereum Sepolia",
    axelarName:         "ethereum-sepolia",
    wormholeName:       "Sepolia",
    nativeToken:        "ETH",
    usdcAddress:        "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
    axelarUsdcAddress:  "0x254d06f33bDc5b8ee05b2ea472107E300226659A",
    axelarTokenSymbol:  "aUSDC",
    axelarContracts: {
      contractAddress: "0xAe809E3bbC80090920aAb24675702932619DCf2e",
    },
  },

  // ── Optimism Sepolia ──────────────────────────────────────────────────────
  "optimism-sepolia": {
    displayName:        "Optimism Sepolia",
    axelarName:         "optimism-sepolia",
    wormholeName:       "OptimismSepolia",
    nativeToken:        "ETH",
    usdcAddress:        "0x5fd84259d66Cd46123540766Be93DFE6D43130D7",
    axelarUsdcAddress:  "0x254d06f33bDc5b8ee05b2ea472107E300226659A",
    axelarTokenSymbol:  "aUSDC",
    isL2:               true,
    axelarContracts: {
      contractAddress: "0xE816791A620506c6A1da03b491221e2E89dd528e",
    },
  },

  // ── Arbitrum Sepolia ──────────────────────────────────────────────────────
  "arbitrum-sepolia": {
    displayName:        "Arbitrum Sepolia",
    axelarName:         "arbitrum-sepolia",
    wormholeName:       "ArbitrumSepolia",
    nativeToken:        "ETH",
    usdcAddress:        "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
    axelarUsdcAddress:  "0xA2Ba06a76eC793d1Faf23Cc8220A887402b27331",
    axelarTokenSymbol:  "aUSDC",
    isL2:               true,
    axelarContracts: {
      contractAddress: "0xE816791A620506c6A1da03b491221e2E89dd528e",
    },
  },

  // ── Base Sepolia ──────────────────────────────────────────────────────────
  "base-sepolia": {
    displayName:        "Base Sepolia",
    axelarName:         "base-sepolia",
    wormholeName:       "BaseSepolia",
    nativeToken:        "ETH",
    usdcAddress:        "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    axelarUsdcAddress:  "0x254d06f33bDc5b8ee05b2ea472107E300226659A",
    axelarTokenSymbol:  "aUSDC",
    isL2:               true,
    axelarContracts: {
      contractAddress: "0xE816791A620506c6A1da03b491221e2E89dd528e",
    },
  },

  // ── Polygon Sepolia ───────────────────────────────────────────────────────
  "polygon-sepolia": {
    displayName:        "Polygon Sepolia",
    axelarName:         "polygon-sepolia",
    wormholeName:       "PolygonSepolia",
    nativeToken:        "POL",
    usdcAddress:        "0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582",
    axelarUsdcAddress:  "0x254d06f33bDc5b8ee05b2ea472107E300226659A",
    axelarTokenSymbol:  "aUSDC",
    // axelarContracts: { contractAddress: undefined },  // not deployed yet
  },

  // ── Avalanche Fuji ────────────────────────────────────────────────────────
  "avalanche": {
    displayName:        "Avalanche Fuji",
    axelarName:         "Avalanche",            // Axelar uses PascalCase for this one
    wormholeName:       "Avalanche",
    nativeToken:        "AVAX",
    usdcAddress:        "0x5425890298aed601595a70AB815c96711a31Bc65",
    axelarUsdcAddress:  "0x57F1c63497AEe0bE305B8852b354CEc793da43bB",
    axelarTokenSymbol:  "aUSDC",
  },

  // ── BNB Chain ─────────────────────────────────────────────────────────────
  "binance": {
    displayName:        "BNB Chain",
    axelarName:         "binance",
    wormholeName:       "Bsc",
    nativeToken:        "BNB",
    axelarUsdcAddress:  "0xc2fA98faB811B785b81c64Ac875b31CC9E40F9D2",
    axelarTokenSymbol:  "aUSDC",
  },

  // ── Fantom ────────────────────────────────────────────────────────────────
  "fantom": {
    displayName:        "Fantom",
    axelarName:         "Fantom",              // Axelar PascalCase
    wormholeName:       "Fantom",
    nativeToken:        "FTM",
    axelarUsdcAddress:  "0x75Cc4fDf1ee3E781C1A3Ee9151D5c6Ce34Cf5C61",
    axelarTokenSymbol:  "aUSDC",
  },

  // ── Celo Sepolia ──────────────────────────────────────────────────────────
  "celo-sepolia": {
    displayName:        "Celo Alfajores",
    axelarName:         "celo-sepolia",
    wormholeName:       "Celo",
    nativeToken:        "CELO",
    usdcAddress:        "0x01C5C0122039549AD1493B8220cABEdD739BC44E",
    axelarUsdcAddress:  "0x254d06f33bDc5b8ee05b2ea472107E300226659A",
    axelarTokenSymbol:  "aUSDC",
  },

  // ── Blast Sepolia ─────────────────────────────────────────────────────────
  "blast-sepolia": {
    displayName:        "Blast Sepolia",
    axelarName:         "blast-sepolia",
    wormholeName:       "Blast",
    nativeToken:        "ETH",
    axelarUsdcAddress:  "0x254d06f33bDc5b8ee05b2ea472107E300226659A",
    axelarTokenSymbol:  "aUSDC",
    isL2:               true,
  },

  // ── Scroll ────────────────────────────────────────────────────────────────
  "scroll": {
    displayName:        "Scroll",
    axelarName:         "scroll",
    wormholeName:       "Scroll",
    nativeToken:        "ETH",
    axelarUsdcAddress:  "0x254d06f33bDc5b8ee05b2ea472107E300226659A",
    axelarTokenSymbol:  "aUSDC",
    isL2:               true,
  },

  // ── Mantle Sepolia ────────────────────────────────────────────────────────
  "mantle-sepolia": {
    displayName:        "Mantle Sepolia",
    axelarName:         "mantle-sepolia",
    wormholeName:       "Mantle",
    nativeToken:        "MNT",
    axelarUsdcAddress:  "0xAa03872057AD496Bd6f3eE85b85e1e4DABdb1a5d",
    axelarTokenSymbol:  "aUSDC",
    isL2:               true,
  },

  // ── Linea Sepolia ─────────────────────────────────────────────────────────
  "linea-sepolia": {
    displayName:        "Linea Sepolia",
    axelarName:         "linea-sepolia",
    wormholeName:       "Linea",
    nativeToken:        "ETH",
    usdcAddress:        "0xFEce4462D57bD51A6A552365A011b95f0E16d9B7",
    axelarUsdcAddress:  "0x254d06f33bDc5b8ee05b2ea472107E300226659A",
    axelarTokenSymbol:  "aUSDC",
    isL2:               true,
  },

  // ── Moonbeam ──────────────────────────────────────────────────────────────
  "moonbeam": {
    displayName:        "Moonbase Alpha",
    axelarName:         "Moonbeam",            // Axelar PascalCase
    wormholeName:       "Moonbeam",
    nativeToken:        "GLMR",
    axelarUsdcAddress:  "0xD1633F7Fb3d716643125d6415d4177bC36b7186b",
    axelarTokenSymbol:  "aUSDC",
  },

  // ── Filecoin Calibration ──────────────────────────────────────────────────
  // Axelar only — Wormhole does not support Filecoin
  "filecoin-2": {
    displayName:        "Filecoin Calibration",
    axelarName:         "filecoin-2",
    nativeToken:        "FIL",
    axelarUsdcAddress:  "0xCb7996d51Ff923b2C6076d42C065a6ca000D32A1",
    axelarTokenSymbol:  "aUSDC",
  },

  // ── Fraxtal ───────────────────────────────────────────────────────────────
  // Axelar only
  "fraxtal": {
    displayName:        "Fraxtal",
    axelarName:         "fraxtal",
    nativeToken:        "frxETH",
    axelarUsdcAddress:  "0x254d06f33bDc5b8ee05b2ea472107E300226659A",
    axelarTokenSymbol:  "aUSDC",
    isL2:               true,
  },

  // ── Immutable ─────────────────────────────────────────────────────────────
  // Axelar only
  "immutable": {
    displayName:        "Immutable zkEVM",
    axelarName:         "immutable",
    nativeToken:        "IMX",
    axelarUsdcAddress:  "0x254d06f33bDc5b8ee05b2ea472107E300226659A",
    axelarTokenSymbol:  "aUSDC",
    isL2:               true,
  },

  // ── Kava ──────────────────────────────────────────────────────────────────
  // Axelar only
  "kava": {
    displayName:        "Kava",
    axelarName:         "kava",
    nativeToken:        "KAVA",
    axelarUsdcAddress:  "0xAa03872057AD496Bd6f3eE85b85e1e4DABdb1a5d",
    axelarTokenSymbol:  "aUSDC",
  },

  // ── Wormhole-only chains ──────────────────────────────────────────────────

  "injective": {
    displayName:  "Injective",
    wormholeName: "Injective",
    nativeToken:  "INJ",
  },

  "sui": {
    displayName:  "Sui",
    wormholeName: "Sui",
    nativeToken:  "SUI",
  },

  "aptos": {
    displayName:  "Aptos",
    wormholeName: "Aptos",
    nativeToken:  "APT",
  },

  "sei": {
    displayName:  "Sei",
    wormholeName: "Sei",
    nativeToken:  "SEI",
  },

  "kaia": {
    displayName:  "Kaia",
    wormholeName: "Kaia",
    nativeToken:  "KAIA",
  },

  "xlayer": {
    displayName:  "X Layer",
    wormholeName: "Xlayer",
    nativeToken:  "OKB",
  },

  "blast": {
    displayName:  "Blast",
    wormholeName: "Blast",
    nativeToken:  "ETH",
    isL2:         true,
  },

  "unichain-sepolia": {
    displayName:  "Unichain Sepolia",
    wormholeName: "Unichain",
    nativeToken:  "ETH",
    usdcAddress:  "0x31d0220469e10c4E71834a79b1f276d740d3768F",
    isL2:         true,
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Lookup helpers
// All accept any casing — normalize to lowercase before lookup.
// ─────────────────────────────────────────────────────────────────────────────

function normalize(chain: string): string {
  return chain.toLowerCase();
}

/** Full ChainInfo or undefined if unknown */
export function getChain(chain: string): ChainInfo | undefined {
  return CHAINS[normalize(chain)];
}

/** Axelar SDK chain name (e.g. "ethereum-sepolia", "Avalanche") */
export function toAxelarName(chain: string): string | undefined {
  return CHAINS[normalize(chain)]?.axelarName;
}

/** Wormhole SDK chain name (e.g. "Sepolia", "ArbitrumSepolia") */
export function toWormholeName(chain: string): string | undefined {
  return CHAINS[normalize(chain)]?.wormholeName;
}

/** Native gas token for the chain */
export function getNativeToken(chain: string): string {
  return CHAINS[normalize(chain)]?.nativeToken ?? "ETH";
}

/** USDC address on testnet, or undefined (Circle USDC — used by Wormhole) */
export function getUsdcAddress(chain: string): string | undefined {
  return CHAINS[normalize(chain)]?.usdcAddress;
}

/**
 * Axelar aUSDC contract address on this chain.
 * Used as `tokenAddress` in approve() before an Axelar transfer.
 * Different from Circle USDC — Axelar has its own wrapped representation.
 */
export function getAxelarUsdcAddress(chain: string): string | undefined {
  return CHAINS[normalize(chain)]?.axelarUsdcAddress;
}

/** True if chain is supported by Axelar AND has a deployed contract */
export function supportsAxelarWithContract(chain: string): boolean {
  const info = CHAINS[normalize(chain)];
  return !!info?.axelarName && !!info?.axelarContracts?.contractAddress;
}

/** True if chain is supported by Axelar (regardless of contract deployment) */
export function supportsAxelar(chain: string): boolean {
  return !!CHAINS[normalize(chain)]?.axelarName;
}

/** True if chain is supported by Wormhole WTT */
export function supportsWormhole(chain: string): boolean {
  return !!CHAINS[normalize(chain)]?.wormholeName;
}

/** True if both chains are reachable via Axelar */
export function axelarRouteExists(from: string, to: string): boolean {
  return supportsAxelar(from) && supportsAxelar(to);
}

/** True if both chains are reachable via Wormhole */
export function wormholeRouteExists(from: string, to: string): boolean {
  return supportsWormhole(from) && supportsWormhole(to);
}

/**
 * Canonical list of "hub" chains that both protocols support.
 * Used by RouteSelector for multi-hop path finding.
 * Ordered by liquidity / reliability preference.
 */
export const HUB_CHAINS: string[] = [
  "ethereum-sepolia",
  "avalanche",
  "polygon-sepolia",
  "arbitrum-sepolia",
  "optimism-sepolia",
  "base-sepolia",
];