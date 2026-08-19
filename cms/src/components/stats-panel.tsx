import { STATUS_LABELS } from "@/lib/types";
import type { ProspectStats } from "@/lib/stats";
import { ActivityChart, BarList, Funnel, KpiCard, MessageTypeChart, nDays, pct, StackedShare } from "./charts";

export function StatsPanel({ stats }: { stats: ProspectStats }) {
  const statusItems = (Object.entries(stats.byStatus) as [keyof typeof STATUS_LABELS, number][]).map(
    ([key, count]) => ({ label: STATUS_LABELS[key], count })
  );

  return (
    <div className="flex flex-col gap-6">
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Prospects" value={stats.total} hint={`${stats.createdThisWeek} cette semaine`} />
        <KpiCard
          label="Taux d’acceptation"
          value={pct(stats.acceptRate)}
          hint={`${stats.pending} invitations encore pending`}
        />
        <KpiCard
          label="Taux de 1er message"
          value={pct(stats.messageRate)}
          hint={`${stats.toContact} connectés sans message`}
        />
        <KpiCard
          label="À relancer"
          value={stats.followUpDue}
          hint={stats.overdueFollowUps ? `${stats.overdueFollowUps} en retard` : "Aucune relance en retard"}
        />
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Nouveaux aujourd’hui" value={stats.createdToday} />
        <KpiCard label="Invitations aujourd’hui" value={stats.invitedToday} />
        <KpiCard label="Acceptations aujourd’hui" value={stats.connectedToday} />
        <KpiCard
          label="Messages aujourd’hui"
          value={stats.messagedToday}
          hint={`${stats.videoToday} vidéo · ${stats.textToday} texte`}
        />
      </section>

      <section className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-2xl border border-line bg-panel p-5">
          <h2 className="text-sm font-semibold">1er message : vidéo vs texte</h2>
          <p className="mb-4 text-xs text-muted">
            {stats.messaged} messages envoyés
            {stats.unknownMsgCount > 0 ? ` · ${stats.unknownMsgCount} sans type détecté` : ""}
          </p>
          <StackedShare
            segments={[
              { label: "Vidéo", count: stats.videoCount, className: "bg-violet-600" },
              { label: "Texte", count: stats.textCount, className: "bg-sky-500" },
              { label: "Non détecté", count: stats.unknownMsgCount, className: "bg-stone-300" },
            ]}
          />
          <div className="mt-5 grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-violet-50 px-3 py-3">
              <p className="text-xs font-medium tracking-wide text-violet-800 uppercase">Vidéos</p>
              <p className="mt-0.5 text-2xl font-semibold text-violet-950">{stats.videoCount}</p>
              <p className="mt-1 text-xs text-violet-800/80">
                {pct(stats.videoShare)} · {pct(stats.videoResponseRate)} réponse · {stats.videoToday} aujourd’hui · {stats.videoThisWeek} cette semaine
              </p>
            </div>
            <div className="rounded-xl bg-sky-50 px-3 py-3">
              <p className="text-xs font-medium tracking-wide text-sky-800 uppercase">Textes</p>
              <p className="mt-0.5 text-2xl font-semibold text-sky-950">{stats.textCount}</p>
              <p className="mt-1 text-xs text-sky-800/80">
                {pct(stats.textShare)} · {pct(stats.textResponseRate)} réponse · {stats.textToday} aujourd’hui · {stats.textThisWeek} cette semaine
              </p>
            </div>
          </div>
        </div>
        <div className="rounded-2xl border border-line bg-panel p-5">
          <h2 className="text-sm font-semibold">Vidéo / texte — 30 jours</h2>
          <p className="mb-4 text-xs text-muted">Premier message envoyé, par type et par jour</p>
          <MessageTypeChart days={stats.activity} />
          <div className="mt-4 grid grid-cols-2 gap-3 text-xs text-muted">
            <p>Délai moyen avant vidéo : {nDays(stats.avgVideoMessageDays)}</p>
            <p>Délai moyen avant texte : {nDays(stats.avgTextMessageDays)}</p>
          </div>
        </div>
      </section>

      <section className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-2xl border border-line bg-panel p-5">
          <h2 className="text-sm font-semibold">Activité 30 jours</h2>
          <p className="mb-4 text-xs text-muted">Créations, invitations, connexions et messages cumulés par jour</p>
          <ActivityChart days={stats.activity} />
        </div>
        <div className="rounded-2xl border border-line bg-panel p-5">
          <h2 className="text-sm font-semibold">Tunnel</h2>
          <p className="mb-2 text-xs text-muted">Où se perdent tes prospects</p>
          <Funnel items={stats.funnel} />
        </div>
      </section>

      <section className="grid gap-3 lg:grid-cols-3">
        <div className="rounded-2xl border border-line bg-panel p-5">
          <h2 className="text-sm font-semibold">Répartition des statuts</h2>
          <div className="mt-4">
            <BarList items={statusItems} />
          </div>
        </div>
        <div className="rounded-2xl border border-line bg-panel p-5">
          <h2 className="text-sm font-semibold">Âge des invitations pending</h2>
          <p className="mb-4 text-xs text-muted">
            {stats.staleInvites7} ont plus de 7 jours · {stats.staleInvites14} plus de 14 jours
          </p>
          <BarList items={stats.inviteAgeBuckets} color="bg-amber-600" />
        </div>
        <div className="rounded-2xl border border-line bg-panel p-5">
          <h2 className="text-sm font-semibold">Postes les plus fréquents</h2>
          <div className="mt-4">
            <BarList items={stats.topJobs} color="bg-stone-700" />
          </div>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Délai moyen d’acceptation"
          value={nDays(stats.avgAcceptDays)}
          hint={`Médiane ${nDays(stats.medianAcceptDays)}`}
        />
        <KpiCard
          label="Délai moyen avant 1er message"
          value={nDays(stats.avgMessageDays)}
          hint={`Médiane ${nDays(stats.medianMessageDays)}`}
        />
        <KpiCard
          label="Relancés"
          value={stats.followedUp}
          hint={`Taux de contact ${pct(stats.contactRate)}`}
        />
        <KpiCard
          label="Retard de relance"
          value={nDays(stats.avgOverdueDays)}
          hint="Moyenne des relances en retard"
        />
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Cette semaine"
          value={stats.createdThisWeek}
          hint={
            stats.weekDelta === 0
              ? "Identique à la semaine dernière"
              : stats.weekDelta > 0
                ? `+${stats.weekDelta} vs semaine dernière`
                : `${stats.weekDelta} vs semaine dernière`
          }
        />
        <KpiCard label="Invitations cette semaine" value={stats.invitedThisWeek} />
        <KpiCard label="Connexions cette semaine" value={stats.connectedThisWeek} />
        <KpiCard
          label="Messages cette semaine"
          value={stats.messagedThisWeek}
          hint={`${stats.videoThisWeek} vidéo · ${stats.textThisWeek} texte`}
        />
      </section>

      <section className="grid gap-3 sm:grid-cols-2">
        <KpiCard
          label="Fiches avec photo"
          value={`${stats.withPhoto} / ${stats.total}`}
          hint={pct(stats.total ? stats.withPhoto / stats.total : null)}
        />
        <KpiCard
          label="Fiches avec poste"
          value={`${stats.withJob} / ${stats.total}`}
          hint={pct(stats.total ? stats.withJob / stats.total : null)}
        />
      </section>
    </div>
  );
}
