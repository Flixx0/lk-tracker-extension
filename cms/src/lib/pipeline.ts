import { daysBetween, isOnOrBefore, isSameDay } from "./dates";
import type { PipelineTab, Prospect, TodayScope } from "./types";
import { PROSPECT_STATUSES } from "./types";

export function isInvitationPending(p: Prospect): boolean {
  return p.status === PROSPECT_STATUSES.INVITATION_SENT;
}

export function isToContact(p: Prospect): boolean {
  return p.status === PROSPECT_STATUSES.CONNECTED && !p.messageSentAt;
}

export function hasFirstMessage(p: Prospect): boolean {
  return Boolean(p.messageSentAt);
}

export function isFollowUpDue(p: Prospect, now = new Date()): boolean {
  if (p.status === PROSPECT_STATUSES.FOLLOW_UP_PENDING) {
    if (p.followUpDate) return isOnOrBefore(p.followUpDate, now);
    return true;
  }
  if (!p.messageSentAt || !p.followUpDate) return false;
  return isOnOrBefore(p.followUpDate, now);
}

export function isFollowedUp(p: Prospect, now = new Date()): boolean {
  if (p.followUpSentAt) return true;
  if (!p.messageSentAt || !p.followUpDate) return false;
  if (isOnOrBefore(p.followUpDate, now)) return false;
  const gap = daysBetween(p.messageSentAt, p.followUpDate);
  return gap !== null && gap >= 5;
}

export function matchesToday(p: Prospect, scope: TodayScope, now = new Date()): boolean {
  switch (scope) {
    case "created":
      return isSameDay(p.createdAt, now);
    case "invited":
      return isSameDay(p.invitationSentAt, now);
    case "connected":
      return isSameDay(p.connectionAcceptedAt, now);
    case "messaged":
      return isSameDay(p.messageSentAt, now);
    case "updated":
      return isSameDay(p.updatedAt, now);
  }
}

export function matchesTab(
  p: Prospect,
  tab: PipelineTab,
  todayScope: TodayScope = "created",
  now = new Date()
): boolean {
  switch (tab) {
    case "all":
      return true;
    case "today":
      return matchesToday(p, todayScope, now);
    case "invites":
      return isInvitationPending(p);
    case "to_contact":
      return isToContact(p);
    case "first_message":
      return hasFirstMessage(p);
    case "follow_up":
      return isFollowUpDue(p, now);
    case "followed_up":
      return isFollowedUp(p, now);
  }
}

export function tabCounts(prospects: Prospect[], now = new Date()) {
  const counts = {
    all: prospects.length,
    today: 0,
    invites: 0,
    to_contact: 0,
    first_message: 0,
    follow_up: 0,
    followed_up: 0,
    todayCreated: 0,
    todayInvited: 0,
    todayConnected: 0,
    todayMessaged: 0,
    todayUpdated: 0,
    overdueFollowUps: 0,
  };

  for (const p of prospects) {
    if (matchesToday(p, "created", now)) {
      counts.today += 1;
      counts.todayCreated += 1;
    }
    if (matchesToday(p, "invited", now)) counts.todayInvited += 1;
    if (matchesToday(p, "connected", now)) counts.todayConnected += 1;
    if (matchesToday(p, "messaged", now)) counts.todayMessaged += 1;
    if (matchesToday(p, "updated", now)) counts.todayUpdated += 1;
    if (isInvitationPending(p)) counts.invites += 1;
    if (isToContact(p)) counts.to_contact += 1;
    if (hasFirstMessage(p)) counts.first_message += 1;
    if (isFollowUpDue(p, now)) {
      counts.follow_up += 1;
      if (p.followUpDate) {
        const d = daysBetween(p.followUpDate, now);
        if (d !== null && d > 0) counts.overdueFollowUps += 1;
      }
    }
    if (isFollowedUp(p, now)) counts.followed_up += 1;
  }

  return counts;
}

export function searchProspects(prospects: Prospect[], query: string): Prospect[] {
  const q = query.trim().toLowerCase();
  if (!q) return prospects;
  return prospects.filter((p) => {
    return (
      p.name.toLowerCase().includes(q) ||
      (p.jobTitle ?? "").toLowerCase().includes(q) ||
      p.profileUrl.toLowerCase().includes(q) ||
      p.status.toLowerCase().includes(q)
    );
  });
}
