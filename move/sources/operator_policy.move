/// OperatorPolicy — the on-chain capability granting an AI agent autonomous
/// spending power, bounded by a budget, scope, expiry, and a kill switch.
///
/// Trust model: the AI is not trusted, the POLICY is trusted. The owner
/// creates a policy with a budget, allowed venues, max concentration, and
/// expiry. The agent address bound to the policy can call `record_spend`
/// in the same PTB as its actual trade — the call aborts on-chain if any
/// constraint is violated. The owner can revoke at any time; the next
/// agent action then fails on-chain (this is the demo's dramatic beat).
///
/// The policy is a SHARED object so both owner and agent can transact
/// against it. Authentication is by `tx_context::sender(ctx)` matched
/// against `policy.owner` or `policy.agent`.
module brief::operator_policy {
    use std::string::String;
    use sui::object::{Self, UID, ID};
    use sui::tx_context::{Self, TxContext};
    use sui::clock::{Self, Clock};
    use sui::event;
    use sui::transfer;

    // ----------------------------------------------------------------------
    // Errors
    // ----------------------------------------------------------------------

    const ENotOwner: u64 = 1;
    const ENotAgent: u64 = 2;
    const EPolicyRevoked: u64 = 3;
    const EPolicyExpired: u64 = 4;
    const EBudgetExceeded: u64 = 5;
    const EVenueNotAllowed: u64 = 6;
    const EInvalidConfig: u64 = 7;
    const ECannotShrink: u64 = 8;

    // ----------------------------------------------------------------------
    // Types
    // ----------------------------------------------------------------------

    /// The capability object granting an agent bounded autonomy.
    /// Shared so both owner and agent can transact against it.
    public struct OperatorPolicy has key, store {
        id: UID,
        /// Address that created the policy. Only this address can `revoke`
        /// or `extend`.
        owner: address,
        /// The agent's wallet that this policy authorizes. Only this
        /// address can `record_spend`.
        agent: address,
        /// Display name, e.g. "Conservative Yield Operator".
        name: String,
        /// Total budget in MIST (1 SUI = 1_000_000_000 MIST).
        budget_cap: u64,
        /// Currently-spent total in MIST. Bumped by `record_spend`.
        spent: u64,
        /// Allowed venue/protocol labels. Agent must call `record_spend`
        /// with a venue that's in this list.
        allowed_venues: vector<String>,
        /// Max single-position concentration in basis points (3000 = 30%).
        /// Informational on-chain; agent enforces by sizing its actions.
        max_concentration_bps: u16,
        /// Policy expires at this ms timestamp (unix epoch ms).
        expires_at_ms: u64,
        /// Actions below this percentage of remaining budget can be
        /// auto-executed; above this, the agent should mint a Proposal
        /// WorkObject and wait for an Approval. Informational on-chain.
        auto_approve_pct: u8,
        /// Risk tolerance label ("low" | "medium" | "high"). Informational.
        risk_tolerance: String,
        /// Once true, every `assert_can_spend` aborts. This is the kill
        /// switch — flipped by `revoke`.
        revoked: bool,
        /// Creation timestamp in ms.
        created_at_ms: u64,
    }

    // ----------------------------------------------------------------------
    // Events
    // ----------------------------------------------------------------------

    public struct PolicyCreated has copy, drop {
        id: ID,
        owner: address,
        agent: address,
        name: String,
        budget_cap: u64,
        expires_at_ms: u64,
        created_at_ms: u64,
    }

    public struct PolicySpend has copy, drop {
        policy_id: ID,
        agent: address,
        amount: u64,
        venue: String,
        new_spent: u64,
        ms: u64,
    }

    public struct PolicyRevoked has copy, drop {
        policy_id: ID,
        revoked_by: address,
        ms: u64,
    }

    public struct PolicyExtended has copy, drop {
        policy_id: ID,
        old_budget_cap: u64,
        new_budget_cap: u64,
        old_expires_at_ms: u64,
        new_expires_at_ms: u64,
        ms: u64,
    }

    // ----------------------------------------------------------------------
    // Create
    // ----------------------------------------------------------------------

    /// Create an OperatorPolicy as a SHARED object. Caller is the owner;
    /// the supplied `agent` address is the only address allowed to call
    /// `record_spend` against the resulting policy.
    public fun create(
        agent: address,
        name: String,
        budget_cap: u64,
        allowed_venues: vector<String>,
        max_concentration_bps: u16,
        expires_at_ms: u64,
        auto_approve_pct: u8,
        risk_tolerance: String,
        clock: &Clock,
        ctx: &mut TxContext,
    ): ID {
        assert!(budget_cap > 0, EInvalidConfig);
        assert!(!vector::is_empty(&allowed_venues), EInvalidConfig);
        assert!(max_concentration_bps > 0 && max_concentration_bps <= 10000, EInvalidConfig);
        assert!(auto_approve_pct <= 100, EInvalidConfig);

        let owner = tx_context::sender(ctx);
        let now = clock::timestamp_ms(clock);
        assert!(expires_at_ms > now, EInvalidConfig);

        let policy = OperatorPolicy {
            id: object::new(ctx),
            owner,
            agent,
            name,
            budget_cap,
            spent: 0,
            allowed_venues,
            max_concentration_bps,
            expires_at_ms,
            auto_approve_pct,
            risk_tolerance,
            revoked: false,
            created_at_ms: now,
        };

        let pid = object::id(&policy);

        event::emit(PolicyCreated {
            id: pid,
            owner,
            agent,
            name: policy.name,
            budget_cap,
            expires_at_ms,
            created_at_ms: now,
        });

        // Shared so both owner and agent can transact with it.
        transfer::public_share_object(policy);
        pid
    }

