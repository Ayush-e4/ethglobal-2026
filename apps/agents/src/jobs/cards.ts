import { cardMessage, voidCardMessage } from "@app/shared";
import type { LocalAccount } from "viem";
import type { AgentCard } from "./types";

/** Where an agent gets the one-time card it pays a hotel or airline with. */
export interface CardIssuer {
  issue(r: {
    escrowId: string;
    merchant: string;
    amount: number;
    currency: string;
    amountUnits: string;
  }): Promise<AgentCard>;
  void(escrowId: string): Promise<void>;
}

/**
 * AgentNet's card issuer (a mock: no real card network). The agent signs each request with its
 * own key; the issuer only issues a card for a job whose escrow on Hedera holds that money for
 * this agent, locked to one merchant, the exact amount, an hour, and one use.
 */
export function cardIssuer(
  url: string,
  agent: LocalAccount,
  fetchImpl: typeof fetch = fetch,
): CardIssuer {
  const post = async (path: string, body: unknown) => {
    const res = await fetchImpl(`${url.replace(/\/$/, "")}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok)
      throw new Error(String(json.message ?? json.error ?? `card issuer: HTTP ${res.status}`));
    return json;
  };
  return {
    async issue(r) {
      const signature = await agent.signMessage({
        message: cardMessage(r.escrowId, r.amountUnits, r.merchant),
      });
      return (await post("/cards/issue", {
        ...r,
        agent: agent.address,
        signature,
      })) as unknown as AgentCard;
    },
    async void(escrowId) {
      const signature = await agent.signMessage({ message: voidCardMessage(escrowId) });
      await post("/cards/void", { escrowId, agent: agent.address, signature });
    },
  };
}
