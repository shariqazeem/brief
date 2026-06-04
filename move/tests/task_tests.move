#[test_only]
module brief::task_tests {
    use std::option;
    use std::string;
    use sui::clock;
    use sui::coin;
    use sui::sui::SUI;
    use sui::test_scenario as ts;
    use sui::object::{Self, ID};
    use sui::tx_context::TxContext;

    use brief::operator_policy::{Self, OperatorPolicy};
    use brief::agent_registry::{Self, AgentRegistration};
    use brief::task::{Self, Task};
    use brief::work_object;

    // ----------------------------------------------------------------------
    // Test actors
    // ----------------------------------------------------------------------

    const USER: address = @0xA1;       // human / DAO posting the top-level work
    const PLANNER: address = @0xA2;    // planner agent (policy.agent, sub-task poster)
    const RESEARCH: address = @0xA3;   // specialist agent (assigned_to)
    const ATTACKER: address = @0xA4;

    // ----------------------------------------------------------------------
    // Helpers
    // ----------------------------------------------------------------------

    fun start_clock(time_ms: u64, ctx: &mut TxContext): clock::Clock {
        let mut c = clock::create_for_testing(ctx);
        clock::set_for_testing(&mut c, time_ms);
        c
    }

    fun research_capabilities(): vector<string::String> {
        vector[string::utf8(b"research")]
    }

    fun planner_allowed_venues(): vector<string::String> {
        vector[string::utf8(b"research"), string::utf8(b"treasury")]
    }

    /// Register the RESEARCH agent (must be called as RESEARCH sender).
    fun register_research_agent(scenario: &mut ts::Scenario) {
        agent_registry::register(
            string::utf8(b"Research Agent"),
            research_capabilities(),
            vector[],
            vector[],
            0,
            string::utf8(b""),
            string::utf8(b""),
            ts::ctx(scenario),
        );
    }

    /// Mint a fake Deliverable WorkObject (owned by USER for test purposes)
    /// and return its ID. Real flow would parent it to the Task itself, but
    /// the task module doesn't typecheck parents — that's an off-chain
    /// concern.
    fun mint_fake_deliverable(scenario: &mut ts::Scenario, owner: address): ID {
        work_object::mint(
            owner,
            string::utf8(b"Deliverable"),
            1,
            b"{}",
            option::none(),
            vector[],
            0,
            ts::ctx(scenario),
        )
    }

    // ----------------------------------------------------------------------
    // 1. Happy path — direct (no policy)
    // ----------------------------------------------------------------------

    #[test]
    fun happy_path_direct() {
        let mut scenario = ts::begin(USER);
        let clk = start_clock(1000, ts::ctx(&mut scenario));

        // RESEARCH registers
        ts::next_tx(&mut scenario, RESEARCH);
        register_research_agent(&mut scenario);

        // USER posts task assigned to RESEARCH
        ts::next_tx(&mut scenario, USER);
        let bounty = coin::mint_for_testing<SUI>(3_000_000_000, ts::ctx(&mut scenario));
        task::post(
            bounty,
            RESEARCH,
            string::utf8(b"Audit this contract"),
            string::utf8(b"walrus:spec123"),
            string::utf8(b"research"),
            100_000, // deadline ms
            option::none(),
            &clk,
            ts::ctx(&mut scenario),
        );

        // RESEARCH accepts
        ts::next_tx(&mut scenario, RESEARCH);
        let mut t = ts::take_shared<Task>(&scenario);
        task::accept(&mut t, &clk, ts::ctx(&mut scenario));
        assert!(task::status(&t) == task::status_accepted(), 0);
        ts::return_shared(t);

        // RESEARCH mints a deliverable + submits it
        ts::next_tx(&mut scenario, RESEARCH);
        let deliverable_id = mint_fake_deliverable(&mut scenario, USER);
        let mut t = ts::take_shared<Task>(&scenario);
        task::submit(&mut t, deliverable_id, &clk, ts::ctx(&mut scenario));
        assert!(task::status(&t) == task::status_delivered(), 1);
        ts::return_shared(t);

        // USER approves directly
        ts::next_tx(&mut scenario, USER);
        let mut t = ts::take_shared<Task>(&scenario);
        let mut reg = ts::take_shared<AgentRegistration>(&scenario);
        task::approve_direct(&mut t, &mut reg, &clk, ts::ctx(&mut scenario));

        assert!(task::status(&t) == task::status_approved(), 2);
        assert!(task::bounty_amount(&t) == 0, 3);
        assert!(agent_registry::completed_tasks(&reg) == 1, 4);
        assert!(agent_registry::total_paid(&reg) == 3_000_000_000, 5);
        assert!(agent_registry::reputation(&reg) == 1, 6);

        ts::return_shared(t);
        ts::return_shared(reg);
        clock::destroy_for_testing(clk);
        ts::end(scenario);
    }

