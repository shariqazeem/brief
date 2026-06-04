/// Settlement — atomic payment + consumption recording in one move call.
///
/// When a user wants to invoke an agent on a parent WorkObject:
///   1. Split `amount` MIST out of the user's SUI Coin
///   2. Transfer that split coin to the agent's address
///   3. Append the agent to the parent WorkObject's consumer list
///   4. Bump the agent's reputation
///   5. Emit a PaymentSettled event
///
/// All five steps happen in one transaction so payment + provenance can't
/// drift out of sync.
module brief::settlement {
    use sui::coin::{Self, Coin};
    use sui::sui::SUI;
    use sui::tx_context::TxContext;
    use sui::transfer;
    use sui::event;
    use sui::object::{Self, ID};

    use brief::work_object::{Self, WorkObject};
    use brief::agent_registry::{Self, AgentRegistration};

    // ----------------------------------------------------------------------
    // Errors
    // ----------------------------------------------------------------------

    const EInsufficientPayment: u64 = 1;

    // ----------------------------------------------------------------------
    // Events
    // ----------------------------------------------------------------------

    public struct PaymentSettled has copy, drop {
        work_object_id: ID,
        agent: address,
        amount: u64,
    }

    // ----------------------------------------------------------------------
    // Pay + record
    // ----------------------------------------------------------------------

    /// Pay an agent and atomically record consumption of the parent
    /// WorkObject. `amount` is in MIST (1 SUI = 1_000_000_000 MIST).
    ///
    /// The caller is whoever sends the transaction (typically the user
    /// who owns the parent WorkObject). Callers must pass a `Coin<SUI>`
    /// they can split from.
    public fun pay_agent_and_record(
        user_payment: &mut Coin<SUI>,
        agent_reg: &mut AgentRegistration,
        parent: &mut WorkObject,
        amount: u64,
        ctx: &mut TxContext,
    ) {
        assert!(coin::value(user_payment) >= amount, EInsufficientPayment);

        let fee = coin::split(user_payment, amount, ctx);
        let agent_addr = agent_registry::agent_address(agent_reg);

        transfer::public_transfer(fee, agent_addr);
        work_object::record_consumption(parent, agent_addr);
        agent_registry::bump_reputation(agent_reg, 1);

        event::emit(PaymentSettled {
            work_object_id: object::id(parent),
            agent: agent_addr,
            amount,
        });
    }
}
