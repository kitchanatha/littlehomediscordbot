export type WarRosterMember = {
  characterName: string;
  team: string;
  party: number;
};

export type PartyGroup = {
  party: number;
  members: string[]; // character names
};

export type TeamGroup = {
  team: string;
  parties: PartyGroup[];
};

export type WarRoster = {
  teams: TeamGroup[];
};
