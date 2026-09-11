import fs from "node:fs";
import path from "node:path";

/**
 * Persisted FIFO outbox. Jobs are marked seen when enqueued (dedupe),
 * and removed only after a successful Telegram send. Survives restarts.
 * Multi-chat: each item carries targetChat (+role). Legacy items without
 * targetChat are treated as belonging to `fallbackChat`.
 */
export class Queue {
  constructor(file) {
    this.file = file;
    this.items = [];
    this.load();
  }

  load() {
    try {
      const data = JSON.parse(fs.readFileSync(this.file, "utf-8"));
      const raw = Array.isArray(data.items) ? data.items : [];
      // Normalize legacy items.
      this.items = raw.filter((i) => i?.job?.id).map((i) => ({
        job: i.job,
        targetChat: i.targetChat || "",
        role: i.role || "",
        attempts: i.attempts || 0,
        addedAt: i.addedAt || Date.now(),
      }));
    } catch {
      this.items = [];
    }
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify({ items: this.items }, null, 2), "utf-8");
  }

  static key(id, targetChat = "") {
    return `${id}::${targetChat || ""}`;
  }

  has(id, targetChat = "") {
    // Backward compat: has(id) matches any chat with that job id.
    if (!targetChat) return this.items.some((i) => i.job.id === id);
    return this.items.some((i) => i.job.id === id && (i.targetChat || "") === targetChat);
  }

  /**
   * Push routed jobs. Accepts job objects optionally carrying
   * `_targetChat` / `_role` (set by runPost fan-out).
   */
  push(jobs, fallbackChat = "") {
    let added = 0;
    for (const job of jobs) {
      const targetChat = job._targetChat || fallbackChat || "";
      const role = job._role || "";
      if (this.has(job.id, targetChat)) continue;
      const { _targetChat, _role, ...clean } = job;
      this.items.push({ job: clean, targetChat, role, attempts: 0, addedAt: Date.now() });
      added++;
    }
    if (added) this.save();
    return added;
  }

  first() {
    return this.items[0] || null;
  }

  /** Next item for a chat (round-robin drain). */
  firstFor(targetChat) {
    return this.items.find((i) => (i.targetChat || "") === (targetChat || "")) || null;
  }

  remove(id, targetChat) {
    const before = this.items.length;
    if (targetChat === undefined) {
      this.items = this.items.filter((i) => i.job.id !== id);
    } else {
      this.items = this.items.filter(
        (i) => !(i.job.id === id && (i.targetChat || "") === (targetChat || "")),
      );
    }
    if (this.items.length !== before) this.save();
  }

  clear(targetChat) {
    if (!targetChat) {
      this.items = [];
    } else {
      this.items = this.items.filter((i) => (i.targetChat || "") !== targetChat);
    }
    this.save();
  }

  size() {
    return this.items.length;
  }

  sizeByChat() {
    const out = {};
    for (const i of this.items) {
      const k = i.targetChat || "(default)";
      out[k] = (out[k] || 0) + 1;
    }
    return out;
  }

  chats() {
    return [...new Set(this.items.map((i) => i.targetChat || ""))];
  }
}
