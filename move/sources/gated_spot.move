/// Gated spot trading — the mainnet, non-custodial execution primitive.
///
/// Composes the OperatorPolicy budget gate with a DeepBook v3 spot market
/// order in ONE atomic call:
///
///   1. operator_policy::record_spend(...) — aborts the whole tx if the
///      owner revoked, the policy expired, the venue isn't allowed, or the
///      spend would exceed the budget cap. Bumps `spent` on success.
///   2. deepbook::pool::place_market_order(...) — the REAL order, placed
///      from the USER's own BalanceManager via a delegated TradeProof.
///
/// Atomicity is guaranteed by Move: if the policy gate aborts, no order is
/// placed; if the order aborts, the spend is rolled back. The operator
/// (policy.agent) holds only a delegated TradeCap — it can trade the user's
/// funds but never withdraw them (the user keeps the WithdrawCap). The chain
/// enforces the leash on real funds; the AI is never trusted.
///
/// This module is ADDITIVE — the testnet DeepBook Predict path
/// (operator_policy::record_spend inside the predict mint) is untouched.
module brief::gated_spot {
    use std::string::String;
    use sui::clock::Clock;
    use sui::tx_context::TxContext;

    use deepbook::pool::{Self, Pool};
    use deepbook::balance_manager::{BalanceManager, TradeProof};

    use brief::operator_policy::{Self, OperatorPolicy};

    /// Policy-gated DeepBook v3 spot MARKET order.
    ///
    /// `amount` / `venue` are the budget units + venue label recorded
    /// against the policy (e.g. "spot-sui"); they must satisfy the policy or
    /// the call aborts. `quantity` is in base-asset terms (DeepBook scaling).
    /// `trade_proof` must be generated in THIS tx from the BalanceManager
    /// (as owner, or as trader via the delegated TradeCap). Signed by
    /// policy.agent — asserted inside record_spend.
    public fun gated_spot_market_order<Base, Quote>(
        policy: &mut OperatorPolicy,
        amount: u64,
        venue: String,
        pool: &mut Pool<Base, Quote>,
        balance_manager: &mut BalanceManager,
        trade_proof: &TradeProof,
        client_order_id: u64,
        self_matching_option: u8,
        quantity: u64,
        is_bid: bool,
        pay_with_deep: bool,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        // 1) Chain-enforced leash — aborts on revoke / expiry / over-budget
        //    / disallowed venue, and asserts sender == policy.agent.
        operator_policy::record_spend(policy, amount, venue, clock, ctx);

        // 2) The real order, atomic with the spend. OrderInfo has `drop`,
        //    so we let it go (any unfilled quantity is cancelled by the
        //    market-order semantics).
        let _order = pool::place_market_order<Base, Quote>(
            pool,
            balance_manager,
            trade_proof,
            client_order_id,
            self_matching_option,
            quantity,
            is_bid,
            pay_with_deep,
            clock,
            ctx,
        );
    }
}
