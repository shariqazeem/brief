# Brief — Move package

Four modules implement the on-chain protocol:

| Module | Purpose | Day to implement |
|---|---|---|
| `work_object.move` | The core WorkObject type — every agent output is one of these | Day 2-3 |
| `agent_registry.move` | Public catalog of agents and their capabilities/pricing | Day 4-5 |
| `settlement.move` | x402-style payment + consumption recording in one atomic call | Day 4-5 |
| `lineage.move` | Read-only graph traversal helpers | Day 12-13 |

All four are currently **skeletons** — struct definitions and public API
signatures are in place, function bodies are `abort 0`. Fill in
implementations once the Sui CLI is installed (Day 1 prep).

## Setup (Day 1 — before writing Move code)

```bash
# Install Sui CLI (Mac, via Homebrew)
brew install sui

# Verify
sui --version    # expect: sui 1.x.x

# Generate a keypair + claim testnet SUI
sui client new-address ed25519
sui client switch --env testnet
sui client faucet     # 1 SUI from the testnet faucet

# Build the package (will fail with abort 0 — that's expected for the skeleton)
cd move
sui move build
```

## Build + test loop (Day 2+)

```bash
# From the move/ directory:
sui move build                            # compile
sui move test                             # run unit tests
sui client publish --gas-budget 200000000 # publish to testnet
```

Publishing returns a package ID. Update `Move.toml`'s `[addresses]` table:

```toml
[addresses]
brief = "0xPUBLISHED_PACKAGE_ID_HERE"
```

And note the package ID in the frontend's `.env.local` as
`NEXT_PUBLIC_BRIEF_PACKAGE_ID`.

## Move version pins

`Move.toml` pins the Sui framework to `framework/testnet`. Switch to
`framework/mainnet` once we are confident on mainnet deploy.

`edition = "2024.beta"` — modern Sui Move syntax with `public struct`,
`public(package)` visibility, etc. Older Sui Move samples use the
`legacy` edition; **do not copy patterns from those** without verifying
they work in 2024.beta.

## What to verify against the Sui Move book before writing implementations

1. **Object ownership transitions** — `transfer::public_transfer` vs
   `transfer::share_object` vs `transfer::transfer`. WorkObjects are
   transferred to a user (public_transfer). AgentRegistrations are shared
   (share_object).
2. **Event emission** — `sui::event::emit` requires `has copy, drop` on the
   event struct.
3. **VecMap usage** — for the `metadata` field. May want `Bag` instead if
   metadata values can be heterogeneous types.
4. **Time** — Sui exposes a `Clock` shared object. To get `timestamp_ms`,
   functions must accept `&Clock` as a parameter and call
   `clock::timestamp_ms(clock)`.
