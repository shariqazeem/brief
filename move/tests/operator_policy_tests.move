#[test_only]
module brief::operator_policy_tests {
    use std::string;
    use sui::clock;
    use sui::test_scenario as ts;
    use brief::operator_policy::{Self, OperatorPolicy};

    const OWNER: address = @0xA1;
    const AGENT: address = @0xA2;
    const ATTACKER: address = @0xA3;

    fun start_clock(time_ms: u64, ctx: &mut sui::tx_context::TxContext): clock::Clock {
        let mut c = clock::create_for_testing(ctx);
        clock::set_for_testing(&mut c, time_ms);
        c
    }

    fun mk_allowed_venues(): vector<string::String> {
        vector[string::utf8(b"DeepBook"), string::utf8(b"NAVI")]
    }

    #[test]
    fun create_and_spend_within_budget() {
        let mut scenario = ts::begin(OWNER);
        let clk = start_clock(1000, ts::ctx(&mut scenario));

        operator_policy::create(
            AGENT,
            string::utf8(b"Conservative Yield"),
            100_000_000_000, // 100 SUI in MIST
            mk_allowed_venues(),
            3000,            // 30% max concentration
            5_000_000,       // expires at ms 5e6
            50,              // auto-approve under 50% of remaining
            string::utf8(b"low"),
            &clk,
            ts::ctx(&mut scenario),
        );

        // Agent spends 10 SUI in DeepBook
        ts::next_tx(&mut scenario, AGENT);
        let mut policy = ts::take_shared<OperatorPolicy>(&scenario);
        operator_policy::record_spend(
            &mut policy,
            10_000_000_000,
            string::utf8(b"DeepBook"),
            &clk,
            ts::ctx(&mut scenario),
        );
        assert!(operator_policy::spent(&policy) == 10_000_000_000, 0);
        assert!(operator_policy::remaining(&policy) == 90_000_000_000, 1);
        ts::return_shared(policy);

        clock::destroy_for_testing(clk);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = operator_policy::EBudgetExceeded)]
    fun budget_cap_aborts_overspend() {
        let mut scenario = ts::begin(OWNER);
        let clk = start_clock(1000, ts::ctx(&mut scenario));

        operator_policy::create(
            AGENT,
            string::utf8(b"Tight Budget"),
            5_000_000_000,
            mk_allowed_venues(),
            3000,
            5_000_000,
            50,
            string::utf8(b"low"),
            &clk,
            ts::ctx(&mut scenario),
        );

        ts::next_tx(&mut scenario, AGENT);
        let mut policy = ts::take_shared<OperatorPolicy>(&scenario);
        // Asking for 6 SUI against a 5 SUI budget — must abort
        operator_policy::record_spend(
            &mut policy,
            6_000_000_000,
            string::utf8(b"DeepBook"),
            &clk,
            ts::ctx(&mut scenario),
        );

        ts::return_shared(policy);
        clock::destroy_for_testing(clk);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = operator_policy::EVenueNotAllowed)]
    fun venue_not_in_allowlist_aborts() {
        let mut scenario = ts::begin(OWNER);
        let clk = start_clock(1000, ts::ctx(&mut scenario));

        operator_policy::create(
            AGENT,
            string::utf8(b"DeepBook Only"),
            100_000_000_000,
            vector[string::utf8(b"DeepBook")], // NAVI not allowed
            3000,
            5_000_000,
            50,
            string::utf8(b"low"),
            &clk,
            ts::ctx(&mut scenario),
        );

        ts::next_tx(&mut scenario, AGENT);
        let mut policy = ts::take_shared<OperatorPolicy>(&scenario);
        operator_policy::record_spend(
            &mut policy,
            1_000_000_000,
            string::utf8(b"NAVI"), // not in allowlist
            &clk,
            ts::ctx(&mut scenario),
        );

        ts::return_shared(policy);
        clock::destroy_for_testing(clk);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = operator_policy::ENotAgent)]
    fun attacker_cannot_spend() {
        let mut scenario = ts::begin(OWNER);
        let clk = start_clock(1000, ts::ctx(&mut scenario));

        operator_policy::create(
            AGENT,
            string::utf8(b"Bound to AGENT"),
            100_000_000_000,
            mk_allowed_venues(),
            3000,
            5_000_000,
            50,
            string::utf8(b"low"),
            &clk,
            ts::ctx(&mut scenario),
        );

        // Attacker (random address) tries to spend
        ts::next_tx(&mut scenario, ATTACKER);
        let mut policy = ts::take_shared<OperatorPolicy>(&scenario);
        operator_policy::record_spend(
            &mut policy,
            1_000_000_000,
            string::utf8(b"DeepBook"),
            &clk,
            ts::ctx(&mut scenario),
        );

        ts::return_shared(policy);
        clock::destroy_for_testing(clk);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = operator_policy::EPolicyRevoked)]
    fun revoke_blocks_subsequent_spending() {
        let mut scenario = ts::begin(OWNER);
        let clk = start_clock(1000, ts::ctx(&mut scenario));

        operator_policy::create(
            AGENT,
            string::utf8(b"Will Be Revoked"),
            100_000_000_000,
            mk_allowed_venues(),
            3000,
            5_000_000,
            50,
            string::utf8(b"low"),
            &clk,
            ts::ctx(&mut scenario),
        );

        // First, agent spends 10 SUI — should succeed
        ts::next_tx(&mut scenario, AGENT);
        let mut policy = ts::take_shared<OperatorPolicy>(&scenario);
        operator_policy::record_spend(
            &mut policy,
            10_000_000_000,
            string::utf8(b"DeepBook"),
            &clk,
            ts::ctx(&mut scenario),
        );
        ts::return_shared(policy);

        // Owner revokes
        ts::next_tx(&mut scenario, OWNER);
        let mut policy = ts::take_shared<OperatorPolicy>(&scenario);
        operator_policy::revoke(&mut policy, &clk, ts::ctx(&mut scenario));
        ts::return_shared(policy);

        // Agent's next attempt — must abort with EPolicyRevoked
        ts::next_tx(&mut scenario, AGENT);
        let mut policy = ts::take_shared<OperatorPolicy>(&scenario);
        operator_policy::record_spend(
            &mut policy,
            1_000_000_000,
            string::utf8(b"DeepBook"),
            &clk,
            ts::ctx(&mut scenario),
        );

        ts::return_shared(policy);
        clock::destroy_for_testing(clk);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = operator_policy::EPolicyExpired)]
    fun expiry_aborts_late_spend() {
        let mut scenario = ts::begin(OWNER);
        let mut clk = start_clock(1000, ts::ctx(&mut scenario));

        operator_policy::create(
            AGENT,
            string::utf8(b"Short Expiry"),
            100_000_000_000,
            mk_allowed_venues(),
            3000,
            2000, // expires at ms 2000
            50,
            string::utf8(b"low"),
            &clk,
            ts::ctx(&mut scenario),
        );

        // Advance clock past expiry
        clock::set_for_testing(&mut clk, 3000);

        ts::next_tx(&mut scenario, AGENT);
        let mut policy = ts::take_shared<OperatorPolicy>(&scenario);
        operator_policy::record_spend(
            &mut policy,
            1_000_000_000,
            string::utf8(b"DeepBook"),
            &clk,
            ts::ctx(&mut scenario),
        );

        ts::return_shared(policy);
        clock::destroy_for_testing(clk);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = operator_policy::ENotOwner)]
    fun attacker_cannot_revoke() {
        let mut scenario = ts::begin(OWNER);
        let clk = start_clock(1000, ts::ctx(&mut scenario));

        operator_policy::create(
            AGENT,
            string::utf8(b"Owner Only"),
            100_000_000_000,
            mk_allowed_venues(),
            3000,
            5_000_000,
            50,
            string::utf8(b"low"),
            &clk,
            ts::ctx(&mut scenario),
        );

        // Attacker tries to revoke
        ts::next_tx(&mut scenario, ATTACKER);
        let mut policy = ts::take_shared<OperatorPolicy>(&scenario);
        operator_policy::revoke(&mut policy, &clk, ts::ctx(&mut scenario));

        ts::return_shared(policy);
        clock::destroy_for_testing(clk);
        ts::end(scenario);
    }

    #[test]
    fun extend_raises_budget_and_expiry() {
        let mut scenario = ts::begin(OWNER);
        let clk = start_clock(1000, ts::ctx(&mut scenario));

        operator_policy::create(
            AGENT,
            string::utf8(b"To Extend"),
            50_000_000_000,
            mk_allowed_venues(),
            3000,
            5_000_000,
            50,
            string::utf8(b"low"),
            &clk,
            ts::ctx(&mut scenario),
        );

        ts::next_tx(&mut scenario, OWNER);
        let mut policy = ts::take_shared<OperatorPolicy>(&scenario);
        operator_policy::extend(
            &mut policy,
            150_000_000_000, // 50 → 150 SUI
            10_000_000,      // expiry → 10e6 ms
            &clk,
            ts::ctx(&mut scenario),
        );
        assert!(operator_policy::budget_cap(&policy) == 150_000_000_000, 0);
        assert!(operator_policy::expires_at_ms(&policy) == 10_000_000, 1);

        ts::return_shared(policy);
        clock::destroy_for_testing(clk);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = operator_policy::ECannotShrink)]
    fun extend_cannot_shrink_budget() {
        let mut scenario = ts::begin(OWNER);
        let clk = start_clock(1000, ts::ctx(&mut scenario));

        operator_policy::create(
            AGENT,
            string::utf8(b"Cannot Shrink"),
            100_000_000_000,
            mk_allowed_venues(),
            3000,
            5_000_000,
            50,
            string::utf8(b"low"),
            &clk,
            ts::ctx(&mut scenario),
        );

        ts::next_tx(&mut scenario, OWNER);
        let mut policy = ts::take_shared<OperatorPolicy>(&scenario);
        // Try to lower budget — must abort
        operator_policy::extend(
            &mut policy,
            50_000_000_000, // 100 → 50, not allowed
            10_000_000,
            &clk,
            ts::ctx(&mut scenario),
        );

        ts::return_shared(policy);
        clock::destroy_for_testing(clk);
        ts::end(scenario);
    }
}
