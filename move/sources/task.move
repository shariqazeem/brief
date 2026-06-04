/// Task — a direct-assigned unit of work in Brief's Autonomous Workforce.
///
/// Posting model: the poster names exactly one agent address (`assigned_to`)
/// and a required capability label. No bidding, no matching, no marketplace
/// search. The Planner agent (or a user) decides who's doing the work and
/// posts the Task with bounty escrowed in SUI.
///
/// Lifecycle:
///   open (posted, assigned) → accepted → delivered → approved | expired
///
/// Settlement is atomic with policy enforcement when the poster is operating
/// under an OperatorPolicy: `approve_with_policy` runs `record_spend` on the
/// policy in the same PTB as the bounty transfer. If the policy is revoked
/// 200ms before approval lands, the entire approve aborts on-chain and the
/// bounty stays escrowed for the poster to recover via `expire` later.
///
/// Receipt WorkObjects are minted off-module in the PTB the agent composes
/// (parented to the Deliverable WorkObject). This module emits TaskApproved
/// with the deliverable_id so off-chain code can wire that up.
module brief::task {
    use std::string::String;
    use std::option::{Self, Option};
    use sui::object::{Self, UID, ID};
    use sui::tx_context::{Self, TxContext};
    use sui::clock::{Self, Clock};
    use sui::balance::{Self, Balance};
    use sui::coin::{Self, Coin};
    use sui::sui::SUI;
    use sui::event;
    use sui::transfer;

    use brief::operator_policy::{Self, OperatorPolicy};
    use brief::agent_registry::{Self, AgentRegistration};

    // ----------------------------------------------------------------------
    // State machine (u8 status codes)
    // ----------------------------------------------------------------------

    const STATUS_OPEN: u8 = 0;        // posted + assigned, not yet accepted
    const STATUS_ACCEPTED: u8 = 1;    // assigned agent has claimed it
    const STATUS_DELIVERED: u8 = 2;   // deliverable WorkObject submitted
    const STATUS_APPROVED: u8 = 3;    // settled — bounty paid, reputation bumped
    const STATUS_EXPIRED: u8 = 4;     // deadline passed without approval

    // ----------------------------------------------------------------------
    // Errors
    // ----------------------------------------------------------------------

    const ENotPoster: u64 = 1;
    const ENotAssignedAgent: u64 = 2;
    const EWrongStatus: u64 = 3;
    const EDeadlinePassed: u64 = 4;
    const EDeadlineNotReached: u64 = 5;
    const EInvalidConfig: u64 = 6;
    const EAgentMismatch: u64 = 7;
    const EPolicyMismatch: u64 = 8;
    const EPolicyRequired: u64 = 9;
    const EPolicyNotAllowed: u64 = 10;

    // ----------------------------------------------------------------------
    // Types
    // ----------------------------------------------------------------------

    /// A direct-assigned task with escrowed bounty. Shared so both the
    /// poster and the assigned agent can transact against it.
    public struct Task has key {
        id: UID,
        /// Address that funded the bounty and is allowed to approve. Either
        /// a user (for top-level Tasks) or a planner agent (for sub-tasks).
        poster: address,
        /// The single agent address allowed to accept and deliver. Direct
        /// assignment — no bidding.
        assigned_to: address,
        /// Short human-readable label for the task.
        title: String,
        /// Walrus blob id holding the full task specification (prompt,
        /// context, required outputs). Empty string allowed for tiny tasks.
        spec_blob: String,
        /// The capability this task requires (e.g. "research", "audit",
        /// "treasury"). When approved under a policy, this is the `venue`
        /// argument to `operator_policy::record_spend` — the policy's
        /// `allowed_venues` must contain it.
        primary_capability: String,
        /// Escrowed bounty. Released to the agent on approve, returned to
        /// the poster on expire.
        bounty: Balance<SUI>,
        /// Posting time.
        posted_at_ms: u64,
        /// After this ms, anyone may call `expire` to return the bounty.
        deadline_ms: u64,
        /// State machine cursor (see STATUS_* constants above).
        status: u8,
        /// Deliverable WorkObject id; populated on `submit`.
        deliverable_id: Option<ID>,
        /// Optional OperatorPolicy id this task was posted under. If set,
        /// approval requires the exact same policy and uses `record_spend`
        /// to enforce — that's the kill-switch hook.
        parent_policy: Option<ID>,
    }

