import { MemberRepository } from "../repositories/member-repository.js";
import { QueueRepository, VisualQueueMember } from "../repositories/queue-repository.js";
import { QueueEntry, QueueHistory, QueueType } from "../types/queue.js";
import { generateNextId } from "../utils/id.js";
import { UserError } from "./member-service.js";
import type { ClassService } from "./class-service.js";

export const QUEUE_COOLDOWN_DAYS = 3;

export class QueueService {
  private locks = new Map<string, Promise<void>>();

  constructor(
    private readonly queueRepository: QueueRepository,
    private readonly memberRepository: MemberRepository,
    private readonly classService: ClassService
  ) {}

  private async withLock<T>(queueType: string, fn: () => Promise<T>): Promise<T> {
    const lock = this.locks.get(queueType) || Promise.resolve();
    const resultPromise = lock.then(fn);
    const nextLock = resultPromise.then(() => {}).catch(() => {});
    this.locks.set(queueType, nextLock);
    return resultPromise;
  }

  private now(): string {
    return new Date().toISOString();
  }

  async enqueue(input: {
    targetDiscordId: string;
    queueType: QueueType;
    changedByDiscordId: string;
  }): Promise<QueueEntry> {
    return this.withLock(input.queueType, async () => {
      // 1. Confirm registered member
      const member = await this.memberRepository.findByDiscordId(input.targetDiscordId);
      if (!member) {
        throw new UserError("❌ This user is not registered. Please use /register first.");
      }

      // 2. Check if already in queue
      const existing = await this.queueRepository.findActiveEntry(input.targetDiscordId, input.queueType);
      if (existing) {
        throw new UserError(`ℹ️ You are already in the ${input.queueType} queue at position #${existing.position}.`);
      }

      // 3. Check cooldown
      const lastHistory = await this.queueRepository.getLastHistory(input.targetDiscordId, input.queueType);
      if (lastHistory && lastHistory.cooldownUntil) {
        const cooldownDate = new Date(lastHistory.cooldownUntil);
        if (cooldownDate > new Date()) {
          throw new UserError(
            `❌ ยังไม่สามารถเข้าคิวได้\nสามารถเข้าคิวใหม่ได้หลัง: ${cooldownDate.toLocaleString()}\n\n` +
            `❌ You cannot join this queue yet.\nCooldown ends: ${cooldownDate.toLocaleString()}`
          );
        }
      }

      // 4. Determine next position
      const activeEntries = await this.queueRepository.getAllActiveEntries(input.queueType);
      const maxPosition = activeEntries.reduce((max, e) => Math.max(max, e.position), 0);
      const nextPosition = maxPosition + 1;

      // 5. Generate IDs
      const entryIds = await this.queueRepository.getAllEntryIds();
      const historyIds = await this.queueRepository.getAllHistoryIds();
      const queueEntryId = generateNextId("QE", entryIds);
      const historyId = generateNextId("QH", historyIds);

      const timestamp = this.now();

      // 6. Create entry
      const entry: QueueEntry = {
        queueEntryId,
        queueType: input.queueType,
        memberId: member.memberId,
        discordId: member.discordId,
        position: nextPosition,
        status: "Active",
        queuedAt: timestamp,
        addedBy: input.changedByDiscordId,
        lastUpdated: timestamp,
      };

      await this.queueRepository.addEntry(entry);

      // 7. Append history
      const history: QueueHistory = {
        historyId,
        queueEntryId,
        queueType: input.queueType,
        memberId: member.memberId,
        discordId: member.discordId,
        action: "ENQUEUE",
        position: nextPosition,
        changedAt: timestamp,
        changedBy: input.changedByDiscordId,
        cooldownUntil: "",
      };

      await this.queueRepository.addHistory(history);

      await this.refreshVisualQueue();

      return entry;
    });
  }

  async dequeue(input: {
    targetDiscordId: string;
    queueType: QueueType;
    changedByDiscordId: string;
  }): Promise<{ cooldownUntil: string }> {
    return this.withLock(input.queueType, async () => {
      // 1. Find active entry
      const entry = await this.queueRepository.findActiveEntry(input.targetDiscordId, input.queueType);
      if (!entry) {
        throw new UserError(`ℹ️ This user is not in the ${input.queueType} queue.`);
      }

      const timestamp = this.now();
      const cooldownUntilDate = new Date(new Date(timestamp).getTime() + QUEUE_COOLDOWN_DAYS * 24 * 60 * 60 * 1000);
      const cooldownUntil = cooldownUntilDate.toISOString();

      // 2. Remove entry
      await this.queueRepository.deleteEntry(entry.queueEntryId);

      // 3. Append history
      const historyIds = await this.queueRepository.getAllHistoryIds();
      const historyId = generateNextId("QH", historyIds);

      const history: QueueHistory = {
        historyId,
        queueEntryId: entry.queueEntryId,
        queueType: input.queueType,
        memberId: entry.memberId,
        discordId: entry.discordId,
        action: "DEQUEUE",
        position: entry.position,
        changedAt: timestamp,
        changedBy: input.changedByDiscordId,
        cooldownUntil,
      };

      await this.queueRepository.addHistory(history);

      // 4. Reorder remaining
      const activeEntries = await this.queueRepository.getAllActiveEntries(input.queueType);
      const toUpdate: QueueEntry[] = [];
      
      // Sort is already done by position in repo, but double check
      activeEntries.sort((a, b) => a.position - b.position);

      for (let i = 0; i < activeEntries.length; i++) {
        const expectedPosition = i + 1;
        if (activeEntries[i].position !== expectedPosition) {
          activeEntries[i].position = expectedPosition;
          activeEntries[i].lastUpdated = timestamp;
          toUpdate.push(activeEntries[i]);
        }
      }

      if (toUpdate.length > 0) {
        await this.queueRepository.updateEntries(toUpdate);
      }

      await this.refreshVisualQueue();

      return { cooldownUntil };
    });
  }

