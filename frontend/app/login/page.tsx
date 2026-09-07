import type { Metadata } from "next";
import { WalletOnboard } from "@/components/WalletOnboard";

export const metadata: Metadata = {
  title: "Sign in — AdReceipt",
  description: "Connect the wallet you already use for AdReceipt. No accounts, no passwords.",
};

export default function Page() {
  return <WalletOnboard mode="login" />;
}
