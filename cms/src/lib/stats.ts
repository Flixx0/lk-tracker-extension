import { daysBetween, lastNDays, startOfWeekYmd, ymdInTz } from "./dates";
import { hasFirstMessage, isFollowedUp, isFollowUpDue, isInvitationPending, isToContact } from "./pipeline";
import type { Prospect, ProspectStatus } from "./types";

function avg(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export function computeStats(prospects: Prospect[]) {
  const now = new Date();
  const today = ymdInTz(now);
  const weekStart = startOfWeekYmd(now);
  const lastWeekStartYmd = (() => {
    const [y, m, d] = weekStart.split("-").map(Number);
    const utc = new Date(Date.UTC(y, m - 1, d - 7));
    return utc.toISOString().slice(0, 10);
  })();

  const byStatus: Record<ProspectStatus, number> = {
    invitation_envoyee: 0,
    connecte: 0,
    message_envoye: 0,
    relance_a_faire: 0,
    "1ere_relance": 0,
    "2eme_relance": 0,
    pas_interesse: 0,
  };

  let createdToday = 0;
  let invitedToday = 0;
  let connectedToday = 0;
  let messagedToday = 0;
  let createdThisWeek = 0;
  let createdLastWeek = 0;
  let invitedThisWeek = 0;
  let connectedThisWeek = 0;
  let messagedThisWeek = 0;

  const acceptDelays: number[] = [];
  const messageDelays: number[] = [];
  const videoDelays: number[] = [];
  const textDelays: number[] = [];
  const pendingInviteAges: number[] = [];
  const overdueFollowUpAges: number[] = [];
  const jobCounts = new Map<string, number>();

  const activity = lastNDays(30);
  const createdByDay: Record<string, number> = Object.fromEntries(activity.map((d) => [d, 0]));
  const invitedByDay: Record<string, number> = { ...createdByDay };
  const connectedByDay: Record<string, number> = { ...createdByDay };
  const messagedByDay: Record<string, number> = { ...createdByDay };
  const videoByDay: Record<string, number> = { ...createdByDay };
  const textByDay: Record<string, number> = { ...createdByDay };

  let withPhoto = 0;
  let withJob = 0;
  let staleInvites7 = 0;
  let staleInvites14 = 0;
  let videoCount = 0;
  let textCount = 0;
  let unknownMsgCount = 0;
  let videoToday = 0;
  let textToday = 0;
  let videoThisWeek = 0;
  let textThisWeek = 0;

  for (const p of prospects) {
    if (p.status in byStatus) byStatus[p.status as ProspectStatus] += 1;
    if (p.profilePicture) withPhoto += 1;
    if (p.jobTitle) withJob += 1;

    const created = ymdInTz(p.createdAt);
    if (created === today) createdToday += 1;
    if (created >= weekStart) createdThisWeek += 1;
    else if (created >= lastWeekStartYmd && created < weekStart) createdLastWeek += 1;
    if (created in createdByDay) createdByDay[created] += 1;

    if (p.invitationSentAt) {
      const d = ymdInTz(p.invitationSentAt);
      if (d === today) invitedToday += 1;
      if (d >= weekStart) invitedThisWeek += 1;
      if (d in invitedByDay) invitedByDay[d] += 1;
    }

    if (p.connectionAcceptedAt) {
      const d = ymdInTz(p.connectionAcceptedAt);
      if (d === today) connectedToday += 1;
      if (d >= weekStart) connectedThisWeek += 1;
      if (d in connectedByDay) connectedByDay[d] += 1;
    }

    if (p.messageSentAt) {
      const d = ymdInTz(p.messageSentAt);
      if (d === today) messagedToday += 1;
      if (d >= weekStart) messagedThisWeek += 1;
      if (d in messagedByDay) messagedByDay[d] += 1;

      if (p.firstMessageType === "video") {
        videoCount += 1;
        if (d === today) videoToday += 1;
        if (d >= weekStart) videoThisWeek += 1;
        if (d in videoByDay) videoByDay[d] += 1;
      } else if (p.firstMessageType === "text") {
        textCount += 1;
        if (d === today) textToday += 1;
        if (d >= weekStart) textThisWeek += 1;
        if (d in textByDay) textByDay[d] += 1;
      } else {
        unknownMsgCount += 1;
      }
    }

    if (p.invitationSentAt && p.connectionAcceptedAt) {
      const n = daysBetween(p.invitationSentAt, p.connectionAcceptedAt);
      if (n !== null && n >= 0) acceptDelays.push(n);
    }

    if (p.connectionAcceptedAt && p.messageSentAt) {
      const n = daysBetween(p.connectionAcceptedAt, p.messageSentAt);
      if (n !== null && n >= 0) {
        messageDelays.push(n);
        if (p.firstMessageType === "video") videoDelays.push(n);
        if (p.firstMessageType === "text") textDelays.push(n);
      }
    }

    if (isInvitationPending(p) && p.invitationSentAt) {
      const age = daysBetween(p.invitationSentAt, now);
      if (age !== null) {
        pendingInviteAges.push(age);
        if (age >= 7) staleInvites7 += 1;
        if (age >= 14) staleInvites14 += 1;
      }
    }

    if (isFollowUpDue(p, now) && p.followUpDate) {
      const age = daysBetween(p.followUpDate, now);
      if (age !== null && age > 0) overdueFollowUpAges.push(age);
    }

    const job = (p.jobTitle ?? "").trim().toLowerCase();
    if (job) jobCounts.set(job, (jobCounts.get(job) ?? 0) + 1);
  }

  const connected = prospects.filter(
    (p) =>
      Boolean(p.connectionAcceptedAt) ||
      p.status === "connecte" ||
      p.status === "message_envoye" ||
      p.status === "relance_a_faire" ||
      p.status === "1ere_relance" ||
      p.status === "2eme_relance"
  ).length;
  const invited = prospects.filter(
    (p) => Boolean(p.invitationSentAt) || isInvitationPending(p) || Boolean(p.connectionAcceptedAt)
  ).length;
  const messaged = prospects.filter(hasFirstMessage).length;
  const pending = prospects.filter(isInvitationPending).length;
  const toContact = prospects.filter(isToContact).length;
  const followUpDue = prospects.filter((p) => isFollowUpDue(p, now)).length;
  const followedUp = prospects.filter((p) => isFollowedUp(p, now)).length;

  // "Taux de réponse" approximatif : parmi ceux à qui tu as envoyé le 1er message
  // (vidéo ou texte), quelle proportion est passée en "connecté" (ou équivalents de statut).
  const isConnectedLike = (p: Prospect) =>
    Boolean(p.connectionAcceptedAt) ||
    p.status === "connecte" ||
    p.status === "message_envoye" ||
    p.status === "relance_a_faire" ||
    p.status === "1ere_relance" ||
    p.status === "2eme_relance";

  const videoConnectedCount = prospects.filter(
    (p) => p.firstMessageType === "video" && isConnectedLike(p)
  ).length;
  const textConnectedCount = prospects.filter(
    (p) => p.firstMessageType === "text" && isConnectedLike(p)
  ).length;

  const typedMessages = videoCount + textCount;
  const videoShare = typedMessages > 0 ? videoCount / typedMessages : null;
  const textShare = typedMessages > 0 ? textCount / typedMessages : null;

  const videoResponseRate = videoCount > 0 ? videoConnectedCount / videoCount : null;
  const textResponseRate = textCount > 0 ? textConnectedCount / textCount : null;

  const acceptRate = invited > 0 ? connected / invited : null;
  const messageRate = connected > 0 ? messaged / connected : null;
  const contactRate = toContact + messaged > 0 ? messaged / (toContact + messaged) : null;

  const topJobs = [...jobCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([label, count]) => ({
      label: label.replace(/\b\w/g, (c) => c.toUpperCase()),
      count,
    }));

  const inviteAgeBuckets = [
    { label: "0–3 j", count: pendingInviteAges.filter((n) => n <= 3).length },
    { label: "4–7 j", count: pendingInviteAges.filter((n) => n >= 4 && n <= 7).length },
    { label: "8–14 j", count: pendingInviteAges.filter((n) => n >= 8 && n <= 14).length },
    { label: "15 j+", count: pendingInviteAges.filter((n) => n >= 15).length },
  ];

  return {
    total: prospects.length,
    byStatus,
    pending,
    toContact,
    messaged,
    followUpDue,
    followedUp,
    videoResponseRate,
    textResponseRate,
    createdToday,
    invitedToday,
    connectedToday,
    messagedToday,
    createdThisWeek,
    createdLastWeek,
    invitedThisWeek,
    connectedThisWeek,
    messagedThisWeek,
    weekDelta: createdThisWeek - createdLastWeek,
    acceptRate,
    messageRate,
    contactRate,
    avgAcceptDays: avg(acceptDelays),
    medianAcceptDays: median(acceptDelays),
    avgMessageDays: avg(messageDelays),
    medianMessageDays: median(messageDelays),
    avgVideoMessageDays: avg(videoDelays),
    avgTextMessageDays: avg(textDelays),
    videoCount,
    textCount,
    unknownMsgCount,
    videoToday,
    textToday,
    videoThisWeek,
    textThisWeek,
    videoShare,
    textShare,
    staleInvites7,
    staleInvites14,
    withPhoto,
    withJob,
    topJobs,
    inviteAgeBuckets,
    overdueFollowUps: overdueFollowUpAges.length,
    avgOverdueDays: avg(overdueFollowUpAges),
    activity: activity.map((day) => ({
      day,
      created: createdByDay[day] ?? 0,
      invited: invitedByDay[day] ?? 0,
      connected: connectedByDay[day] ?? 0,
      messaged: messagedByDay[day] ?? 0,
      video: videoByDay[day] ?? 0,
      text: textByDay[day] ?? 0,
    })),
    funnel: [
      { label: "Prospects", value: prospects.length },
      { label: "Invités", value: invited },
      { label: "Connectés", value: connected },
      { label: "1er message", value: messaged },
      { label: "Relancés", value: followedUp },
    ],
  };
}

export type ProspectStats = ReturnType<typeof computeStats>;
