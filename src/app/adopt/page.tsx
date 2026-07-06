import { redirect } from "next/navigation";

// /adopt · deep-link into the adoption flow (prompt 02 route). The full-screen
// glass wizard lives in the workforce adopt flow; this gives the landing + nav
// a stable /adopt entry point that never 404s.
export default function AdoptPage(): never {
  redirect("/workforce/adopt");
}
