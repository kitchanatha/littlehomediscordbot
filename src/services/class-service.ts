import type { MemberRepository } from "../repositories/member-repository.js";
import type { ClassConfig, ClassPresentation, PlayerDisplay } from "../types/class.js";
import type { Member } from "../types/member.js";
import { normalizeName } from "../utils/normalize.js";

export class ClassService {
  private cache: ClassConfig[] | null = null;
  private lastFetch: number = 0;
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  constructor(private readonly repository: MemberRepository) {}

  async getClassConfigs(): Promise<ClassConfig[]> {
    const now = Date.now();
    if (this.cache && now - this.lastFetch < this.CACHE_TTL) {
      return this.cache;
    }

    try {
      const configs = await this.repository.getClassConfigs();
      this.cache = configs;
      this.lastFetch = now;
      return configs;
    } catch (error) {
      console.error("ERROR Failed to fetch class configs", error);
      if (this.cache) return this.cache; // Fallback to stale cache
      throw error;
    }
  }

  async getActiveClasses(): Promise<string[]> {
    const configs = await this.getClassConfigs();
    return configs.filter((c) => c.active).map((c) => c.className);
  }

  async getClassPresentation(className: string): Promise<ClassPresentation | null> {
    const configs = await this.getClassConfigs();
    const normalizedTarget = normalizeName(className);
    const config = configs.find((c) => normalizeName(c.className) === normalizedTarget);

    if (!config) return null;

    return {
      className: config.className,
      symbol: config.symbol,
      colorHex: config.colorHex,
    };
  }

  async formatPlayerDisplay(member: Member): Promise<PlayerDisplay> {
    if (!member.className) {
      return {
        text: member.characterName,
        className: "",
        symbol: "",
        colorHex: null,
      };
    }

    const presentation = await this.getClassPresentation(member.className);
    if (!presentation) {
      return {
        text: member.characterName,
        className: member.className,
        symbol: "",
        colorHex: null,
      };
    }

    return {
      text: `${presentation.symbol} ${member.characterName}`.trim(),
      className: presentation.className,
      symbol: presentation.symbol,
      colorHex: presentation.colorHex,
    };
  }
}
