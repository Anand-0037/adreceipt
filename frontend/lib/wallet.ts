"use client";

import { BrowserProvider, Contract, formatEther, formatUnits, type Eip1193Provider } from "ethers";

/**
 * Browser wallet access.
 *
 * Uses the injected EIP-1193 provider rather than Privy for now: a Privy
 * embedded wallet needs an app id we do not have yet, and the flow should not
 * be blocked on a credential. `connect()` is the only thing that would change
 * when Privy lands - everything downstream takes a signer and does not care
 * where it came from.
 */

export const SEPOLIA_CHAIN_ID = BigInt(11155111);
export const SEPOLIA_HEX = "0xaa36a7";

export const ADVERTISER_REGISTRY = "0xcE99a9ee7DD1af77e47036fe679fd1aDfFf2F8ac";
export const USDC = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";

const REGISTRY_ABI = [
  "function register(string name, string domain) returns (bytes32)",
  "function getAdvertiser(address advertiser) view returns (tuple(string name, string domain, bytes32 challenge, uint64 registeredAt, uint64 verifiedAt, uint8 status))",
  "error AlreadyRegistered()",
  "error InvalidNameCharacter(uint256 index, bytes1 character)",
  "error InvalidDomainCharacter(uint256 index, bytes1 character)",
  "error MalformedDomain()",
  "error MalformedName()",
  "error NameTooLong(uint256 length, uint256 maximum)",
  "error DomainTooLong(uint256 length, uint256 maximum)",
] as const;

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
    // Registration is one transaction; 0.0005 ETH is comfortably above its cost.
    hasGas: native > BigInt("500000000000000"),
    hasUsdc: usdc > BigInt(0),
  };
}

/** Register a claim from the connected wallet. The claim starts unverified. */
export async function registerAdvertiser(name: string, domain: string): Promise<string> {
  const eth = injected();
  if (!eth) throw new Error("No wallet");
  const signer = await new BrowserProvider(eth).getSigner();
  const registry = new Contract(ADVERTISER_REGISTRY, REGISTRY_ABI as unknown as string[], signer);

  const tx = await registry.register(name, domain);
  const receipt = await tx.wait();
  return receipt.hash as string;
}

/** Turn a revert into something the person filling in the form can act on. */
export function describeWalletError(error: unknown): string {
  const e = error as { revert?: { name?: string }; shortMessage?: string; message?: string };
  const name = e?.revert?.name;

  const known: Record<string, string> = {
    AlreadyRegistered: "This wallet already has a claim. Each wallet may hold one.",
    InvalidNameCharacter:
      "The brand name must be plain ASCII. Lookalike characters are rejected so a name cannot imitate another.",
    InvalidDomainCharacter: "The domain may only contain letters, digits, hyphens and dots.",
    MalformedDomain: "That domain is not well formed — check for a trailing dot or a doubled dot.",
    MalformedName: "Remove leading, trailing or doubled spaces from the name.",
    NameTooLong: "The brand name is longer than 64 characters.",
    DomainTooLong: "The domain is longer than 253 characters.",
  };

  if (name && known[name]) return known[name];
  const message = e?.shortMessage ?? e?.message ?? String(error);
  if (/user rejected/i.test(message)) return "You rejected the request in your wallet.";
  return message;
}