    // ----------------------------------------------------------------------
    // 2. Happy path — policy-enforced (planner flow)
    // ----------------------------------------------------------------------

    #[test]
    fun happy_path_with_policy() {
        let mut scenario = ts::begin(USER);
        let clk = start_clock(1000, ts::ctx(&mut scenario));

        // USER grants policy to PLANNER
        operator_policy::create(
            PLANNER,
            string::utf8(b"Evaluation Workforce"),
            30_000_000_000, // 30 SUI budget
            planner_allowed_venues(),
            5000, // 50% concentration
            5_000_000,
            50,
            string::utf8(b"low"),
            &clk,
            ts::ctx(&mut scenario),
        );

        // RESEARCH registers
        ts::next_tx(&mut scenario, RESEARCH);
        register_research_agent(&mut scenario);

        // PLANNER posts a research sub-task with parent_policy set
        ts::next_tx(&mut scenario, PLANNER);
        let policy = ts::take_shared<OperatorPolicy>(&scenario);
        let policy_id = object::id(&policy);
        ts::return_shared(policy);

        let bounty = coin::mint_for_testing<SUI>(3_000_000_000, ts::ctx(&mut scenario));
        task::post(
            bounty,
            RESEARCH,
            string::utf8(b"Research + audit"),
            string::utf8(b"walrus:spec"),
            string::utf8(b"research"),
            100_000,
            option::some(policy_id),
            &clk,
            ts::ctx(&mut scenario),
        );

        // RESEARCH accepts + delivers
        ts::next_tx(&mut scenario, RESEARCH);
        let mut t = ts::take_shared<Task>(&scenario);
        task::accept(&mut t, &clk, ts::ctx(&mut scenario));
        ts::return_shared(t);

        ts::next_tx(&mut scenario, RESEARCH);
        let deliverable_id = mint_fake_deliverable(&mut scenario, USER);
        let mut t = ts::take_shared<Task>(&scenario);
        task::submit(&mut t, deliverable_id, &clk, ts::ctx(&mut scenario));
        ts::return_shared(t);

        // PLANNER approves with policy — record_spend runs, atomic with payout
        ts::next_tx(&mut scenario, PLANNER);
        let mut t = ts::take_shared<Task>(&scenario);
        let mut policy = ts::take_shared<OperatorPolicy>(&scenario);
        let mut reg = ts::take_shared<AgentRegistration>(&scenario);

        task::approve_with_policy(
            &mut t,
            &mut policy,
            &mut reg,
            &clk,
            ts::ctx(&mut scenario),
        );

        assert!(task::status(&t) == task::status_approved(), 0);
        assert!(operator_policy::spent(&policy) == 3_000_000_000, 1);
        assert!(operator_policy::remaining(&policy) == 27_000_000_000, 2);
        assert!(agent_registry::completed_tasks(&reg) == 1, 3);

        ts::return_shared(t);
        ts::return_shared(policy);
        ts::return_shared(reg);
        clock::destroy_for_testing(clk);
        ts::end(scenario);
    }

    // ----------------------------------------------------------------------
    // 3. Accept guard — only assigned agent can accept
    // ----------------------------------------------------------------------

