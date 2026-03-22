import { ethers } from "ethers";

export interface AxelarTransferParams {
  sourceContractAddress: string;
  destinationChain: string;
  destinationContractAddress: string;

  tokenSymbol: string;
  amount: string;
  decimals: number;

  gasFee: string; // ETH amount (napr. "0.01")
  recipients?: string[];
}

export async function axelarTransfer(
  signer: ethers.Signer,
  params: AxelarTransferParams
): Promise<{
  txHash: string;
}> {
  const {
    sourceContractAddress,
    destinationChain,
    destinationContractAddress,
    tokenSymbol,
    amount,
    decimals,
    gasFee,
    recipients
  } = params;

  const contract = new ethers.Contract(
    sourceContractAddress,
    [
      "function sendToMany(string destinationChain, string destinationAddress, address[] recipients, string symbol, uint256 amount) payable"
    ],
    signer
  );

  const senderAddress = await signer.getAddress();

  const finalRecipients = recipients || [senderAddress];

  const parsedAmount = ethers.parseUnits(amount, decimals);
  const parsedGasFee = ethers.parseEther(gasFee);

  const tx = await contract.sendToMany(
    destinationChain,
    destinationContractAddress,
    finalRecipients,
    tokenSymbol,
    parsedAmount,
    {
      value: parsedGasFee
    }
  );

  await tx.wait();

  return {
    txHash: tx.hash
  };
}