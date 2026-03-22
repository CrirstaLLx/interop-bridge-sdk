import { ethers } from "ethers";
import { approveIfNeeded, ApproveParams } from "./approve";
import { GetBalanceParams, getTokenBalance } from "./balance";
import { estimateAxelarFee, EstimateAxelarFeeParams } from "./estimate";
import { axelarTransfer, AxelarTransferParams } from "./transfer";
import { recoverAxelarTransaction, RecoveryParams } from "./recovery";

export class AxelarBridge {
  constructor(private signer: ethers.Signer) {}

  approve(params: ApproveParams) {
    return approveIfNeeded(this.signer, params);
  }

  getBalance(params: GetBalanceParams) {
    return getTokenBalance(this.signer, params);
  }

  estimateFee(params: EstimateAxelarFeeParams) {
    return estimateAxelarFee(params);
  }

  transfer(params: AxelarTransferParams) {
    return axelarTransfer(this.signer, params);
  }

  recover(params: RecoveryParams) {
    return recoverAxelarTransaction(params);
  }
}