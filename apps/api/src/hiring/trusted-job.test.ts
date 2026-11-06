import { describe, expect, it, vi } from "vitest";
import { PayError, trustedJob } from "./pay";

const OURS = `0x${"aa".repeat(32)}` as const;
const VICTIM = `0x${"bb".repeat(32)}`;
const signed = {
  kind: "held" as const,
  mandateId: 7n,
  nonce: 1n,
  amount: 20_000n,
  payee: "0x00000000000000000000000000000000000000a1" as const,
  escrowId: OURS,
};

describe("after paying an agent, we act only on what we paid", () => {
  it("an agent naming someone else's escrow and a link elsewhere changes nothing", () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const job = trustedJob("https://agent.example/a/staywise", signed, {
      escrowId: VICTIM,
      startsAt: 1,
      jobUrl: `https://evil.example/jobs/${VICTIM}`,
    });
    expect(job.escrowId).toBe(OURS);
    expect(job.jobUrl).toBe(`https://agent.example/a/staywise/jobs/${OURS}`);
    quiet.mockRestore();
  });

  it("a payment that wasn't held in escrow is refused", () => {
    expect(() =>
      trustedJob(
        "https://agent.example",
        { ...signed, kind: "direct", escrowId: undefined },
        {
          escrowId: OURS,
          startsAt: 1,
          jobUrl: "https://agent.example/jobs/x",
        },
      ),
    ).toThrow(PayError);
  });
});
