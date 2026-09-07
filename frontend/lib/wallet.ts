"use client";

import { BrowserProvider, Contract, formatEther, formatUnits, type Eip1193Provider } from "ethers";
import { protocol } from "./protocol";

/**
 * Browser wallet access.
 *
 * The public publisher and payer tools accept any injected EIP-1193 wallet.
 * The project's automated settlement proof uses the separately configured
 * Privy server wallet and its bounded, default-deny policy.
 */

export const SEPOLIA_CHAIN_ID = BigInt(protocol.chainId);
export const SEPOLIA_HEX = "0xaa36a7";

export const USDC = protocol.asset;

const ERC20_ABI = ["function balanceOf(address) view returns (uint256)"] as const;

interface InjectedProvider extends Eip1193Provider {
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
}

export function injected(): InjectedProvider | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { ethereum?: InjectedProvider }).ethereum;
}

export function hasWallet(): boolean {
  return Boolean(injected());
}

/** Connect, and make sure we are on Sepolia before anything is signed. */
export async function connect(): Promise<{ address: string; chainId: bigint }> {
  const eth = injected();
  if (!eth) throw new Error("No browser wallet found. Install MetaMask, or use a wallet browser.");

  await eth.request({ method: "eth_requestAccounts" });
  const provider = new BrowserProvider(eth);
  let network = await provider.getNetwork();

  if (network.chainId !== SEPOLIA_CHAIN_ID) {
    try {
      await eth.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: SEPOLIA_HEX }],
      });
    } catch {
      throw new Error("This wallet is not on Sepolia. Switch networks and try again.");
    }
    network = await new BrowserProvider(eth).getNetwork();
  }

  const signer = await new BrowserProvider(eth).getSigner();
  return { address: await signer.getAddress(), chainId: network.chainId };
}

export async function currentAccount(): Promise<string | null> {
  const eth = injected();
  if (!eth) return null;
  try {
    const accounts = (await eth.request({ method: "eth_accounts" })) as string[];
    return accounts?.[0] ?? null;
  } catch {
    return null;
  }
}

export interface Balances {
  eth: string;
  usdc: string;
  hasGas: boolean;
  hasUsdc: boolean;
}

export async function balances(address: string): Promise<Balances> {
  const eth = injected();
  if (!eth) throw new Error("No wallet");
  const provider = new BrowserProvider(eth);

  const native = await provider.getBalance(address);
  const token = new Contract(USDC, ERC20_ABI as unknown as string[], provider);
  const usdc = (await token.balanceOf(address)) as bigint;

  return {
    eth: formatEther(native),
    usdc: formatUnits(usdc, 6),
    // Approval plus settlement need gas; this is only a readiness hint.
    hasGas: native > BigInt("500000000000000"),
    hasUsdc: usdc > BigInt(0),
  };
}

/** Turn a wallet error into something the person can act on. */
export function describeWalletError(error: unknown): string {
  const e = error as { revert?: { name?: string }; shortMessage?: string; message?: string };
  const name = e?.revert?.name;

  const known: Record<string, string> = {};

  if (name && known[name]) return known[name];
  const message = e?.shortMessage ?? e?.message ?? String(error);
  if (/user rejected/i.test(message)) return "You rejected the request in your wallet.";
  return message;
}
