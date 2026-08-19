export const PROSPECT_STATUSES = {
  INVITATION_SENT: "invitation_envoyee",
  CONNECTED: "connecte",
  MESSAGE_SENT: "message_envoye",
  // Statut historique (ancien suivi) conservé pour lecture des données existantes
  FOLLOW_UP_PENDING: "relance_a_faire",
  // Statuts actuels (2 étapes)
  FIRST_FOLLOW_UP: "1ere_relance",
  SECOND_FOLLOW_UP: "2eme_relance",
  NOT_INTERESTED: "pas_interesse",
} as const;

export type ProspectStatus = (typeof PROSPECT_STATUSES)[keyof typeof PROSPECT_STATUSES];

export const STATUS_LABELS: Record<ProspectStatus, string> = {
  invitation_envoyee: "Invitation envoyée",
  connecte: "Connecté",
  message_envoye: "Message envoyé",
  relance_a_faire: "1ère relance",
  "1ere_relance": "1ère relance",
  "2eme_relance": "2ème relance",
  pas_interesse: "Pas intéressé",
};

export const STATUS_ORDER: ProspectStatus[] = [
  "invitation_envoyee",
  "connecte",
  "message_envoye",
  "1ere_relance",
  "2eme_relance",
  "pas_interesse",
];

export type FirstMessageType = "video" | "text";

export const MESSAGE_TYPE_LABELS: Record<FirstMessageType, string> = {
  video: "Vidéo",
  text: "Texte",
};

export interface Prospect {
  id: string;
  name: string;
  profileUrl: string;
  profilePicture?: string;
  jobTitle?: string;
  jobTitleCandidates?: string[];
  status: ProspectStatus;
  firstMessageType?: FirstMessageType;
  invitationSentAt?: string;
  connectionAcceptedAt?: string;
  messageSentAt?: string;
  followUpDate?: string;
  followUpSentAt?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DbRow {
  id: string;
  name: string;
  profile_url: string;
  profile_picture: string | null;
  job_title: string | null;
  job_title_candidates: string[] | null;
  status: string;
  first_message_type?: string | null;
  invitation_sent_at: string | null;
  connection_accepted_at: string | null;
  message_sent_at: string | null;
  follow_up_date: string | null;
  follow_up_sent_at?: string | null;
  notes?: string | null;
  created_at: string;
  updated_at: string;
}

export type PipelineTab =
  | "all"
  | "today"
  | "invites"
  | "to_contact"
  | "first_message"
  | "follow_up"
  | "followed_up";

export type SortKey =
  | "name"
  | "jobTitle"
  | "status"
  | "invitationSentAt"
  | "connectionAcceptedAt"
  | "firstMessageType"
  | "messageSentAt"
  | "followUpDate"
  | "createdAt"
  | "updatedAt";

export type TodayScope = "created" | "invited" | "connected" | "messaged" | "updated";

export type MessageTypeScope = "all" | "video" | "text" | "unknown";

export interface ProspectPatch {
  name?: string;
  jobTitle?: string | null;
  status?: ProspectStatus;
  firstMessageType?: FirstMessageType | null;
  invitationSentAt?: string | null;
  connectionAcceptedAt?: string | null;
  messageSentAt?: string | null;
  followUpDate?: string | null;
  followUpSentAt?: string | null;
  notes?: string | null;
}
