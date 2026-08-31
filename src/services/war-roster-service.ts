import { MemberRepository } from "../repositories/member-repository.js";
import { WarRoster, TeamGroup, PartyGroup } from "../types/war-roster.js";
import type { ClassService } from "./class-service.js";

export class WarRosterService {
  constructor(
    private readonly repository: MemberRepository,
    private readonly classService: ClassService
  ) {}

  async getRoster(filters?: { team?: string; party?: number }): Promise<WarRoster> {
    const members = await this.repository.getAllActiveMembers();
    
    const teamsMap = new Map<string, Map<number, string[]>>();

    for (const member of members) {
      const team = (member.team || "").trim().toUpperCase();
      const partyStr = (member.party || "").trim();
      const party = parseInt(partyStr);

      // Validation: Team must be A, B, or C to be on the roster (based on spec)
      if (!["A", "B", "C"].includes(team)) continue;
      if (isNaN(party) || party < 1) continue;

      // Apply filters
      if (filters?.team && team !== filters.team.toUpperCase()) continue;
      if (filters?.party && party !== filters.party) continue;

      if (!teamsMap.has(team)) teamsMap.set(team, new Map());
      const partiesMap = teamsMap.get(team)!;
      if (!partiesMap.has(party)) partiesMap.set(party, []);
      
      const display = await this.classService.formatPlayerDisplay(member);
      partiesMap.get(party)!.push(display.text);
    }

    const roster: WarRoster = {
      teams: Array.from(teamsMap.entries())
        .map(([team, partiesMap]) => ({
          team,
          parties: Array.from(partiesMap.entries())
            .map(([party, members]) => ({
              party,
              members: members.sort()
            }))
            .sort((a, b) => a.party - b.party)
        }))
        .sort((a, b) => a.team.localeCompare(b.team))
    };

    return roster;
  }

  async isUserRegistered(discordId: string): Promise<boolean> {
    const member = await this.repository.findByDiscordId(discordId);
    return !!member;
  }
}
