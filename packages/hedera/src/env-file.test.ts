import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { upsertEnv } from "./env-file";

describe("upsertEnv", () => {
  it("replaces existing settings, appends new ones and keeps the file private", () => {
    const path = join(mkdtempSync(join(tmpdir(), "env-")), ".env");
    writeFileSync(path, "# mine\nA=1\nB=2\n");
    upsertEnv(path, { B: "3", C: "4" });
    expect(readFileSync(path, "utf8")).toBe("# mine\nA=1\nB=3\nC=4\n");
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it("creates the file if needed", () => {
    const path = join(mkdtempSync(join(tmpdir(), "env-")), ".env");
    upsertEnv(path, { A: "1" });
    expect(readFileSync(path, "utf8")).toBe("A=1\n");
  });
});
