import { account, createClient, type HederaConfig, NETWORKS, submitMessage } from "@app/hedera";
import { x402Facilitator } from "@x402/core/facilitator";
import { MandateFacilitatorScheme } from "./facilitator-scheme";
import { HederaIds } from "./ids";
import { NETWORK } from "./payload";

/**
 * Our facilitator: `transferExecutor` through MandateRegistry, paid for by the relayer. Every
 * settled payment is also written to the public log (HCS) by the log writer, best effort: the
 * payment stands even if the log write fails.
 */
export function createFacilitator(config: HederaConfig, registryId: string) {
  const ids = new HederaIds(NETWORKS[config.network].mirrorUrl);
  const relayer = account(config, "relayer");
  const f = new x402Facilitator().register(
    NETWORK,
    new MandateFacilitatorScheme({ relayer, executors: [registryId], ids }),
  );
  const writer = config.roles.logWriter;
  const topicId = config.spendLogTopicId;
  if (writer && topicId) {
    f.onAfterSettle(async ({ requirements, result }) => {
      if (!result.success) return;
      const client = createClient(config.network, writer);
      await submitMessage(client, {
        topicId,
        writerKey: writer.key,
        message: {
          type: "x402.settled",
          tx: result.transaction,
          payer: result.payer,
          payTo: requirements.payTo,
          amount: requirements.amount,
          asset: requirements.asset,
          held: requirements.extra?.escrow !== undefined,
        },
      })
        .catch((e) => console.error(`log write failed: ${e}`))
        .finally(() => client.close());
    });
  }
  return f;
}
