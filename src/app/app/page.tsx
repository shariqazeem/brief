import { redirect } from "next/navigation";

// Legacy /app route — old intent-engine and operator consoles lived
// here. Now the workforce console is at /workforce; redirect server-side
// so any old link still lands the user in the right place.
export default function AppPage(): never {
  redirect("/workforce");
}
