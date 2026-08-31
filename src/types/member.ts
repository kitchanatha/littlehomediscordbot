export interface Member {
  memberId: string;
  discordId: string;
  discordUsername: string;
  characterName: string;
  className: string;
  team: string;
  party: string;
  status: string;
  joinedDate: string;
  lastUpdated: string;
}

export interface LegacyMember {
  legacyName: string;
  className: string;
  team: string;
  party: string;
  source: string;
  matchStatus: string;
  notes: string;
}

export interface HistoryEntry {
  type: "name" | "class";
  historyId: string;
  memberId: string;
  discordId: string;
  oldValue: string;
  newValue: string;
  changedAt: string;
  changedBy: string;
}