    #[test]
    #[expected_failure(abort_code = task::ENotAssignedAgent)]
    fun attacker_cannot_accept() {
        let mut scenario = ts::begin(USER);
        let clk = start_clock(1000, ts::ctx(&mut scenario));

        ts::next_tx(&mut scenario, USER);
        let bounty = coin::mint_for_testing<SUI>(1_000_000_000, ts::ctx(&mut scenario));
        task::post(
            bounty,
            RESEARCH,
            string::utf8(b"x"),
            string::utf8(b""),
            string::utf8(b"research"),
            100_000,
            option::none(),
            &clk,
            ts::ctx(&mut scenario),
        );

        // ATTACKER tries to accept
        ts::next_tx(&mut scenario, ATTACKER);
        let mut t = ts::take_shared<Task>(&scenario);
        task::accept(&mut t, &clk, ts::ctx(&mut scenario));

        ts::return_shared(t);
        clock::destroy_for_testing(clk);
        ts::end(scenario);
    }

    // ----------------------------------------------------------------------
    // 4. Submit guard — only assigned agent can submit
    // ----------------------------------------------------------------------

    #[test]
    #[expected_failure(abort_code = task::ENotAssignedAgent)]
    fun attacker_cannot_submit() {
        let mut scenario = ts::begin(USER);
        let clk = start_clock(1000, ts::ctx(&mut scenario));

        ts::next_tx(&mut scenario, USER);
        let bounty = coin::mint_for_testing<SUI>(1_000_000_000, ts::ctx(&mut scenario));
        task::post(
            bounty,
            RESEARCH,
            string::utf8(b"x"),
            string::utf8(b""),
            string::utf8(b"research"),
            100_000,
            option::none(),
            &clk,
            ts::ctx(&mut scenario),
        );

        ts::next_tx(&mut scenario, RESEARCH);
        let mut t = ts::take_shared<Task>(&scenario);
        task::accept(&mut t, &clk, ts::ctx(&mut scenario));
        ts::return_shared(t);

        // ATTACKER tries to submit a deliverable they "made"
        ts::next_tx(&mut scenario, ATTACKER);
        let did = mint_fake_deliverable(&mut scenario, ATTACKER);
        let mut t = ts::take_shared<Task>(&scenario);
        task::submit(&mut t, did, &clk, ts::ctx(&mut scenario));

        ts::return_shared(t);
        clock::destroy_for_testing(clk);
        ts::end(scenario);
    }

    // ----------------------------------------------------------------------
    // 5. Submit guard — wrong status (must be ACCEPTED before submit)
    // ----------------------------------------------------------------------

    #[test]
    #[expected_failure(abort_code = task::EWrongStatus)]
    fun submit_before_accept_aborts() {
        let mut scenario = ts::begin(USER);
        let clk = start_clock(1000, ts::ctx(&mut scenario));

        ts::next_tx(&mut scenario, USER);
        let bounty = coin::mint_for_testing<SUI>(1_000_000_000, ts::ctx(&mut scenario));
        task::post(
            bounty,
            RESEARCH,
            string::utf8(b"x"),
            string::utf8(b""),
            string::utf8(b"research"),
            100_000,
            option::none(),
            &clk,
            ts::ctx(&mut scenario),
        );

        // RESEARCH tries to submit without accepting first
        ts::next_tx(&mut scenario, RESEARCH);
        let did = mint_fake_deliverable(&mut scenario, USER);
        let mut t = ts::take_shared<Task>(&scenario);
        task::submit(&mut t, did, &clk, ts::ctx(&mut scenario));

        ts::return_shared(t);
        clock::destroy_for_testing(clk);
        ts::end(scenario);
    }

    // ----------------------------------------------------------------------
    // 6. Approve guard — only poster can approve
    // ----------------------------------------------------------------------

