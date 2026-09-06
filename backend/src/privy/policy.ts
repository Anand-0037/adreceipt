export interface PolicyInput {
  settlement: string;
  asset: string;
  chainId: number;
  recipient: string;
  maxAmount: string;
  abi: unknown[];
}

const APPROVE_ABI = [{
  inputs: [
    { internalType: "address", name: "spender", type: "address" },
    { internalType: "uint256", name: "amount", type: "uint256" },
  ],
  name: "approve",
  outputs: [{ internalType: "bool", name: "", type: "bool" }],
  stateMutability: "nonpayable",
  type: "function",
}];

export function buildSettlementPolicy(i: PolicyInput) {
  const settlementAbi = i.abi.filter((entry) => {
    if (typeof entry !== "object" || entry === null) return false;
    const item = entry as { type?: unknown; name?: unknown };
    return item.type === "function" && item.name === "settlePlacement";
  });
  if (settlementAbi.length !== 1) {
    throw new Error("Settlement ABI must contain exactly one settlePlacement function");
  }

  const condition = (
    field_source: string,
    field: string,
    operator: string,
    value: string | number,
    abi?: unknown[],
  ) => ({ field_source, field, operator, value, ...(abi ? { abi } : {}) });

  return {
    name: "AdReceipt settlement only",
    version: "1.0",
    chain_type: "ethereum",
    rules: [
      {
        name: "Allow bounded USDC approval",
        method: "eth_sendTransaction",
        action: "ALLOW",
        conditions: [
          condition("ethereum_transaction", "to", "eq", i.asset),
          condition("ethereum_transaction", "chain_id", "eq", String(i.chainId)),
          condition("ethereum_calldata", "function_name", "eq", "approve", APPROVE_ABI),
          condition("ethereum_calldata", "approve.spender", "eq", i.settlement, APPROVE_ABI),
          condition("ethereum_calldata", "approve.amount", "lte", i.maxAmount, APPROVE_ABI),
        ],
      },
      {
        name: "Allow bounded AdReceipt settlement",
        method: "eth_sendTransaction",
        action: "ALLOW",
        conditions: [
          condition("ethereum_transaction", "to", "eq", i.settlement),
          condition("ethereum_transaction", "chain_id", "eq", String(i.chainId)),
          condition("ethereum_calldata", "function_name", "eq", "settlePlacement", settlementAbi),
          condition("ethereum_calldata", "settlePlacement.quote.recipient", "eq", i.recipient, settlementAbi),
          condition("ethereum_calldata", "settlePlacement.quote.amount", "lte", i.maxAmount, settlementAbi),
        ],
      },
    ],
  };
}
