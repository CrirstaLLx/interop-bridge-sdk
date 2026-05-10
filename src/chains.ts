// chains.ts — single source of truth for all chain metadata
//
// Canonical key: lowercase Axelar testnet name (e.g. "ethereum-sepolia").
// Chains that only exist in Wormhole use the lowercase Wormhole name as the
// key (e.g. "injective", "sui", "aptos").
//
// To add support for a new protocol:
//   1. Add a field to ChainInfo (e.g. layerzeroName?: string)
//   2. Add entries below
//   3. Add a supportsLayerZero() helper at the bottom

// ── Axelar contract addresses (testnet) ──────────────────────────────────────
// These are YOUR deployed Airdrop/Gateway contracts, one per chain.
// Chains without a deployed contract have contractAddress: undefined —
// BridgeSDK will skip Axelar for those routes until you deploy one.

export interface AxelarContracts {
  contractAddress?: string;
}

export interface ChainInfo {
  displayName:       string;
  axelarName?:       string;   // Axelar SDK chain name; undefined = not on Axelar
  wormholeName?:     string;   // Wormhole SDK chain name; undefined = not on Wormhole
  nativeToken:       string;
  usdcAddress?:      string;   // Circle USDC address (used by Wormhole)
  axelarUsdcAddress?: string;  // Axelar's own aUSDC address — different from Circle USDC
  axelarTokenSymbol?: string;  // always "aUSDC" on testnet
  isL2?:             boolean;  // some Axelar fee paths differ for L2s
  axelarContracts?:  AxelarContracts;
}

// ── Chain registry ────────────────────────────────────────────────────────────
// Key = canonical lowercase identifier (Axelar testnet name where available)

