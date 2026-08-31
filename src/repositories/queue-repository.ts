import { QueueEntry, QueueHistory, QueueType } from "../types/queue.js";
import type { PlayerDisplay } from "../types/class.js";

export interface VisualQueueMember extends PlayerDisplay {
  position: number;
  queuedAt: string;
}

export interface QueueRepository {
  getAllActiveEntries(queueType: QueueType): Promise<QueueEntry[]>;
  findActiveEntry(discordId: string, queueType: QueueType): Promise<QueueEntry | null>;
  getLastHistory(discordId: string, queueType: QueueType): Promise<QueueHistory | null>;
  addEntry(entry: QueueEntry): Promise<void>;
  updateEntries(entries: QueueEntry[]): Promise<void>;
  deleteEntry(queueEntryId: string): Promise<void>;
  addHistory(history: QueueHistory): Promise<void>;
  getAllHistoryIds(): Promise<string[]>;
  getAllEntryIds(): Promise<string[]>;
  updateVisualDisplay(
    cardQueue: VisualQueueMember[],
    accessoryQueue: VisualQueueMember[]
  ): Promise<void>;
  validateReadiness(): Promise<void>;
}