    #[test]
    #[expected_failure(abort_code = task::ENotPoster)]
    fun attacker_cannot_approve_direct() {
        let mut scenario = ts::begin(USER);
        let clk = start_clock(1000, ts::ctx(&mut scenario));

        ts::next_tx(&mut scenario, RESEARCH);
        register_research_agent(&mut scenario);

        ts::next_tx(&mut scenario, USER);
        let bounty = coin::mint_for_testing<SUI>(1_000_000_000, ts::ctx(&mut scenario));
        task::post(
            bounty,
            RESEARCH,
            string::utf8(b"x"),
            string::utf8(b""),
            string::utf8(b"research"),
            100_000,
            option::none(),
            &clk,
            ts::ctx(&mut scenario),
        );

        ts::next_tx(&mut scenario, RESEARCH);
        let mut t = ts::take_shared<Task>(&scenario);
        task::accept(&mut t, &clk, ts::ctx(&mut scenario));
        ts::return_shared(t);

        ts::next_tx(&mut scenario, RESEARCH);
        let did = mint_fake_deliverable(&mut scenario, USER);
        let mut t = ts::take_shared<Task>(&scenario);
        task::submit(&mut t, did, &clk, ts::ctx(&mut scenario));
        ts::return_shared(t);

        // ATTACKER tries to approve
        ts::next_tx(&mut scenario, ATTACKER);
        let mut t = ts::take_shared<Task>(&scenario);
        let mut reg = ts::take_shared<AgentRegistration>(&scenario);
        task::approve_direct(&mut t, &mut reg, &clk, ts::ctx(&mut scenario));

        ts::return_shared(t);
        ts::return_shared(reg);
        clock::destroy_for_testing(clk);
        ts::end(scenario);
    }

    // ----------------------------------------------------------------------
    // 7. THE KILL SWITCH — approve_with_policy aborts when policy revoked
    // ----------------------------------------------------------------------

    #[test]
    #[expected_failure(abort_code = operator_policy::EPolicyRevoked)]
    fun revoked_policy_blocks_approval() {
        let mut scenario = ts::begin(USER);
        let clk = start_clock(1000, ts::ctx(&mut scenario));

        operator_policy::create(
            PLANNER,
            string::utf8(b"Will Be Revoked"),
            30_000_000_000,
            planner_allowed_venues(),
            5000,
            5_000_000,
            50,
            string::utf8(b"low"),
            &clk,
            ts::ctx(&mut scenario),
        );

        ts::next_tx(&mut scenario, RESEARCH);
        register_research_agent(&mut scenario);

        ts::next_tx(&mut scenario, PLANNER);
        let policy_for_id = ts::take_shared<OperatorPolicy>(&scenario);
        let policy_id = object::id(&policy_for_id);
        ts::return_shared(policy_for_id);

        let bounty = coin::mint_for_testing<SUI>(3_000_000_000, ts::ctx(&mut scenario));
        task::post(
            bounty,
            RESEARCH,
            string::utf8(b"Research"),
            string::utf8(b""),
            string::utf8(b"research"),
            100_000,
            option::some(policy_id),
            &clk,
            ts::ctx(&mut scenario),
        );

        ts::next_tx(&mut scenario, RESEARCH);
        let mut t = ts::take_shared<Task>(&scenario);
        task::accept(&mut t, &clk, ts::ctx(&mut scenario));
        ts::return_shared(t);

        ts::next_tx(&mut scenario, RESEARCH);
        let did = mint_fake_deliverable(&mut scenario, USER);
        let mut t = ts::take_shared<Task>(&scenario);
        task::submit(&mut t, did, &clk, ts::ctx(&mut scenario));
        ts::return_shared(t);

        // USER revokes the policy
        ts::next_tx(&mut scenario, USER);
        let mut policy = ts::take_shared<OperatorPolicy>(&scenario);
        operator_policy::revoke(&mut policy, &clk, ts::ctx(&mut scenario));
        ts::return_shared(policy);

        // PLANNER attempts to approve — record_spend aborts on chain
        ts::next_tx(&mut scenario, PLANNER);
        let mut t = ts::take_shared<Task>(&scenario);
        let mut policy = ts::take_shared<OperatorPolicy>(&scenario);
        let mut reg = ts::take_shared<AgentRegistration>(&scenario);
        task::approve_with_policy(
            &mut t,
            &mut policy,
            &mut reg,
            &clk,
            ts::ctx(&mut scenario),
        );

        ts::return_shared(t);
        ts::return_shared(policy);
        ts::return_shared(reg);
        clock::destroy_for_testing(clk);
        ts::end(scenario);
    }

    // ----------------------------------------------------------------------
    // 8. Capability-not-allowed aborts on approve_with_policy
    // ----------------------------------------------------------------------

