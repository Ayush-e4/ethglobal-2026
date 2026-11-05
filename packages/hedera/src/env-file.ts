import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";

/**
 * Sets `entries` in a .env file: replaces a line that already sets the name, otherwise appends.
 * The file is kept readable by its owner only. Values are never printed.
 */
export function upsertEnv(path: string, entries: Record<string, string>): void {
  const lines = existsSync(path) ? readFileSync(path, "utf8").split("\n") : [];
  for (const [name, value] of Object.entries(entries)) {
    const at = lines.findIndex((l) => l.startsWith(`${name}=`));
    if (at >= 0) lines[at] = `${name}=${value}`;
    else {
      while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
      lines.push(`${name}=${value}`, "");
    }
  }
  writeFileSync(path, lines.join("\n"));
  chmodSync(path, 0o600);
}
