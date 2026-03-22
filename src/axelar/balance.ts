import { ethers } from "ethers";

export interface GetBalanceParams {
  tokenAddress: string; // aUSDC token adress on the source chain
  address?: string;     // optional → default signer address
  decimals?: number;    // optional → ak chceš formatted output
}

export async function getTokenBalance(
  signer: ethers.Signer,
  params: GetBalanceParams
): Promise<{
  raw: string;
  formatted?: string;
}> {
  const { tokenAddress, address, decimals } = params;

  const token = new ethers.Contract(
    tokenAddress,
    [
      "function balanceOf(address account) view returns (uint256)"
    ],
    signer
  );

  const targetAddress = address || (await signer.getAddress());

  const balance = await token.balanceOf(targetAddress);

  return {
    raw: balance.toString(),
    formatted: decimals !== undefined
      ? ethers.formatUnits(balance, decimals)
      : undefined
  };
}