    #[test]
    #[expected_failure(abort_code = operator_policy::EVenueNotAllowed)]
    fun unlisted_capability_blocks_approval() {
        let mut scenario = ts::begin(USER);
        let clk = start_clock(1000, ts::ctx(&mut scenario));

        // Policy allows only "research" — NOT "audit"
        operator_policy::create(
            PLANNER,
            string::utf8(b"Research Only"),
            30_000_000_000,
            vector[string::utf8(b"research")],
            5000,
            5_000_000,
            50,
            string::utf8(b"low"),
            &clk,
            ts::ctx(&mut scenario),
        );

        ts::next_tx(&mut scenario, RESEARCH);
        agent_registry::register(
            string::utf8(b"Audit Agent"),
            vector[string::utf8(b"audit")],
            vector[],
            vector[],
            0,
            string::utf8(b""),
            string::utf8(b""),
            ts::ctx(&mut scenario),
        );

        ts::next_tx(&mut scenario, PLANNER);
        let policy_for_id = ts::take_shared<OperatorPolicy>(&scenario);
        let policy_id = object::id(&policy_for_id);
        ts::return_shared(policy_for_id);

        let bounty = coin::mint_for_testing<SUI>(2_000_000_000, ts::ctx(&mut scenario));
        task::post(
            bounty,
            RESEARCH,
            string::utf8(b"Audit"),
            string::utf8(b""),
            string::utf8(b"audit"),
            100_000,
            option::some(policy_id),
            &clk,
            ts::ctx(&mut scenario),
        );

        ts::next_tx(&mut scenario, RESEARCH);
        let mut t = ts::take_shared<Task>(&scenario);
        task::accept(&mut t, &clk, ts::ctx(&mut scenario));
        ts::return_shared(t);

        ts::next_tx(&mut scenario, RESEARCH);
        let did = mint_fake_deliverable(&mut scenario, USER);
        let mut t = ts::take_shared<Task>(&scenario);
        task::submit(&mut t, did, &clk, ts::ctx(&mut scenario));
        ts::return_shared(t);

        ts::next_tx(&mut scenario, PLANNER);
        let mut t = ts::take_shared<Task>(&scenario);
        let mut policy = ts::take_shared<OperatorPolicy>(&scenario);
        let mut reg = ts::take_shared<AgentRegistration>(&scenario);
        task::approve_with_policy(
            &mut t,
            &mut policy,
            &mut reg,
            &clk,
            ts::ctx(&mut scenario),
        );

        ts::return_shared(t);
        ts::return_shared(policy);
        ts::return_shared(reg);
        clock::destroy_for_testing(clk);
        ts::end(scenario);
    }

    // ----------------------------------------------------------------------
    // 9. Budget-cap exceeded aborts on approve_with_policy
    // ----------------------------------------------------------------------

    #[test]
    #[expected_failure(abort_code = operator_policy::EBudgetExceeded)]
    fun budget_exceeded_blocks_approval() {
        let mut scenario = ts::begin(USER);
        let clk = start_clock(1000, ts::ctx(&mut scenario));

        // Tight 2 SUI budget
        operator_policy::create(
            PLANNER,
            string::utf8(b"Tight"),
            2_000_000_000,
            planner_allowed_venues(),
            5000,
            5_000_000,
            50,
            string::utf8(b"low"),
            &clk,
            ts::ctx(&mut scenario),
        );

        ts::next_tx(&mut scenario, RESEARCH);
        register_research_agent(&mut scenario);

        ts::next_tx(&mut scenario, PLANNER);
        let policy_for_id = ts::take_shared<OperatorPolicy>(&scenario);
        let policy_id = object::id(&policy_for_id);
        ts::return_shared(policy_for_id);

        // 3 SUI bounty against a 2 SUI policy budget
        let bounty = coin::mint_for_testing<SUI>(3_000_000_000, ts::ctx(&mut scenario));
        task::post(
            bounty,
            RESEARCH,
            string::utf8(b"Big Job"),
            string::utf8(b""),
            string::utf8(b"research"),
            100_000,
            option::some(policy_id),
            &clk,
            ts::ctx(&mut scenario),
        );

        ts::next_tx(&mut scenario, RESEARCH);
        let mut t = ts::take_shared<Task>(&scenario);
        task::accept(&mut t, &clk, ts::ctx(&mut scenario));
        ts::return_shared(t);

        ts::next_tx(&mut scenario, RESEARCH);
        let did = mint_fake_deliverable(&mut scenario, USER);
        let mut t = ts::take_shared<Task>(&scenario);
        task::submit(&mut t, did, &clk, ts::ctx(&mut scenario));
        ts::return_shared(t);

        ts::next_tx(&mut scenario, PLANNER);
        let mut t = ts::take_shared<Task>(&scenario);
        let mut policy = ts::take_shared<OperatorPolicy>(&scenario);
        let mut reg = ts::take_shared<AgentRegistration>(&scenario);
        task::approve_with_policy(
            &mut t,
            &mut policy,
            &mut reg,
            &clk,
            ts::ctx(&mut scenario),
        );

        ts::return_shared(t);
        ts::return_shared(policy);
        ts::return_shared(reg);
        clock::destroy_for_testing(clk);
        ts::end(scenario);
    }

