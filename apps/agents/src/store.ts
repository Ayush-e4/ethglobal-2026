import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * A small durable map, kept in a JSON file and rewritten atomically (write, then rename), so a
 * crash never leaves half a file. Enough for one agent's quotes and jobs; restarts resume from it.
 */
export class JsonStore<T> {
  private items: Record<string, T>;

  constructor(private readonly path: string) {
    this.items = existsSync(path)
      ? (JSON.parse(readFileSync(path, "utf8")) as Record<string, T>)
      : {};
  }

  get(id: string): T | undefined {
    return this.items[id];
  }

  all(): [string, T][] {
    return Object.entries(this.items);
  }

  set(id: string, value: T): void {
    this.items[id] = value;
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(
      tmp,
      JSON.stringify(this.items, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2),
    );
    renameSync(tmp, this.path);
  }
}
