// OperatorConstitution · six Articles, each tied to its REAL on-chain
// enforcement in the Move package. This reads as enforceable law, not
// marketing: every claim names the exact module / abort code that makes it
// true. Enforcement tags verified against move/sources/operator_policy.move
// and move/sources/gated_spot.move.
//
//   ENotOwner       = 1
//   ENotAgent       = 2
//   EPolicyRevoked  = 3   (revoke → every assert_can_spend aborts)
//   EPolicyExpired  = 4
//   EBudgetExceeded = 5   (spent + amount > budget_cap aborts)
//
// Purely presentational · the page passes the policy id, revoked flag, network.

import { INK, SUB, MUTED, NAVY, SUCCESS, DANGER } from "@/lib/ui";

export type OperatorConstitutionProps = {
  policyId?: string;
  revoked?: boolean;
  network?: "mainnet" | "testnet";
  className?: string;
};

type Article = {
  numeral: string;
  text: string;
  enforcement: string;
};

const ARTICLES: Article[] = [
  {
    numeral: "I",
    text: "Owner retains withdrawal authority.",
    enforcement: "BalanceManager is owner-owned",
  },
  {
    numeral: "II",
    text: "Operator may allocate capital.",
    enforcement: "atomic record_spend + market order (PTB)",
  },
  {
    numeral: "III",
    text: "Operator may never withdraw capital.",
    enforcement: "no WithdrawCap to agent",
  },
  {
    numeral: "IV",
    text: "Owner may revoke authority at any time.",
    enforcement: "operator_policy::revoke → EPolicyRevoked (3)",
  },
  {
    numeral: "V",
    text: "Budget limits are absolute.",
    enforcement: "EBudgetExceeded (5)",
  },
  {
    numeral: "VI",
    text: "All actions must be provable.",
    enforcement: "Sui + Walrus",
  },
];

export default function OperatorConstitution({
  policyId,
  revoked = false,
  network = "mainnet",
  className,
}: OperatorConstitutionProps) {
  return (
    <section
      className={`bg-bg-elev px-6 py-7 shadow-[0_1px_3px_rgba(0,0,0,0.06)] sm:px-9 sm:py-8 ${className ?? ""}`}
      style={{ borderTop: `3px solid ${NAVY}` }}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="font-sans text-[18px] font-medium tracking-tight" style={{ color: INK }}>
          Operator Constitution
        </p>
        <p className="font-mono text-[10px] uppercase tracking-[0.22em]" style={{ color: MUTED }}>
          Enforced by Move · not by us
        </p>
      </div>

      <ol className="mt-5 space-y-0">
        {ARTICLES.map((a, i) => {
          // Article IV carries the revoke state · when authority is revoked,
          // it shows the enforced DANGER state, not a future-tense promise.
          const isRevokedArticle = a.numeral === "IV" && revoked;
          return (
            <li
              key={a.numeral}
              className="flex flex-wrap items-baseline gap-x-3 gap-y-1.5 py-3.5"
              style={{ borderTop: i === 0 ? "none" : "1px solid #F0F0F0" }}
            >
              <span
                className="font-mono text-[11px] tabular-nums"
                style={{ color: isRevokedArticle ? DANGER : NAVY, minWidth: 28 }}
              >
                {a.numeral}.
              </span>
              <span
                className="flex-1 text-[14px] leading-snug"
                style={{ color: INK, minWidth: 180 }}
              >
                {a.text}
              </span>
              <span
                className="border px-2 py-0.5 font-mono text-[9.5px] uppercase tracking-[0.12em]"
                style={
                  isRevokedArticle
                    ? { borderColor: "#F2D6D6", color: DANGER }
                    : { borderColor: "#CDEBD9", color: SUCCESS }
                }
              >
                {isRevokedArticle ? "authority revoked — enforced" : a.enforcement}
              </span>
            </li>
          );
        })}
      </ol>

      {(policyId || network) && (
        <p className="mt-5 font-mono text-[10px] uppercase tracking-[0.16em]" style={{ color: MUTED }}>
          {network === "testnet" ? "Sui testnet" : "Sui mainnet"}
          {policyId ? ` · policy ${policyId.slice(0, 6)}…${policyId.slice(-4)}` : ""}
        </p>
      )}
    </section>
  );
}
