/// AgentRegistry — public catalog of agents available on Brief.
///
/// Agents register themselves by publishing an AgentRegistration. The
/// registration declares:
///   - what input WorkObject types the agent can consume
///   - what output WorkObject types the agent produces
///   - the agent's off-chain endpoint URL
///   - the agent's base price per call (in MIST, the SUI sub-unit)
///   - the agent's reputation score (accrued via settled payments)
///
/// Each registration is a *shared* Sui object — readable by anyone, but
/// only the registered `agent_address` can mutate it.
module brief::agent_registry {
    use std::string::String;
    use sui::object::{Self, UID};
    use sui::tx_context::{Self, TxContext};
    use sui::transfer;
    use sui::event;

    // ----------------------------------------------------------------------
    // Errors
    // ----------------------------------------------------------------------

    const ENotAgentOwner: u64 = 1;

    // ----------------------------------------------------------------------
    // Types
    // ----------------------------------------------------------------------

    public struct AgentRegistration has key {
        id: UID,
        agent_address: address,
        display_name: String,
        capabilities: vector<String>,
        accepts_object_types: vector<String>,
        produces_object_types: vector<String>,
        base_price_per_call: u64,
        endpoint_url: String,
        /// Walrus blob id holding the agent's long-form portfolio / bio.
        /// Empty string when no extended bio has been published.
        bio_blob: String,
        // -- Reputation fields, bumped only via package-internal calls
        // -- from `settlement` or `task` modules.
        /// Count of approved task settlements.
        completed_tasks: u64,
        /// Lifetime total paid out, in MIST.
        total_paid: u64,
        /// Last settlement timestamp.
        last_settled_ms: u64,
        /// Legacy aggregate score — kept for the existing settlement module
        /// and any client UI that already reads it.
        reputation_score: u64,
        registered_at_ms: u64,
    }

    // ----------------------------------------------------------------------
    // Events
    // ----------------------------------------------------------------------

    public struct AgentRegistered has copy, drop {
        agent_address: address,
        display_name: String,
        registered_at_ms: u64,
    }

    public struct AgentUpdated has copy, drop {
        agent_address: address,
    }

    // ----------------------------------------------------------------------
    // Register
    // ----------------------------------------------------------------------

    /// Register a new agent. The caller becomes the agent_address. Creates
    /// a shared AgentRegistration object.
    public fun register(
        display_name: String,
        capabilities: vector<String>,
        accepts_object_types: vector<String>,
        produces_object_types: vector<String>,
        base_price_per_call: u64,
        endpoint_url: String,
        bio_blob: String,
        ctx: &mut TxContext,
    ) {
        let agent = tx_context::sender(ctx);
        let now = tx_context::epoch_timestamp_ms(ctx);

        let reg = AgentRegistration {
            id: object::new(ctx),
            agent_address: agent,
            display_name,
            capabilities,
            accepts_object_types,
            produces_object_types,
            base_price_per_call,
            endpoint_url,
            bio_blob,
            completed_tasks: 0,
            total_paid: 0,
            last_settled_ms: 0,
            reputation_score: 0,
            registered_at_ms: now,
        };

        event::emit(AgentRegistered {
            agent_address: agent,
            display_name: reg.display_name,
            registered_at_ms: now,
        });

        transfer::share_object(reg);
    }

    // ----------------------------------------------------------------------
    // Update
    // ----------------------------------------------------------------------

    /// Update capabilities / pricing / endpoint / bio blob. Only the
    /// registered `agent_address` can mutate.
    public fun update(
        reg: &mut AgentRegistration,
        capabilities: vector<String>,
        accepts_object_types: vector<String>,
        produces_object_types: vector<String>,
        base_price_per_call: u64,
        endpoint_url: String,
        bio_blob: String,
        ctx: &mut TxContext,
    ) {
        assert!(tx_context::sender(ctx) == reg.agent_address, ENotAgentOwner);

        reg.capabilities = capabilities;
        reg.accepts_object_types = accepts_object_types;
        reg.produces_object_types = produces_object_types;
        reg.base_price_per_call = base_price_per_call;
        reg.endpoint_url = endpoint_url;
        reg.bio_blob = bio_blob;

        event::emit(AgentUpdated { agent_address: reg.agent_address });
    }

    // ----------------------------------------------------------------------
    // Reputation (package-internal — bumped only via settled task payments)
    // ----------------------------------------------------------------------

    /// Legacy hook used by the existing `settlement::pay_agent_and_record`
    /// flow. Increments the aggregate score by `delta`. Kept so previously
    /// published modules continue to compile.
    public(package) fun bump_reputation(
        reg: &mut AgentRegistration,
        delta: u64,
    ) {
        reg.reputation_score = reg.reputation_score + delta;
    }

    /// Task settlement hook. Called by `brief::task::approve_*` after the
    /// bounty has been escrowed and the policy check (if any) has cleared.
    /// Updates the structured reputation fields and bumps the legacy
    /// aggregate so consumers of either surface stay in sync.
    public(package) fun settle_reputation_bump(
        reg: &mut AgentRegistration,
        amount_paid: u64,
        now_ms: u64,
    ) {
        reg.completed_tasks = reg.completed_tasks + 1;
        reg.total_paid = reg.total_paid + amount_paid;
        reg.last_settled_ms = now_ms;
        reg.reputation_score = reg.reputation_score + 1;
    }

    // ----------------------------------------------------------------------
    // Accessors
    // ----------------------------------------------------------------------

    public fun agent_address(reg: &AgentRegistration): address {
        reg.agent_address
    }

    public fun base_price(reg: &AgentRegistration): u64 {
        reg.base_price_per_call
    }

    public fun reputation(reg: &AgentRegistration): u64 {
        reg.reputation_score
    }

    public fun produces(reg: &AgentRegistration): &vector<String> {
        &reg.produces_object_types
    }

    public fun accepts(reg: &AgentRegistration): &vector<String> {
        &reg.accepts_object_types
    }

    public fun capabilities(reg: &AgentRegistration): &vector<String> {
        &reg.capabilities
    }

    public fun bio_blob(reg: &AgentRegistration): &String {
        &reg.bio_blob
    }

    public fun completed_tasks(reg: &AgentRegistration): u64 {
        reg.completed_tasks
    }

    public fun total_paid(reg: &AgentRegistration): u64 {
        reg.total_paid
    }

    public fun last_settled_ms(reg: &AgentRegistration): u64 {
        reg.last_settled_ms
    }
}
