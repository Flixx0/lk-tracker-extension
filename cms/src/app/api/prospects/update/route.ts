import { NextResponse } from "next/server";
import { deleteProspect, patchProspect } from "@/lib/supabase";
import type { ProspectPatch } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Route alternative à /api/prospects/[id] pour éviter les problèmes
 * d'encodage URL avec des IDs contenant des caractères Unicode (emoji, etc.).
 * L'ID est passé dans le body JSON au lieu de l'URL.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as
    | ({ id: string; action: "patch"; patch: ProspectPatch } | { id: string; action: "delete" })
    | null;

  if (!body?.id || !body.action) {
    return NextResponse.json({ error: "Payload invalide" }, { status: 400 });
  }

  try {
    if (body.action === "patch") {
      const prospect = await patchProspect(body.id, body.patch);
      return NextResponse.json({ prospect });
    }

    if (body.action === "delete") {
      await deleteProspect(body.id);
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Action inconnue" }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erreur inconnue";
    const status = message.includes("introuvable") ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
