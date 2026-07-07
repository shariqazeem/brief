import { redirect } from "next/navigation";

// /operator/[id] · the canonical, shareable operator URL (prompt 02 IA). The
// tabbed console is rendered by the workforce surface, which reads ?policy= for
// a read-only view, so we route there. Keeps a stable /operator/0x… link that
// never 404s and works walletless.
export default function OperatorByIdPage({ params }: { params: { id: string } }): never {
  const id = params.id;
  redirect(id?.startsWith("0x") ? `/workforce?policy=${encodeURIComponent(id)}` : "/workforce");
}