    // ----------------------------------------------------------------------
    // 10. approve_with_policy requires parent_policy to be set
    // ----------------------------------------------------------------------

    #[test]
    #[expected_failure(abort_code = task::EPolicyRequired)]
    fun approve_with_policy_rejects_unpoliced_task() {
        let mut scenario = ts::begin(USER);
        let clk = start_clock(1000, ts::ctx(&mut scenario));

        // Create a policy so we have a valid one to pass (but the task
        // won't reference it)
        operator_policy::create(
            PLANNER,
            string::utf8(b"Unrelated"),
            10_000_000_000,
            planner_allowed_venues(),
            5000,
            5_000_000,
            50,
            string::utf8(b"low"),
            &clk,
            ts::ctx(&mut scenario),
        );

        ts::next_tx(&mut scenario, RESEARCH);
        register_research_agent(&mut scenario);

        // PLANNER posts WITHOUT parent_policy
        ts::next_tx(&mut scenario, PLANNER);
        let bounty = coin::mint_for_testing<SUI>(1_000_000_000, ts::ctx(&mut scenario));
        task::post(
            bounty,
            RESEARCH,
            string::utf8(b"Direct"),
            string::utf8(b""),
            string::utf8(b"research"),
            100_000,
            option::none(),
            &clk,
            ts::ctx(&mut scenario),
        );

        ts::next_tx(&mut scenario, RESEARCH);
        let mut t = ts::take_shared<Task>(&scenario);
        task::accept(&mut t, &clk, ts::ctx(&mut scenario));
        ts::return_shared(t);

        ts::next_tx(&mut scenario, RESEARCH);
        let did = mint_fake_deliverable(&mut scenario, USER);
        let mut t = ts::take_shared<Task>(&scenario);
        task::submit(&mut t, did, &clk, ts::ctx(&mut scenario));
        ts::return_shared(t);

        ts::next_tx(&mut scenario, PLANNER);
        let mut t = ts::take_shared<Task>(&scenario);
        let mut policy = ts::take_shared<OperatorPolicy>(&scenario);
        let mut reg = ts::take_shared<AgentRegistration>(&scenario);
        task::approve_with_policy(
            &mut t,
            &mut policy,
            &mut reg,
            &clk,
            ts::ctx(&mut scenario),
        );

        ts::return_shared(t);
        ts::return_shared(policy);
        ts::return_shared(reg);
        clock::destroy_for_testing(clk);
        ts::end(scenario);
    }

    // ----------------------------------------------------------------------
    // 11. approve_direct rejects policy-bound tasks
    // ----------------------------------------------------------------------