  async getQueue(queueType: QueueType): Promise<VisualQueueMember[]> {
    const entries = await this.queueRepository.getAllActiveEntries(queueType);
    const members = await this.memberRepository.getAllActiveMembers();
    const memberMap = new Map(members.map((m) => [m.discordId, m]));

    const result: VisualQueueMember[] = [];
    for (const e of entries) {
      const member = memberMap.get(e.discordId);
      if (member) {
        const display = await this.classService.formatPlayerDisplay(member);
        result.push({
          ...display,
          position: e.position,
          queuedAt: e.queuedAt,
        });
      }
    }
    return result;
  }

  async refreshVisualQueue(): Promise<void> {
    const cardQueue = await this.getQueue("Card");
    const accessoryQueue = await this.getQueue("Accessory");
    await this.queueRepository.updateVisualDisplay(cardQueue, accessoryQueue);
  }

  async getMemberByDiscordId(discordId: string) {
    return this.memberRepository.findByDiscordId(discordId);
  }

  async getMemberQueueStatus(discordId: string): Promise<{
    card?: { position: number; queuedAt: string; cooldownUntil?: string };
    accessory?: { position: number; queuedAt: string; cooldownUntil?: string };
  }> {
    const cardEntry = await this.queueRepository.findActiveEntry(discordId, "Card");
    const accessoryEntry = await this.queueRepository.findActiveEntry(discordId, "Accessory");

    const status: any = {};

    if (cardEntry) {
      status.card = { position: cardEntry.position, queuedAt: cardEntry.queuedAt };
    } else {
      const last = await this.queueRepository.getLastHistory(discordId, "Card");
      if (last && new Date(last.cooldownUntil) > new Date()) {
        status.card = { cooldownUntil: last.cooldownUntil };
      }
    }

    if (accessoryEntry) {
      status.accessory = { position: accessoryEntry.position, queuedAt: accessoryEntry.queuedAt };
    } else {
      const last = await this.queueRepository.getLastHistory(discordId, "Accessory");
      if (last && new Date(last.cooldownUntil) > new Date()) {
        status.accessory = { cooldownUntil: last.cooldownUntil };
      }
    }

    return status;
  }

  async cleanupMemberQueues(discordId: string): Promise<void> {
    const queueTypes: QueueType[] = ["Card", "Accessory"];
    const timestamp = this.now();

    for (const queueType of queueTypes) {
      await this.withLock(queueType, async () => {
        const entry = await this.queueRepository.findActiveEntry(discordId, queueType);
        if (!entry) return;

        // 1. Remove entry
        await this.queueRepository.deleteEntry(entry.queueEntryId);

        // 2. Append history (no cooldown for guild leave)
        const historyIds = await this.queueRepository.getAllHistoryIds();
        const historyId = generateNextId("QH", historyIds);

        const history: QueueHistory = {
          historyId,
          queueEntryId: entry.queueEntryId,
          queueType: queueType,
          memberId: entry.memberId,
          discordId: entry.discordId,
          action: "DEQUEUE",
          position: entry.position,
          changedAt: timestamp,
          changedBy: "SYSTEM",
          cooldownUntil: "", // No cooldown
        };

        await this.queueRepository.addHistory(history);

        // 3. Reorder remaining
        const activeEntries = await this.queueRepository.getAllActiveEntries(queueType);
        const toUpdate: QueueEntry[] = [];
        activeEntries.sort((a, b) => a.position - b.position);

        for (let i = 0; i < activeEntries.length; i++) {
          const expectedPosition = i + 1;
          if (activeEntries[i].position !== expectedPosition) {
            activeEntries[i].position = expectedPosition;
            activeEntries[i].lastUpdated = timestamp;
            toUpdate.push(activeEntries[i]);
          }
        }

        if (toUpdate.length > 0) {
          await this.queueRepository.updateEntries(toUpdate);
        }
      });
    }

    await this.refreshVisualQueue();
  }
}
