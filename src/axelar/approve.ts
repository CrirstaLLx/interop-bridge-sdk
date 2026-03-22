import { ethers } from "ethers";

export interface ApproveParams {
  tokenAddress: string;     // aUSDC token on source network
  contractAddress: string;  // Airdrop contract address on source network
  amountToSend: string;     // napr. "0.01"
  approveAmount: string;    // napr. "2"
  decimals: number;         // napr. 6 for USDC
}

export async function approveIfNeeded(
  signer: ethers.Signer,
  params: ApproveParams
): Promise<{
  approved: boolean;
  txHash?: string;
  currentAllowance: string;
}> {
  const { tokenAddress, contractAddress, amountToSend, approveAmount, decimals } = params;

  const token = new ethers.Contract(
    tokenAddress,
    [
      "function allowance(address owner, address spender) view returns (uint256)",
      "function approve(address spender, uint256 amount) returns (bool)"
    ],
    signer
  );

  const owner = await signer.getAddress();

  const parsedAmountToSend = ethers.parseUnits(amountToSend, decimals);
  const parsedApproveAmount = ethers.parseUnits(approveAmount, decimals);

  const allowance = await token.allowance(owner, contractAddress);

  if (allowance < parsedAmountToSend) {
    const tx = await token.approve(contractAddress, parsedApproveAmount);
    await tx.wait();

    return {
      approved: true,
      txHash: tx.hash,
      currentAllowance: ethers.formatUnits(parsedApproveAmount, decimals)
    };
  }

  return {
    approved: false,
    currentAllowance: ethers.formatUnits(allowance, decimals)
  };
}