    // ----------------------------------------------------------------------
    // Events
    // ----------------------------------------------------------------------

    public struct TaskPosted has copy, drop {
        task_id: ID,
        poster: address,
        assigned_to: address,
        title: String,
        primary_capability: String,
        bounty_amount: u64,
        deadline_ms: u64,
        parent_policy: Option<ID>,
        posted_at_ms: u64,
    }

    public struct TaskAccepted has copy, drop {
        task_id: ID,
        agent: address,
        accepted_at_ms: u64,
    }

    public struct TaskSubmitted has copy, drop {
        task_id: ID,
        agent: address,
        deliverable_id: ID,
        submitted_at_ms: u64,
    }

    public struct TaskApproved has copy, drop {
        task_id: ID,
        poster: address,
        agent: address,
        deliverable_id: ID,
        bounty_amount: u64,
        primary_capability: String,
        parent_policy: Option<ID>,
        approved_at_ms: u64,
    }

    public struct TaskExpired has copy, drop {
        task_id: ID,
        poster: address,
        bounty_returned: u64,
        expired_at_ms: u64,
    }

    // ----------------------------------------------------------------------
    // Post — escrow bounty and share the Task
    // ----------------------------------------------------------------------

    /// Post a task directly assigned to `assigned_to`. The full bounty
    /// `Coin<SUI>` is escrowed inside the Task (use `coin::split` upstream
    /// if the poster wants to keep change). Returns the Task ID for PTB
    /// composition (callers typically mint a TaskRequest WorkObject in the
    /// same PTB and parent it to this ID).
    ///
    /// `parent_policy` is None for direct user posts and Some(policy_id) for
    /// planner-driven sub-tasks. The same policy must be passed to
    /// `approve_with_policy` when settling.
    public fun post(
        bounty: Coin<SUI>,
        assigned_to: address,
        title: String,
        spec_blob: String,
        primary_capability: String,
        deadline_ms: u64,
        parent_policy: Option<ID>,
        clock: &Clock,
        ctx: &mut TxContext,
    ): ID {
        let amount = coin::value(&bounty);
        assert!(amount > 0, EInvalidConfig);

        let now = clock::timestamp_ms(clock);
        assert!(deadline_ms > now, EInvalidConfig);

        let task = Task {
            id: object::new(ctx),
            poster: tx_context::sender(ctx),
            assigned_to,
            title,
            spec_blob,
            primary_capability,
            bounty: coin::into_balance(bounty),
            posted_at_ms: now,
            deadline_ms,
            status: STATUS_OPEN,
            deliverable_id: option::none(),
            parent_policy,
        };

        let task_id = object::id(&task);

        event::emit(TaskPosted {
            task_id,
            poster: task.poster,
            assigned_to,
            title: task.title,
            primary_capability: task.primary_capability,
            bounty_amount: amount,
            deadline_ms,
            parent_policy,
            posted_at_ms: now,
        });

        transfer::share_object(task);
        task_id
    }

    // ----------------------------------------------------------------------
    // Accept — assigned agent claims the task
    // ----------------------------------------------------------------------

    public fun accept(
        task: &mut Task,
        clock: &Clock,
        ctx: &TxContext,
    ) {
        assert!(tx_context::sender(ctx) == task.assigned_to, ENotAssignedAgent);
        assert!(task.status == STATUS_OPEN, EWrongStatus);

        let now = clock::timestamp_ms(clock);
        assert!(now < task.deadline_ms, EDeadlinePassed);

        task.status = STATUS_ACCEPTED;

        event::emit(TaskAccepted {
            task_id: object::id(task),
            agent: task.assigned_to,
            accepted_at_ms: now,
        });
    }