export const CHAINS: Record<string, ChainInfo> = {

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

  "avalanche": {
    displayName:        "Avalanche Fuji",
    axelarName:         "Avalanche",   // Axelar uses PascalCase for this one
    wormholeName:       "Avalanche",
    nativeToken:        "AVAX",
    usdcAddress:        "0x5425890298aed601595a70AB815c96711a31Bc65",
    axelarUsdcAddress:  "0x57F1c63497AEe0bE305B8852b354CEc793da43bB",
    axelarTokenSymbol:  "aUSDC",
  },

  "binance": {
    displayName:        "BNB Chain",
    axelarName:         "binance",
    wormholeName:       "Bsc",
    nativeToken:        "BNB",
    axelarUsdcAddress:  "0xc2fA98faB811B785b81c64Ac875b31CC9E40F9D2",
    axelarTokenSymbol:  "aUSDC",
  },

  "fantom": {
    displayName:        "Fantom",
    axelarName:         "Fantom",      // Axelar PascalCase
    wormholeName:       "Fantom",
    nativeToken:        "FTM",
    axelarUsdcAddress:  "0x75Cc4fDf1ee3E781C1A3Ee9151D5c6Ce34Cf5C61",
    axelarTokenSymbol:  "aUSDC",
  },

  "celo-sepolia": {
    displayName:        "Celo Alfajores",
    axelarName:         "celo-sepolia",
    wormholeName:       "Celo",
    nativeToken:        "CELO",
    usdcAddress:        "0x01C5C0122039549AD1493B8220cABEdD739BC44E",
    axelarUsdcAddress:  "0x254d06f33bDc5b8ee05b2ea472107E300226659A",
    axelarTokenSymbol:  "aUSDC",
  },

  "blast-sepolia": {
    displayName:        "Blast Sepolia",
    axelarName:         "blast-sepolia",
    wormholeName:       "Blast",
    nativeToken:        "ETH",
    axelarUsdcAddress:  "0x254d06f33bDc5b8ee05b2ea472107E300226659A",
    axelarTokenSymbol:  "aUSDC",
    isL2:               true,
  },

  "scroll": {
    displayName:        "Scroll",
    axelarName:         "scroll",
    wormholeName:       "Scroll",
    nativeToken:        "ETH",
    axelarUsdcAddress:  "0x254d06f33bDc5b8ee05b2ea472107E300226659A",
    axelarTokenSymbol:  "aUSDC",
    isL2:               true,
  },

  "mantle-sepolia": {
    displayName:        "Mantle Sepolia",
    axelarName:         "mantle-sepolia",
    wormholeName:       "Mantle",
    nativeToken:        "MNT",
    axelarUsdcAddress:  "0xAa03872057AD496Bd6f3eE85b85e1e4DABdb1a5d",
    axelarTokenSymbol:  "aUSDC",
    isL2:               true,
  },

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

  "moonbeam": {
    displayName:        "Moonbase Alpha",
    axelarName:         "Moonbeam",    // Axelar PascalCase
    wormholeName:       "Moonbeam",
    nativeToken:        "GLMR",
    axelarUsdcAddress:  "0xD1633F7Fb3d716643125d6415d4177bC36b7186b",
    axelarTokenSymbol:  "aUSDC",
  },

  // Axelar-only chains (no Wormhole support)

  "filecoin-2": {
    displayName:        "Filecoin Calibration",
    axelarName:         "filecoin-2",
    nativeToken:        "FIL",
    axelarUsdcAddress:  "0xCb7996d51Ff923b2C6076d42C065a6ca000D32A1",
    axelarTokenSymbol:  "aUSDC",
  },

  "fraxtal": {
    displayName:        "Fraxtal",
    axelarName:         "fraxtal",
    nativeToken:        "frxETH",
    axelarUsdcAddress:  "0x254d06f33bDc5b8ee05b2ea472107E300226659A",
    axelarTokenSymbol:  "aUSDC",
    isL2:               true,
  },

  "immutable": {
    displayName:        "Immutable zkEVM",
    axelarName:         "immutable",
    nativeToken:        "IMX",
    axelarUsdcAddress:  "0x254d06f33bDc5b8ee05b2ea472107E300226659A",
    axelarTokenSymbol:  "aUSDC",
    isL2:               true,
  },

  "kava": {
    displayName:        "Kava",
    axelarName:         "kava",
    nativeToken:        "KAVA",
    axelarUsdcAddress:  "0xAa03872057AD496Bd6f3eE85b85e1e4DABdb1a5d",
    axelarTokenSymbol:  "aUSDC",
  },

  // Wormhole-only chains

  "injective": { displayName: "Injective", wormholeName: "Injective", nativeToken: "INJ" },
  "sui":       { displayName: "Sui",       wormholeName: "Sui",       nativeToken: "SUI" },
  "aptos":     { displayName: "Aptos",     wormholeName: "Aptos",     nativeToken: "APT" },
  "sei":       { displayName: "Sei",       wormholeName: "Sei",       nativeToken: "SEI" },
  "kaia":      { displayName: "Kaia",      wormholeName: "Kaia",      nativeToken: "KAIA" },
  "xlayer":    { displayName: "X Layer",   wormholeName: "Xlayer",    nativeToken: "OKB" },

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

// ── Lookup helpers ────────────────────────────────────────────────────────────
// All accept any casing — normalize to lowercase before lookup.

function normalize(chain: string): string {
  return chain.toLowerCase();
}

export function getChain(chain: string): ChainInfo | undefined {
  return CHAINS[normalize(chain)];
}

export function toAxelarName(chain: string): string | undefined {
  return CHAINS[normalize(chain)]?.axelarName;
}

export function toWormholeName(chain: string): string | undefined {
  return CHAINS[normalize(chain)]?.wormholeName;
}

export function getNativeToken(chain: string): string {
  return CHAINS[normalize(chain)]?.nativeToken ?? "ETH";
}

/** Circle USDC address on testnet (used by Wormhole) */
export function getUsdcAddress(chain: string): string | undefined {
  return CHAINS[normalize(chain)]?.usdcAddress;
}

/** Axelar aUSDC address — used as tokenAddress in approve() before Axelar transfers.
 *  Not the same as Circle USDC; Axelar has its own wrapped representation per chain. */
export function getAxelarUsdcAddress(chain: string): string | undefined {
  return CHAINS[normalize(chain)]?.axelarUsdcAddress;
}

/** True if chain is on Axelar AND has a deployed contract (required for transfers) */
export function supportsAxelarWithContract(chain: string): boolean {
  const info = CHAINS[normalize(chain)];
  return !!info?.axelarName && !!info?.axelarContracts?.contractAddress;
}

export function supportsAxelar(chain: string): boolean {
  return !!CHAINS[normalize(chain)]?.axelarName;
}

export function supportsWormhole(chain: string): boolean {
  return !!CHAINS[normalize(chain)]?.wormholeName;
}

export function axelarRouteExists(from: string, to: string): boolean {
  return supportsAxelar(from) && supportsAxelar(to);
}

export function wormholeRouteExists(from: string, to: string): boolean {
  return supportsWormhole(from) && supportsWormhole(to);
}

// Hub chains are chains supported by both protocols.
// Used by BridgeSDK.findMultiHopPath() when no single protocol covers a route.
// Order matters — first match wins, so put most liquid/reliable hubs first.
export const HUB_CHAINS: string[] = [
  "ethereum-sepolia",
  "avalanche",
  "polygon-sepolia",
  "arbitrum-sepolia",
  "optimism-sepolia",
  "base-sepolia",
];