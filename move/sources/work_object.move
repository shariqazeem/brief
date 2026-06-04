/// WorkObject — the unit of agent-produced output in Brief.
///
/// Every output any agent produces is a WorkObject. WorkObjects:
///   - are owned by an address (the user, initially the agent's invoker)
///   - carry typed payloads (inline u8 vector, or Walrus blob id for large)
///   - reference their parent WorkObjects (lineage graph)
///   - record which agents have consumed them (append-only)
///   - record the SUI fee paid to the producing agent
module brief::work_object {
    use std::string::String;
    use std::option::{Self, Option};
    use sui::object::{Self, UID, ID};
    use sui::tx_context::{Self, TxContext};
    use sui::vec_map::{Self, VecMap};
    use sui::event;
    use sui::transfer;

    // ----------------------------------------------------------------------
    // Errors
    // ----------------------------------------------------------------------

    const EEmptyPayload: u64 = 1;
    const EAlreadyConsumed: u64 = 2;

    // ----------------------------------------------------------------------
    // Types
    // ----------------------------------------------------------------------

    /// The core work object. `has key, store` means it is a top-level owned
    /// object and may be wrapped inside other objects.
    public struct WorkObject has key, store {
        id: UID,
        /// "Query" | "Research" | "Strategy" | "Execution" | user-defined.
        object_type: String,
        /// Schema version — agents inspect this before deserializing payload.
        schema_version: u64,
        /// Serialized payload (JSON or BCS). Small payloads inline; large
        /// ones stored on Walrus with `walrus_blob_id` set instead.
        payload: vector<u8>,
        /// Optional Walrus blob id when payload is offloaded.
        walrus_blob_id: Option<String>,
        /// IDs of WorkObjects this was derived from. Empty for root objects
        /// like the initial Query.
        parent_objects: vector<ID>,
        /// The agent address that minted this object.
        producer_agent: address,
        /// Append-only list of agent addresses that have consumed this
        /// object as input.
        consumer_agents: vector<address>,
        /// Approximate ms timestamp (Sui epoch start ms; not wall-clock-precise
        /// but good enough for ordering and demo).
        timestamp_ms: u64,
        /// SUI MIST paid to producer at mint time.
        payment_amount: u64,
        /// Extensible string -> string metadata bag.
        metadata: VecMap<String, String>,
    }

    // ----------------------------------------------------------------------
    // Events — off-chain agents subscribe to these to discover work
    // ----------------------------------------------------------------------

    public struct WorkObjectMinted has copy, drop {
        id: ID,
        object_type: String,
        producer: address,
        owner: address,
        parent_objects: vector<ID>,
        payment_amount: u64,
        timestamp_ms: u64,
    }

    public struct WorkObjectConsumed has copy, drop {
        id: ID,
        consumer: address,
    }

    // ----------------------------------------------------------------------
    // Public mint
    // ----------------------------------------------------------------------

    /// Mint a new WorkObject. The producer is the transaction sender.
    /// The new object is transferred to `owner` (typically the user who
    /// initiated the chain). Returns the new object's ID for PTB composition.
    public fun mint(
        owner: address,
        object_type: String,
        schema_version: u64,
        payload: vector<u8>,
        walrus_blob_id: Option<String>,
        parent_objects: vector<ID>,
        payment_amount: u64,
        ctx: &mut TxContext,
    ): ID {
        let has_inline = !vector::is_empty(&payload);
        let has_blob = option::is_some(&walrus_blob_id);
        assert!(has_inline || has_blob, EEmptyPayload);

        let producer = tx_context::sender(ctx);
        let now = tx_context::epoch_timestamp_ms(ctx);

        let obj = WorkObject {
            id: object::new(ctx),
            object_type,
            schema_version,
            payload,
            walrus_blob_id,
            parent_objects,
            producer_agent: producer,
            consumer_agents: vector[],
            timestamp_ms: now,
            payment_amount,
            metadata: vec_map::empty(),
        };

        let obj_id = object::id(&obj);

        event::emit(WorkObjectMinted {
            id: obj_id,
            object_type: obj.object_type,
            producer,
            owner,
            parent_objects: obj.parent_objects,
            payment_amount,
            timestamp_ms: now,
        });

        transfer::public_transfer(obj, owner);
        obj_id
    }

    // ----------------------------------------------------------------------
    // Consumption tracking — called by settlement.move
    // ----------------------------------------------------------------------

    /// Record that an agent has consumed this WorkObject as input.
    /// Append-only. Aborts if the consumer is already recorded.
    ///
    /// Restricted to other modules in this package (specifically
    /// `brief::settlement`). External callers cannot mark consumption
    /// directly — they must go through settlement, which atomically
    /// transfers payment.
    public(package) fun record_consumption(
        obj: &mut WorkObject,
        consumer: address,
    ) {
        assert!(!vector::contains(&obj.consumer_agents, &consumer), EAlreadyConsumed);
        vector::push_back(&mut obj.consumer_agents, consumer);

        event::emit(WorkObjectConsumed {
            id: object::id(obj),
            consumer,
        });
    }

    // ----------------------------------------------------------------------
    // Read accessors
    // ----------------------------------------------------------------------

    public fun parents(obj: &WorkObject): &vector<ID> {
        &obj.parent_objects
    }

    public fun producer(obj: &WorkObject): address {
        obj.producer_agent
    }

    public fun object_type(obj: &WorkObject): &String {
        &obj.object_type
    }

    public fun timestamp_ms(obj: &WorkObject): u64 {
        obj.timestamp_ms
    }

    public fun consumer_count(obj: &WorkObject): u64 {
        vector::length(&obj.consumer_agents)
    }
}
