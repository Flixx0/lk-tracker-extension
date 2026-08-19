import { NextResponse } from "next/server";
import { deleteProspect, patchProspect } from "@/lib/supabase";
import type { ProspectPatch } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const body = (await request.json().catch(() => null)) as ProspectPatch | null;
  if (!body) {
    return NextResponse.json({ error: "Payload invalide" }, { status: 400 });
  }

  try {
    const prospect = await patchProspect(id, body);
    return NextResponse.json({ prospect });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erreur inconnue";
    const status = message.includes("introuvable") ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    await deleteProspect(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erreur inconnue";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