    // ----------------------------------------------------------------------
    // Enforcement — invoked by the agent in the same PTB as its trade
    // ----------------------------------------------------------------------

    /// Read-only check. Aborts if any of:
    ///   - sender != policy.agent (ENotAgent)
    ///   - policy.revoked (EPolicyRevoked)
    ///   - now >= policy.expires_at_ms (EPolicyExpired)
    ///   - spent + amount > budget_cap (EBudgetExceeded)
    ///   - venue not in allowed_venues (EVenueNotAllowed)
    public fun assert_can_spend(
        policy: &OperatorPolicy,
        amount: u64,
        venue: &String,
        clock: &Clock,
        ctx: &TxContext,
    ) {
        assert!(tx_context::sender(ctx) == policy.agent, ENotAgent);
        assert!(!policy.revoked, EPolicyRevoked);

        let now = clock::timestamp_ms(clock);
        assert!(now < policy.expires_at_ms, EPolicyExpired);

        assert!(policy.spent + amount <= policy.budget_cap, EBudgetExceeded);
        assert!(vector::contains(&policy.allowed_venues, venue), EVenueNotAllowed);
    }

    /// Mutating: run all `assert_can_spend` checks, then bump spent.
    /// Call this from the agent's PTB in the same transaction as the
    /// actual trade — a policy violation aborts the whole TX.
    public fun record_spend(
        policy: &mut OperatorPolicy,
        amount: u64,
        venue: String,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        assert_can_spend(policy, amount, &venue, clock, ctx);
        policy.spent = policy.spent + amount;

        event::emit(PolicySpend {
            policy_id: object::id(policy),
            agent: policy.agent,
            amount,
            venue,
            new_spent: policy.spent,
            ms: clock::timestamp_ms(clock),
        });
    }

    // ----------------------------------------------------------------------
    // Owner controls — revoke + extend (cannot shrink)
    // ----------------------------------------------------------------------

    /// THE kill switch. Owner-only. After this returns, every future
    /// `assert_can_spend` against this policy aborts with EPolicyRevoked.
    public fun revoke(
        policy: &mut OperatorPolicy,
        clock: &Clock,
        ctx: &TxContext,
    ) {
        assert!(tx_context::sender(ctx) == policy.owner, ENotOwner);
        policy.revoked = true;

        event::emit(PolicyRevoked {
            policy_id: object::id(policy),
            revoked_by: policy.owner,
            ms: clock::timestamp_ms(clock),
        });
    }

    /// Owner-only: raise budget and/or push expiry. Cannot shrink either —
    /// the safety guarantee for the agent is that the envelope only grows
    /// or stays the same (or gets revoked entirely).
    public fun extend(
        policy: &mut OperatorPolicy,
        new_budget_cap: u64,
        new_expires_at_ms: u64,
        clock: &Clock,
        ctx: &TxContext,
    ) {
        assert!(tx_context::sender(ctx) == policy.owner, ENotOwner);
        assert!(!policy.revoked, EPolicyRevoked);
        assert!(new_budget_cap >= policy.budget_cap, ECannotShrink);
        assert!(new_expires_at_ms >= policy.expires_at_ms, ECannotShrink);

        let old_budget = policy.budget_cap;
        let old_expiry = policy.expires_at_ms;
        policy.budget_cap = new_budget_cap;
        policy.expires_at_ms = new_expires_at_ms;

        event::emit(PolicyExtended {
            policy_id: object::id(policy),
            old_budget_cap: old_budget,
            new_budget_cap,
            old_expires_at_ms: old_expiry,
            new_expires_at_ms,
            ms: clock::timestamp_ms(clock),
        });
    }

    // ----------------------------------------------------------------------
    // Read accessors
    // ----------------------------------------------------------------------

    public fun owner(p: &OperatorPolicy): address { p.owner }
    public fun agent(p: &OperatorPolicy): address { p.agent }
    public fun name(p: &OperatorPolicy): &String { &p.name }
    public fun budget_cap(p: &OperatorPolicy): u64 { p.budget_cap }
    public fun spent(p: &OperatorPolicy): u64 { p.spent }
    public fun remaining(p: &OperatorPolicy): u64 {
        if (p.spent >= p.budget_cap) 0 else p.budget_cap - p.spent
    }
    public fun expires_at_ms(p: &OperatorPolicy): u64 { p.expires_at_ms }
    public fun revoked(p: &OperatorPolicy): bool { p.revoked }
    public fun risk_tolerance(p: &OperatorPolicy): &String { &p.risk_tolerance }
    public fun max_concentration_bps(p: &OperatorPolicy): u16 { p.max_concentration_bps }
    public fun auto_approve_pct(p: &OperatorPolicy): u8 { p.auto_approve_pct }
    public fun allowed_venues(p: &OperatorPolicy): &vector<String> { &p.allowed_venues }
    public fun created_at_ms(p: &OperatorPolicy): u64 { p.created_at_ms }
}