    #[test]
    #[expected_failure(abort_code = task::EPolicyNotAllowed)]
    fun approve_direct_rejects_policied_task() {
        let mut scenario = ts::begin(USER);
        let clk = start_clock(1000, ts::ctx(&mut scenario));

        operator_policy::create(
            PLANNER,
            string::utf8(b"P"),
            10_000_000_000,
            planner_allowed_venues(),
            5000,
            5_000_000,
            50,
            string::utf8(b"low"),
            &clk,
            ts::ctx(&mut scenario),
        );

        ts::next_tx(&mut scenario, RESEARCH);
        register_research_agent(&mut scenario);

        ts::next_tx(&mut scenario, PLANNER);
        let policy_for_id = ts::take_shared<OperatorPolicy>(&scenario);
        let policy_id = object::id(&policy_for_id);
        ts::return_shared(policy_for_id);

        let bounty = coin::mint_for_testing<SUI>(1_000_000_000, ts::ctx(&mut scenario));
        task::post(
            bounty,
            RESEARCH,
            string::utf8(b"Sub"),
            string::utf8(b""),
            string::utf8(b"research"),
            100_000,
            option::some(policy_id),
            &clk,
            ts::ctx(&mut scenario),
        );

        ts::next_tx(&mut scenario, RESEARCH);
        let mut t = ts::take_shared<Task>(&scenario);
        task::accept(&mut t, &clk, ts::ctx(&mut scenario));
        ts::return_shared(t);

        ts::next_tx(&mut scenario, RESEARCH);
        let did = mint_fake_deliverable(&mut scenario, USER);
        let mut t = ts::take_shared<Task>(&scenario);
        task::submit(&mut t, did, &clk, ts::ctx(&mut scenario));
        ts::return_shared(t);

        // PLANNER tries to use approve_direct on a policied task
        ts::next_tx(&mut scenario, PLANNER);
        let mut t = ts::take_shared<Task>(&scenario);
        let mut reg = ts::take_shared<AgentRegistration>(&scenario);
        task::approve_direct(&mut t, &mut reg, &clk, ts::ctx(&mut scenario));

        ts::return_shared(t);
        ts::return_shared(reg);
        clock::destroy_for_testing(clk);
        ts::end(scenario);
    }

    // ----------------------------------------------------------------------
    // 12. Expire returns bounty after deadline
    // ----------------------------------------------------------------------

    #[test]
    fun expire_returns_bounty_to_poster_after_deadline() {
        let mut scenario = ts::begin(USER);
        let mut clk = start_clock(1000, ts::ctx(&mut scenario));

        ts::next_tx(&mut scenario, USER);
        let bounty = coin::mint_for_testing<SUI>(5_000_000_000, ts::ctx(&mut scenario));
        task::post(
            bounty,
            RESEARCH,
            string::utf8(b"x"),
            string::utf8(b""),
            string::utf8(b"research"),
            5000, // deadline ms
            option::none(),
            &clk,
            ts::ctx(&mut scenario),
        );

        // Advance clock past deadline
        clock::set_for_testing(&mut clk, 6000);

        ts::next_tx(&mut scenario, USER);
        let mut t = ts::take_shared<Task>(&scenario);
        task::expire(&mut t, &clk, ts::ctx(&mut scenario));
        assert!(task::status(&t) == task::status_expired(), 0);
        assert!(task::bounty_amount(&t) == 0, 1);
        ts::return_shared(t);

        clock::destroy_for_testing(clk);
        ts::end(scenario);
    }

    // ----------------------------------------------------------------------
    // 13. Expire aborts before deadline
    // ----------------------------------------------------------------------

    #[test]
    #[expected_failure(abort_code = task::EDeadlineNotReached)]
    fun expire_before_deadline_aborts() {
        let mut scenario = ts::begin(USER);
        let clk = start_clock(1000, ts::ctx(&mut scenario));

        ts::next_tx(&mut scenario, USER);
        let bounty = coin::mint_for_testing<SUI>(1_000_000_000, ts::ctx(&mut scenario));
        task::post(
            bounty,
            RESEARCH,
            string::utf8(b"x"),
            string::utf8(b""),
            string::utf8(b"research"),
            10_000, // far-future deadline
            option::none(),
            &clk,
            ts::ctx(&mut scenario),
        );

        ts::next_tx(&mut scenario, USER);
        let mut t = ts::take_shared<Task>(&scenario);
        task::expire(&mut t, &clk, ts::ctx(&mut scenario));

        ts::return_shared(t);
        clock::destroy_for_testing(clk);
        ts::end(scenario);
    }
}
