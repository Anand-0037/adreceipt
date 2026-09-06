export interface PolicyInput { settlement: string; chainId: number; recipient: string; maxAmount: string; abi: unknown[]; }
export function buildSettlementPolicy(i: PolicyInput) {
  const condition = (field_source:string, field:string, operator:string, value:string|number, abi?:unknown[]) => ({ field_source, field, operator, value, ...(abi ? { abi } : {}) });
  return { name: "AdReceipt settlement only", version: "1.0", chain_type: "ethereum", rules: [{ name: "Allow bounded AdReceipt settlement", method: "eth_sendTransaction", action: "ALLOW", conditions: [
    condition("ethereum_transaction", "to", "eq", i.settlement), condition("ethereum_transaction", "chain_id", "eq", i.chainId),
    condition("ethereum_calldata", "function_name", "eq", "settlePlacement", i.abi),
    condition("ethereum_calldata", "settlePlacement.quote.recipient", "eq", i.recipient, i.abi),
    condition("ethereum_calldata", "settlePlacement.quote.amount", "lte", i.maxAmount, i.abi),
  ] }] };
}
