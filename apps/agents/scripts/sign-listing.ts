// Signs AgentNet's "I run this agent" message with an agent's own key, to list it on AgentNet.
// The key stays here; only the signature (which proves nothing else) is printed.
// Run: pnpm --filter @app/agents sign-listing <ENV_PREFIX> "<message from the List page>"
//   e.g. sign-listing MYAGENT "AgentNet: I run the agent 0x… and list it on AgentNet from account …"
import { privateKeyToAccount } from "viem/accounts";

const [prefix, message] = process.argv.slice(2);
if (!prefix || !message?.startsWith("AgentNet: I run the agent "))
  throw new Error('usage: sign-listing <ENV_PREFIX> "<the message from AgentNet\'s List page>"');
const key = process.env[`${prefix}_PRIVATE_KEY`] as `0x${string}` | undefined;
if (!key) throw new Error(`${prefix}_PRIVATE_KEY isn't set`);
const agent = privateKeyToAccount(key);
if (!message.includes(agent.address.toLowerCase()))
  throw new Error(`that message is for another agent; this key is ${agent.address}`);
console.log(await agent.signMessage({ message }));
