export const PROSPECT_STATUSES = {
  INVITATION_SENT: "invitation_envoyee",
  CONNECTED: "connecte",
  MESSAGE_SENT: "message_envoye",
  FOLLOW_UP_PENDING: "relance_a_faire",
} as const;

export type ProspectStatus = (typeof PROSPECT_STATUSES)[keyof typeof PROSPECT_STATUSES];

export const STATUS_LABELS: Record<ProspectStatus, string> = {
  invitation_envoyee: "Invitation envoyée",
  connecte: "Connecté",
  message_envoye: "Message envoyé",
  relance_a_faire: "Relance à faire",
};

export interface Prospect {
  id: string;
  name: string;
  profileUrl: string;
  profilePicture?: string;
  jobTitle?: string;
  status: ProspectStatus;
  invitationSentAt?: string;
  connectionAcceptedAt?: string;
  messageSentAt?: string;
  followUpDate?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AppSettings {
  trackingEnabled: boolean;
  followUpDays: number;
  spreadsheetId?: string;
  sheetTabName: string;
  sheetsSyncEnabled: boolean;
  googleConnected: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  trackingEnabled: false,
  followUpDays: 3,
  sheetTabName: "Feuille 1",
  sheetsSyncEnabled: false,
  googleConnected: false,
};

export type MessageType =
  | "GET_SETTINGS"
  | "SET_TRACKING"
  | "SET_SHEET_CONFIG"
  | "GOOGLE_CONNECT"
  | "GOOGLE_DISCONNECT"
  | "GET_PROSPECTS"
  | "ADD_PROSPECT"
  | "DELETE_PROSPECT"
  | "UPDATE_PROSPECT"
  | "EXPORT_EXCEL"
  | "SYNC_CONNECTIONS"
  | "TRIGGER_CONNECTIONS_SYNC"
  | "CONNECTIONS_SYNC_PROGRESS"
  | "CONNECTIONS_SYNC_DONE"
  | "RECORD_MESSAGE"
  | "SYNC_MESSAGES"
  | "TRIGGER_MESSAGES_SYNC"
  | "MESSAGES_SYNC_DONE"
  | "SHOW_NOTIFICATION"
  | "SAVE_PENDING_INVITE"
  | "GET_PENDING_INVITE"
  | "CLEAR_PENDING_INVITE"
  | "GET_CURRENT_PROFILE"
  | "CHECK_PROSPECT_EXISTS"
  | "OPEN_PANEL_WINDOW"
  | "OPEN_SIDE_PANEL"
  | "PULL_SHEET_SYNC"
  | "PUSH_SHEET_SYNC";

export interface ProfileExperience {
  title: string;
  company?: string;
  period?: string;
  location?: string;
  description?: string;
}

export interface ProfileEducation {
  school: string;
  degree?: string;
  period?: string;
}

export interface DetectedProfile {
  name: string;
  profileUrl: string;
  profilePicture?: string;
  jobTitle?: string;
  location?: string;
  about?: string;
  experiences?: ProfileExperience[];
  education?: ProfileEducation[];
  alreadyInDb?: boolean;
}

export interface PendingInvite {
  vanityName: string;
  profileUrl: string;
  name?: string;
  jobTitle?: string;
  profilePicture?: string;
}

export interface ExtensionMessage {
  type: MessageType;
  payload?: unknown;
}
