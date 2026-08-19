import { NextResponse } from "next/server";
import { fetchAllProspects } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const prospects = await fetchAllProspects();
    return NextResponse.json({ prospects });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erreur inconnue";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
