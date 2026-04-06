// ─────────────────────────────────────────────────────────────────────────────
// types.ts  –  Shared contracts for the Bridge SDK
// ─────────────────────────────────────────────────────────────────────────────

export interface TransferRequest {
  fromChain: string;
  toChain:   string;
  token:     string;
  amount:    string;
  decimals:  number;
  recipient?: string;
  extra?:    Record<string, unknown>;
}

export interface ChainCost {
  amount: string;
  token:  string;
  chain:  string;
}

export interface FeeEstimate {
  protocol:  string;

  /**
   * Total relay fee as a human-readable string.
   * For ExecutorTokenBridge: quote.relayFee.amount — the "Amount Paid" on Wormholescan.
   * For Axelar: relay fee from Axelar SDK.
   */
  fee:       string;
  feeToken:  string;

  /** Source chain gas cost (approve + initiateTransfer) */
  sourceCost?:      ChainCost;

  /** Destination relay fee — for ExecutorTokenBridge this equals relayFee from quote */
  destinationCost?: ChainCost;

  // 🔥 ExecutorTokenBridge specific — from estimateMsgValueAndGasLimit()
  executor?: {
    /** msgValue from estimateMsgValueAndGasLimit() — paid to executor on source chain */
    msgValue?: string;
    /** gasLimit for destination execution */
    gasLimit?: string;
  };

  raw?: unknown;
}

export interface TransferResult {
  protocol:      string;
  sourceTx:      string | string[];
  destinationTx?: string | string[] | null;
  mode:          "automatic" | "manual";
  raw?:          unknown;
}

export interface IBridgeAdapter {
  readonly protocolName: string;
  estimateFee(req: TransferRequest): Promise<FeeEstimate>;
  transfer(req: TransferRequest): Promise<TransferResult>;
}