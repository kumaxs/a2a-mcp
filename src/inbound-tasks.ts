import { randomUUID } from "node:crypto";
import path from "node:path";
import { JsonStore } from "./json-store.js";
import type { InboundTaskRecord, JsonObject } from "./types.js";

export class InboundTaskStore {
  private readonly store: JsonStore<{ tasks: Record<string, InboundTaskRecord> }>;

  constructor(dataDir: string) {
    this.store = new JsonStore(path.join(dataDir, "inbound-tasks.json"), { tasks: {} });
  }

  async create(input: {
    sender: string;
    text: string;
    contextId?: string;
    metadata?: JsonObject;
  }): Promise<InboundTaskRecord> {
    const now = new Date().toISOString();
    const task: InboundTaskRecord = {
      id: randomUUID(),
      contextId: input.contextId || randomUUID(),
      sender: input.sender,
      text: input.text,
      createdAt: now,
      updatedAt: now,
      state: "TASK_STATE_SUBMITTED",
      ...(input.metadata ? { metadata: input.metadata } : {}),
    };
    await this.store.update(({ tasks }) => [{ tasks: { ...tasks, [task.id]: task } }, task]);
    return task;
  }

  async get(id: string): Promise<InboundTaskRecord | undefined> {
    const { tasks } = await this.store.read();
    return tasks[id];
  }

  async list(contextId?: string): Promise<InboundTaskRecord[]> {
    const { tasks } = await this.store.read();
    return Object.values(tasks)
      .filter((task) => !contextId || task.contextId === contextId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async complete(id: string, reply: string): Promise<InboundTaskRecord> {
    if (!reply.trim()) throw new Error("reply must not be empty");
    return this.updateTask(id, (task) => ({
      ...task,
      reply,
      state: "TASK_STATE_COMPLETED",
      updatedAt: new Date().toISOString(),
    }));
  }

  async cancel(id: string): Promise<InboundTaskRecord> {
    return this.updateTask(id, (task) => {
      if (task.state === "TASK_STATE_COMPLETED" || task.state === "TASK_STATE_CANCELED") return task;
      return { ...task, state: "TASK_STATE_CANCELED", updatedAt: new Date().toISOString() };
    });
  }

  private async updateTask(
    id: string,
    updater: (task: InboundTaskRecord) => InboundTaskRecord,
  ): Promise<InboundTaskRecord> {
    return this.store.update(({ tasks }) => {
      const current = tasks[id];
      if (!current) throw new Error(`Inbound A2A task not found: ${id}`);
      const next = updater(current);
      return [{ tasks: { ...tasks, [id]: next } }, next];
    });
  }
}

export function toA2ATask(task: InboundTaskRecord): Record<string, unknown> {
  const userMessage = {
    messageId: `in_${task.id}`,
    contextId: task.contextId,
    taskId: task.id,
    role: "ROLE_USER",
    parts: [{ text: task.text, mediaType: "text/plain" }],
  };
  const replyMessage = task.reply
    ? {
        messageId: `out_${task.id}`,
        contextId: task.contextId,
        taskId: task.id,
        role: "ROLE_AGENT",
        parts: [{ text: task.reply, mediaType: "text/plain" }],
      }
    : undefined;

  return {
    id: task.id,
    contextId: task.contextId,
    status: {
      state: task.state,
      timestamp: task.updatedAt,
      ...(replyMessage ? { message: replyMessage } : {}),
    },
    ...(task.reply
      ? {
          artifacts: [
            {
              artifactId: `artifact_${task.id}`,
              name: "ChatGPT reply",
              parts: [{ text: task.reply, mediaType: "text/plain" }],
            },
          ],
        }
      : {}),
    history: replyMessage ? [userMessage, replyMessage] : [userMessage],
    metadata: { sender: task.sender, ...(task.metadata ?? {}) },
  };
}
