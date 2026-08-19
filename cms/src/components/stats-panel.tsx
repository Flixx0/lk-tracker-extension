import { STATUS_LABELS } from "@/lib/types";
import type { ProspectStats } from "@/lib/stats";
import { ActivityChart, BarList, Funnel, KpiCard, nDays, pct } from "./charts";

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
        <KpiCard label="Messages aujourd’hui" value={stats.messagedToday} />
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
        <KpiCard label="Messages cette semaine" value={stats.messagedThisWeek} />
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
