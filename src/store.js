import fs from "node:fs";
import path from "node:path";

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

export class SeenStore {
  constructor(file) {
    this.file = file;
    this.seen = new Map();
    this.load();
  }

  load() {
    try {
      const raw = fs.readFileSync(this.file, "utf-8");
      const data = JSON.parse(raw);
      for (const [id, ts] of Object.entries(data.seen || {})) {
        this.seen.set(id, Number(ts));
      }
    } catch {
      // first run / no file yet
    }
  }

  save() {
    const dir = path.dirname(this.file);
    fs.mkdirSync(dir, { recursive: true });
    const obj = {};
    for (const [id, ts] of this.seen) obj[id] = ts;
    fs.writeFileSync(this.file, JSON.stringify({ seen: obj }, null, 2), "utf-8");
  }

  has(id) {
    return this.seen.has(id);
  }

  add(ids) {
    const now = Date.now();
    for (const id of ids) this.seen.set(id, now);
  }

  prune() {
    const cutoff = Date.now() - NINETY_DAYS_MS;
    for (const [id, ts] of this.seen) {
      if (ts < cutoff) this.seen.delete(id);
    }
  }
}
