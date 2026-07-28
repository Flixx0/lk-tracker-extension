import type { DetectedProfile, Prospect } from "./types";
import { STATUS_LABELS } from "./types";

function formatDateFr(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", { dateStyle: "medium" });
}

/** Texte prêt à coller dans un chat IA pour personnaliser un message LinkedIn. */
export function formatProfileForAi(profile: DetectedProfile, prospect?: Prospect): string {
  const lines: string[] = [
    `# Profil LinkedIn — ${profile.name}`,
    "",
    "## Identité",
    "",
    `- **Nom :** ${profile.name}`,
  ];

  const headline = profile.jobTitle?.trim();
  const currentExp = profile.experiences?.[0];

  if (headline) {
    lines.push(`- **Headline LinkedIn :** ${headline}`);
  }
  if (currentExp?.title && currentExp.title !== headline) {
    lines.push(`- **Poste actuel (expérience) :** ${currentExp.title}`);
  }
  if (currentExp?.company) {
    lines.push(`- **Entreprise actuelle :** ${currentExp.company}`);
  }
  if (profile.location?.trim()) {
    lines.push(`- **Localisation :** ${profile.location.trim()}`);
  }
  lines.push(`- **Profil LinkedIn :** ${profile.profileUrl}`);

  if (profile.about?.trim()) {
    lines.push("", "## À propos", "", profile.about.trim());
  }

  if (profile.experiences?.length) {
    lines.push("", "## Expériences récentes", "");
    for (const exp of profile.experiences.slice(0, 5)) {
      const parts = [exp.title];
      if (exp.company) parts.push(`@ ${exp.company}`);
      lines.push(`- **${parts.join(" ")}**`);
      if (exp.period) lines.push(`  - Période : ${exp.period}`);
      if (exp.location) lines.push(`  - Lieu : ${exp.location}`);
      if (exp.description) lines.push(`  - ${exp.description.slice(0, 400)}`);
    }
  }

  if (profile.education?.length) {
    lines.push("", "## Formation", "");
    for (const edu of profile.education.slice(0, 3)) {
      const parts = [edu.school];
      if (edu.degree) parts.push(`— ${edu.degree}`);
      lines.push(`- ${parts.join(" ")}${edu.period ? ` (${edu.period})` : ""}`);
    }
  }

  if (prospect) {
    lines.push("", "## Suivi LK Tracker", "");
    lines.push(`- **Statut :** ${STATUS_LABELS[prospect.status] ?? prospect.status}`);
    if (prospect.invitationSentAt) {
      lines.push(`- **Invitation envoyée :** ${formatDateFr(prospect.invitationSentAt)}`);
    }
    if (prospect.connectionAcceptedAt) {
      lines.push(`- **Connexion acceptée :** ${formatDateFr(prospect.connectionAcceptedAt)}`);
    }
    if (prospect.messageSentAt) {
      lines.push(`- **Premier message :** ${formatDateFr(prospect.messageSentAt)}`);
    }
    if (prospect.followUpDate) {
      lines.push(`- **Relance prévue :** ${formatDateFr(prospect.followUpDate)}`);
    }
  }

  lines.push(
    "",
    "---",
    "",
    "Rédige un message LinkedIn personnalisé en français, professionnel et concis.",
    "Appuie-toi sur le parcours, le poste actuel et le contexte ci-dessus.",
    "Évite les formules génériques et ne mentionne pas que tu as copié ces informations."
  );

  return lines.join("\n");
}
