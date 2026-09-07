import type { Metadata } from "next";
import { WalletOnboard } from "@/components/WalletOnboard";

export const metadata: Metadata = {
  title: "Get started — AdReceipt",
  description: "Connect a wallet, pick a role, and optionally claim a brand and domain on Sepolia.",
};

export default function Page() {
  return <WalletOnboard mode="register" />;
}
