// types.ts — shared contracts for the Bridge SDK

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

  // Total relay fee as a human-readable string.
  // ExecutorTokenBridge: quote.relayFee.amount — the "Amount Paid" on Wormholescan.
  // Axelar: relay fee from the Axelar SDK.
  fee:       string;
  feeToken:  string;

  sourceCost?:      ChainCost;  // source chain gas (approve + initiateTransfer)
  destinationCost?: ChainCost;  // relay fee paid to execute on destination

  // ExecutorTokenBridge only — from estimateMsgValueAndGasLimit()
  executor?: {
    msgValue?: string;  // paid to executor on source chain
    gasLimit?: string;  // gas limit for destination execution
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