    // ----------------------------------------------------------------------
    // Submit — agent posts the deliverable WorkObject id
    // ----------------------------------------------------------------------

    /// Caller must be the assigned agent. `deliverable_id` is the ID of a
    /// WorkObject the same PTB just minted (kind="Deliverable", parented
    /// to this Task). We don't typecheck the WorkObject's `object_type`
    /// here — off-chain consumers and the audit graph make that visible.
    public fun submit(
        task: &mut Task,
        deliverable_id: ID,
        clock: &Clock,
        ctx: &TxContext,
    ) {
        assert!(tx_context::sender(ctx) == task.assigned_to, ENotAssignedAgent);
        assert!(task.status == STATUS_ACCEPTED, EWrongStatus);

        let now = clock::timestamp_ms(clock);
        assert!(now < task.deadline_ms, EDeadlinePassed);

        task.status = STATUS_DELIVERED;
        task.deliverable_id = option::some(deliverable_id);

        event::emit(TaskSubmitted {
            task_id: object::id(task),
            agent: task.assigned_to,
            deliverable_id,
            submitted_at_ms: now,
        });
    }

    // ----------------------------------------------------------------------
    // Approve — the settlement entry point
    // ----------------------------------------------------------------------

    /// Planner-driven settlement. Atomically:
    ///   1. Asserts sender == poster (the planner address).
    ///   2. Asserts the policy id matches `task.parent_policy`.
    ///   3. Asserts the agent_reg's bound address matches `task.assigned_to`.
    ///   4. Calls `operator_policy::record_spend` — enforces budget, expiry,
    ///      revocation, and that `task.primary_capability` is in the
    ///      policy's `allowed_venues`. Aborts on any violation.
    ///   5. Extracts the escrowed Balance<SUI>, transfers to the agent.
    ///   6. Bumps reputation on the AgentRegistration.
    ///   7. Marks the task APPROVED.
    ///
    /// Revocation between submit and approve aborts step 4, which means
    /// the bounty stays escrowed and the chain refused payment. That's the
    /// kill-switch beat.
    public fun approve_with_policy(
        task: &mut Task,
        policy: &mut OperatorPolicy,
        agent_reg: &mut AgentRegistration,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        assert!(tx_context::sender(ctx) == task.poster, ENotPoster);
        assert!(task.status == STATUS_DELIVERED, EWrongStatus);
        assert!(option::is_some(&task.parent_policy), EPolicyRequired);

        let policy_id = *option::borrow(&task.parent_policy);
        assert!(object::id(policy) == policy_id, EPolicyMismatch);

        assert!(
            agent_registry::agent_address(agent_reg) == task.assigned_to,
            EAgentMismatch,
        );

        let amount = balance::value(&task.bounty);

        // The single load-bearing line. This call asserts:
        //   - sender == policy.agent (the planner IS the policy.agent)
        //   - !policy.revoked         ← the kill switch
        //   - now < policy.expires_at_ms
        //   - policy.spent + amount <= budget_cap
        //   - primary_capability is in policy.allowed_venues
        // and bumps policy.spent atomically with the rest of this PTB.
        operator_policy::record_spend(
            policy,
            amount,
            task.primary_capability,
            clock,
            ctx,
        );

        settle_internal(task, agent_reg, clock, ctx);
    }

