export type QueueType = "Card" | "Accessory";

export type QueueStatus = "Active";

export interface QueueEntry {
  queueEntryId: string;
  queueType: QueueType;
  memberId: string;
  discordId: string;
  position: number;
  status: QueueStatus;
  queuedAt: string;
  addedBy: string;
  lastUpdated: string;
}

export type QueueAction = "ENQUEUE" | "DEQUEUE";

export interface QueueHistory {
  historyId: string;
  queueEntryId: string;
  queueType: QueueType;
  memberId: string;
  discordId: string;
  action: QueueAction;
  position: number;
  changedAt: string;
  changedBy: string;
  cooldownUntil: string;
}
