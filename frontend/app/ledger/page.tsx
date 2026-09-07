import { Ledger } from "@/components/Ledger";

export const metadata = {
  title: "Ledger · AdReceipt",
  description: "Every settled sponsorship: who paid whom, how much, and for which recommendation.",
};

export default function LedgerPage() {
  return (
    <div className="page-stack">
      <section className="intro compact-intro">
        <p className="eyebrow">Public record</p>
        <h1>Who sponsored what, and for how much.</h1>
        <p>
          Every payment made through AdReceipt appears here automatically. There is no reporting
          step to skip and no line item anyone can leave out — the ledger is the payments
          themselves, read back from the chain.
        </p>
      </section>
      <Ledger />
    </div>
  );
}
