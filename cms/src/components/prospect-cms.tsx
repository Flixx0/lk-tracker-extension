"use client";

import {
  BarChart3,
  Download,
  LayoutList,
  RefreshCw,
  Search,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { addDaysIso } from "@/lib/dates";
import { matchesTab, searchProspects, tabCounts } from "@/lib/pipeline";
import { computeStats } from "@/lib/stats";
import type { MessageTypeScope, PipelineTab, Prospect, ProspectPatch, SortKey, TodayScope } from "@/lib/types";
import { PROSPECT_STATUSES } from "@/lib/types";
import { ProspectDrawer } from "./prospect-drawer";
import { ProspectTable } from "./prospect-table";
import { StatsPanel } from "./stats-panel";

const TABS: { id: PipelineTab; label: string }[] = [
  { id: "all", label: "Tous" },
  { id: "today", label: "Aujourd’hui" },
  { id: "invites", label: "Invitations" },
  { id: "to_contact", label: "À contacter" },
  { id: "first_message", label: "1er message" },
  { id: "follow_up", label: "À relancer" },
  { id: "followed_up", label: "Relancés" },
];

const TODAY_SCOPES: { id: TodayScope; label: string; countKey: keyof ReturnType<typeof tabCounts> }[] = [
  { id: "created", label: "Nouveaux", countKey: "todayCreated" },
  { id: "invited", label: "Invités", countKey: "todayInvited" },
  { id: "connected", label: "Connectés", countKey: "todayConnected" },
  { id: "messaged", label: "Messages", countKey: "todayMessaged" },
  { id: "updated", label: "Mis à jour", countKey: "todayUpdated" },
];

const MESSAGE_SCOPES: { id: MessageTypeScope; label: string; countKey: keyof ReturnType<typeof tabCounts> }[] = [
  { id: "all", label: "Tous", countKey: "first_message" },
  { id: "video", label: "Vidéo", countKey: "videoMessages" },
  { id: "text", label: "Texte", countKey: "textMessages" },
  { id: "unknown", label: "Non détecté", countKey: "unknownMessages" },
];

type View = "pipeline" | "stats";

export function ProspectCms() {
  const [prospects, setProspects] = useState<Prospect[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [view, setView] = useState<View>("pipeline");
  const [tab, setTab] = useState<PipelineTab>("all");
  const [todayScope, setTodayScope] = useState<TodayScope>("created");
  const [messageTypeScope, setMessageTypeScope] = useState<MessageTypeScope>("all");
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("updatedAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [selectedId, setSelectedId] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/prospects", { cache: "no-store" });
      const data = (await res.json()) as { prospects?: Prospect[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Chargement impossible");
      setProspects(data.prospects ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 2800);
    return () => clearTimeout(t);
  }, [toast]);

  const counts = useMemo(() => tabCounts(prospects), [prospects]);
  const stats = useMemo(() => computeStats(prospects), [prospects]);

  const filtered = useMemo(() => {
    const searched = searchProspects(prospects, query);
    const inTab = searched.filter((p) => matchesTab(p, tab, todayScope, messageTypeScope));
    return [...inTab].sort((a, b) => compareProspects(a, b, sortKey, sortDir));
  }, [prospects, query, tab, todayScope, messageTypeScope, sortKey, sortDir]);

  const selected = prospects.find((p) => p.id === selectedId);

  function onSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir(key === "name" || key === "jobTitle" ? "asc" : "desc");
    }
  }

  async function save(id: string, patch: ProspectPatch) {
    setBusy(true);
    try {
      const res = await fetch(`/api/prospects/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = (await res.json()) as { prospect?: Prospect; error?: string };
      if (!res.ok || !data.prospect) throw new Error(data.error ?? "Mise à jour impossible");
      setProspects((list) => list.map((p) => (p.id === id ? data.prospect! : p)));
      if (patch.notes !== undefined && (data.prospect.notes ?? "") !== (patch.notes ?? "")) {
        setToast("Notes non enregistrées — exécute cms/supabase-migration.sql dans Supabase");
      } else {
        setToast("Prospect mis à jour");
      }
    } catch (err) {
      setToast(err instanceof Error ? err.message : "Erreur");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/prospects/${encodeURIComponent(id)}`, { method: "DELETE" });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Suppression impossible");
      setProspects((list) => list.filter((p) => p.id !== id));
      setSelectedId(undefined);
      setToast("Prospect supprimé");
    } catch (err) {
      setToast(err instanceof Error ? err.message : "Erreur");
    } finally {
      setBusy(false);
    }
  }

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setToast("Lien copié");
    } catch {
      setToast("Impossible de copier");
    }
  }

  function exportCsv() {
    const headers = [
      "Nom",
      "Poste",
      "Profil",
      "Statut",
      "Type 1er message",
      "Invitation",
      "Connexion",
      "Message",
      "Relance",
      "Relance envoyée",
      "Notes",
      "Créé",
    ];
    const lines = filtered.map((p) =>
      [
        p.name,
        p.jobTitle ?? "",
        p.profileUrl,
        p.status,
        p.firstMessageType === "video" ? "vidéo" : p.firstMessageType === "text" ? "texte" : "",
        p.invitationSentAt ?? "",
        p.connectionAcceptedAt ?? "",
        p.messageSentAt ?? "",
        p.followUpDate ?? "",
        p.followUpSentAt ?? "",
        p.notes ?? "",
        p.createdAt,
      ]
        .map(csvCell)
        .join(",")
    );
    const blob = new Blob(["\uFEFF" + [headers.join(","), ...lines].join("\n")], {
      type: "text/csv;charset=utf-8",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `prospects-${tab}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="flex h-dvh overflow-hidden">
      <aside className="flex h-full w-56 shrink-0 flex-col bg-sidebar text-stone-200">
        <div className="px-5 py-6">
          <p className="text-[11px] font-semibold tracking-[0.22em] text-teal-300 uppercase">LK Tracker</p>
          <h1 className="mt-1 text-lg font-semibold text-white">Prospection</h1>
        </div>
        <nav className="flex flex-1 flex-col gap-1 px-3">
          <NavBtn active={view === "pipeline"} onClick={() => setView("pipeline")} icon={<LayoutList className="size-4" />}>
            Pipeline
          </NavBtn>
          <NavBtn active={view === "stats"} onClick={() => setView("stats")} icon={<BarChart3 className="size-4" />}>
            Stats
          </NavBtn>
        </nav>
        <div className="px-5 py-4 text-xs text-stone-400">
          <div className="flex items-center gap-2">
            <Users className="size-3.5" />
            {counts.all} prospects
          </div>
          {counts.follow_up > 0 ? (
            <p className="mt-1 text-amber-300">{counts.follow_up} à relancer</p>
          ) : null}
        </div>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-line px-6 py-4">
          <div className="relative min-w-56 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Rechercher un nom, un poste, une URL…"
              className="w-full rounded-xl border border-line bg-panel py-2 pr-3 pl-9 text-sm outline-none ring-accent/20 focus:ring-4"
            />
          </div>
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-panel px-3 py-2 text-sm hover:bg-white"
          >
            <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
            Actualiser
          </button>
          {view === "pipeline" ? (
            <button
              type="button"
              onClick={exportCsv}
              className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-panel px-3 py-2 text-sm hover:bg-white"
            >
              <Download className="size-3.5" />
              CSV
            </button>
          ) : null}
        </header>

        <main className="flex min-h-0 flex-1 overflow-hidden">
          <section className="min-w-0 flex-1 overflow-y-auto p-6">
            {error ? (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">{error}</div>
            ) : null}

            {view === "stats" ? (
              loading && prospects.length === 0 ? (
                <p className="text-sm text-muted">Chargement des stats…</p>
              ) : (
                <StatsPanel stats={stats} />
              )
            ) : (
              <div className="flex flex-col gap-4">
                <div className="flex flex-wrap gap-1.5">
                  {TABS.map((item) => {
                    const count = counts[item.id];
                    const active = tab === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => setTab(item.id)}
                        className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${
                          active ? "bg-ink text-white" : "bg-panel text-ink/80 ring-1 ring-line hover:bg-white"
                        }`}
                      >
                        {item.label}
                        <span className={`ml-1.5 tabular-nums ${active ? "text-teal-200" : "text-muted"}`}>{count}</span>
                      </button>
                    );
                  })}
                </div>

                {tab === "today" ? (
                  <div className="flex flex-wrap gap-1.5">
                    {TODAY_SCOPES.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => setTodayScope(item.id)}
                        className={`rounded-lg px-2.5 py-1 text-xs font-medium ${
                          todayScope === item.id ? "bg-teal-800 text-white" : "bg-white text-muted ring-1 ring-line"
                        }`}
                      >
                        {item.label} {counts[item.countKey]}
                      </button>
                    ))}
                  </div>
                ) : null}

                {tab === "first_message" ? (
                  <div className="flex flex-wrap gap-1.5">
                    {MESSAGE_SCOPES.map((item) =>
                      item.id === "unknown" && counts.unknownMessages === 0 ? null : (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => setMessageTypeScope(item.id)}
                          className={`rounded-lg px-2.5 py-1 text-xs font-medium ${
                            messageTypeScope === item.id
                              ? "bg-teal-800 text-white"
                              : "bg-white text-muted ring-1 ring-line"
                          }`}
                        >
                          {item.label} {counts[item.countKey]}
                        </button>
                      )
                    )}
                  </div>
                ) : null}

                {tab === "follow_up" ? (
                  <p className="text-sm text-muted">
                    Relances dont la date est arrivée (1ère/2ème relance). Les lignes en rose sont dues.
                  </p>
                ) : null}
                {tab === "to_contact" ? (
                  <p className="text-sm text-muted">Connectés qui n’ont pas encore reçu le premier message.</p>
                ) : null}
                {tab === "invites" ? (
                  <p className="text-sm text-muted">Invitations encore en attente d’acceptation.</p>
                ) : null}
                {tab === "first_message" ? (
                  <p className="text-sm text-muted">
                    {counts.videoMessages} vidéo · {counts.textMessages} texte
                    {counts.unknownMessages > 0 ? ` · ${counts.unknownMessages} non détecté` : ""}
                  </p>
                ) : null}

                {loading && prospects.length === 0 ? (
                  <p className="py-16 text-center text-sm text-muted">Chargement des prospects…</p>
                ) : (
                  <ProspectTable
                    prospects={filtered}
                    sortKey={sortKey}
                    sortDir={sortDir}
                    selectedId={selectedId}
                    onSort={onSort}
                    onSelect={setSelectedId}
                    onCopy={copy}
                    onMarkMessage={(p) =>
                      void save(p.id, {
                        status: PROSPECT_STATUSES.MESSAGE_SENT,
                        messageSentAt: new Date().toISOString(),
                        followUpDate: addDaysIso(new Date(), 3),
                      })
                    }
                    onMarkFollowUp={(p) =>
                      void save(p.id, {
                        followUpSentAt: new Date().toISOString(),
                        followUpDate: addDaysIso(new Date(), 7),
                        status: PROSPECT_STATUSES.MESSAGE_SENT,
                      })
                    }
                    onStatusChange={(p, status) => void save(p.id, { status })}
                  />
                )}
                <p className="text-xs text-muted">{filtered.length} résultat{filtered.length === 1 ? "" : "s"}</p>
              </div>
            )}
          </section>

          {selected && view === "pipeline" ? (
            <>
              <div className="hidden h-full min-h-0 w-[380px] shrink-0 xl:flex">
                <ProspectDrawer
                  key={selected.id}
                  prospect={selected}
                  busy={busy}
                  onClose={() => setSelectedId(undefined)}
                  onSave={(patch) => save(selected.id, patch)}
                  onDelete={() => remove(selected.id)}
                />
              </div>
              <div className="fixed inset-0 z-30 flex justify-end bg-black/40 xl:hidden">
                <div className="h-full w-full max-w-md">
                  <ProspectDrawer
                    key={`m-${selected.id}`}
                    prospect={selected}
                    busy={busy}
                    onClose={() => setSelectedId(undefined)}
                    onSave={(patch) => save(selected.id, patch)}
                    onDelete={() => remove(selected.id)}
                  />
                </div>
              </div>
            </>
          ) : null}
        </main>
      </div>

      {toast ? (
        <div className="fixed right-6 bottom-6 rounded-xl bg-ink px-4 py-2.5 text-sm text-white shadow-lg">{toast}</div>
      ) : null}
    </div>
  );
}

function NavBtn({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-2 rounded-xl px-3 py-2 text-sm ${
        active ? "bg-sidebar-2 text-white" : "text-stone-400 hover:bg-white/5 hover:text-white"
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

function compareProspects(a: Prospect, b: Prospect, key: SortKey, dir: "asc" | "desc"): number {
  const mul = dir === "asc" ? 1 : -1;
  const av = a[key];
  const bv = b[key];
  if (!av && !bv) return 0;
  if (!av) return 1;
  if (!bv) return -1;
  return String(av).localeCompare(String(bv), "fr", { sensitivity: "base" }) * mul;
}

function csvCell(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}
