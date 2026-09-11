import fs from "node:fs";
import path from "node:path";

/**
 * Persisted FIFO outbox. Jobs are marked seen when enqueued (dedupe),
 * and removed only after a successful Telegram send. Survives restarts.
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
      this.items = Array.isArray(data.items) ? data.items : [];
    } catch {
      this.items = [];
    }
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify({ items: this.items }, null, 2), "utf-8");
  }

  has(id) {
    return this.items.some((i) => i.job.id === id);
  }

  push(jobs) {
    let added = 0;
    for (const job of jobs) {
      if (this.has(job.id)) continue;
      this.items.push({ job, attempts: 0, addedAt: Date.now() });
      added++;
    }
    if (added) this.save();
    return added;
  }

  first() {
    return this.items[0] || null;
  }

  remove(id) {
    const before = this.items.length;
    this.items = this.items.filter((i) => i.job.id !== id);
    if (this.items.length !== before) this.save();
  }

  clear() {
    this.items = [];
    this.save();
  }

  size() {
    return this.items.length;
  }
}