    /// Direct user → agent settlement, no policy. Aborts if the task was
    /// posted with a parent_policy (those MUST settle via
    /// `approve_with_policy` so the kill switch can intervene).
    public fun approve_direct(
        task: &mut Task,
        agent_reg: &mut AgentRegistration,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        assert!(tx_context::sender(ctx) == task.poster, ENotPoster);
        assert!(task.status == STATUS_DELIVERED, EWrongStatus);
        assert!(option::is_none(&task.parent_policy), EPolicyNotAllowed);

        assert!(
            agent_registry::agent_address(agent_reg) == task.assigned_to,
            EAgentMismatch,
        );

        settle_internal(task, agent_reg, clock, ctx);
    }

    /// Shared post-enforcement settlement: pay bounty to agent, bump rep,
    /// emit TaskApproved, mark APPROVED.
    fun settle_internal(
        task: &mut Task,
        agent_reg: &mut AgentRegistration,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        let now = clock::timestamp_ms(clock);
        let amount = balance::value(&task.bounty);
        let deliverable_id = *option::borrow(&task.deliverable_id);

        // Drain the entire escrow. Even if amount drift happened upstream,
        // we never leave a partial balance behind.
        let payout_balance = balance::withdraw_all(&mut task.bounty);
        let payout = coin::from_balance(payout_balance, ctx);
        transfer::public_transfer(payout, task.assigned_to);

        agent_registry::settle_reputation_bump(agent_reg, amount, now);

        task.status = STATUS_APPROVED;

        event::emit(TaskApproved {
            task_id: object::id(task),
            poster: task.poster,
            agent: task.assigned_to,
            deliverable_id,
            bounty_amount: amount,
            primary_capability: task.primary_capability,
            parent_policy: task.parent_policy,
            approved_at_ms: now,
        });
    }

    // ----------------------------------------------------------------------
    // Expire — anyone can call after deadline to return bounty
    // ----------------------------------------------------------------------

    /// After the deadline, anyone can call this to return the bounty to the
    /// poster and close the task. Aborts if the task already terminated
    /// (approved or expired).
    public fun expire(
        task: &mut Task,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        assert!(
            task.status == STATUS_OPEN
                || task.status == STATUS_ACCEPTED
                || task.status == STATUS_DELIVERED,
            EWrongStatus,
        );

        let now = clock::timestamp_ms(clock);
        assert!(now >= task.deadline_ms, EDeadlineNotReached);

        let refund_balance = balance::withdraw_all(&mut task.bounty);
        let refund_amount = balance::value(&refund_balance);
        let refund = coin::from_balance(refund_balance, ctx);
        transfer::public_transfer(refund, task.poster);

        task.status = STATUS_EXPIRED;

        event::emit(TaskExpired {
            task_id: object::id(task),
            poster: task.poster,
            bounty_returned: refund_amount,
            expired_at_ms: now,
        });
    }

    // ----------------------------------------------------------------------
    // Status constants exposed for client use
    // ----------------------------------------------------------------------

    public fun status_open(): u8 { STATUS_OPEN }
    public fun status_accepted(): u8 { STATUS_ACCEPTED }
    public fun status_delivered(): u8 { STATUS_DELIVERED }
    public fun status_approved(): u8 { STATUS_APPROVED }
    public fun status_expired(): u8 { STATUS_EXPIRED }

    // ----------------------------------------------------------------------
    // Read accessors
    // ----------------------------------------------------------------------

    public fun poster(t: &Task): address { t.poster }
    public fun assigned_to(t: &Task): address { t.assigned_to }
    public fun title(t: &Task): &String { &t.title }
    public fun spec_blob(t: &Task): &String { &t.spec_blob }
    public fun primary_capability(t: &Task): &String { &t.primary_capability }
    public fun bounty_amount(t: &Task): u64 { balance::value(&t.bounty) }
    public fun posted_at_ms(t: &Task): u64 { t.posted_at_ms }
    public fun deadline_ms(t: &Task): u64 { t.deadline_ms }
    public fun status(t: &Task): u8 { t.status }
    public fun deliverable_id(t: &Task): &Option<ID> { &t.deliverable_id }
    public fun parent_policy(t: &Task): &Option<ID> { &t.parent_policy }
}
