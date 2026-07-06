import { redirect } from "next/navigation";

// The Network · the public workforce ranked by Steward Score. Until Phase 4
// reframes the board here, /network redirects to the existing leaderboard so
// the new nav ("Network") never 404s.
export default function NetworkPage(): never {
  redirect("/leaderboard");
}
