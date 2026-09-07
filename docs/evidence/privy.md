# Privy integration evidence

Privy controls the organization payer used for AdReceipt's first live testnet settlement. The
wallet has a default-deny policy with two bounded actions on Ethereum Sepolia:

1. Approve the deployed `PlacementSettlementV1` contract to spend at most 1 test USDC.
2. Call the exact `settlePlacement` function for the configured recipient with a payment of at most
   1 test USDC.

The provider rejected a disallowed signing request. The same policy then allowed the bounded
approval and the 0.1 test-USDC settlement:

- Payer: `0x84B5711b5Ff458478A2E55bb4797F5b254517a57`
- Approval transaction: [`0xdef5…5bd3`](https://sepolia.etherscan.io/tx/0xdef5ba01d21df8b9c817a330f0e3e16f5dc0482e39f19531d8b32bb1fb655bd3)
- Settlement transaction: [`0x29d0…db28`](https://sepolia.etherscan.io/tx/0x29d0f2cb187f8c33d06329dd90f59dcd82b346c62c701cce53f37253cb69db28)
- Receipt: `0xa63f1ce97fc2c2d97bb31f51e2f0989560d89937900d93fe36f303122d70f9cd`

The public API is read-only and receives no Privy credentials. Transaction submission remains in
operator-controlled scripts so a website visitor cannot spend from the organization wallet.

This proves one provider-allowed and one provider-rejected policy path with a team-controlled
testnet payer and recipient. It does not prove production custody, independent customer use, or a
multi-person quorum.
