import { createLocalJWKSet, exportJWK, generateKeyPair, type JWK, SignJWT } from "jose";
import { type Poll, type WorldClient, worldClient } from "../world/oidc";

export const ISS = "https://sandbox.auth.world.org";
export const ORB = "https://world.org/oidc/acr/orb";
const CFG = { issuer: ISS, clientId: "app_test", clientSecret: "worldidp_client_secret_x" };
export const now = () => Math.floor(Date.now() / 1000);

// One signing key per test worker, standing in for World's.
let keys: Promise<{ key: CryptoKey; jwks: ReturnType<typeof createLocalJWKSet> }> | null = null;
const testKeys = () => {
  keys ??= (async () => {
    const pair = await generateKeyPair("RS256");
    const pub: JWK = { ...(await exportJWK(pair.publicKey)), kid: "k1", alg: "RS256" };
    return { key: pair.privateKey, jwks: createLocalJWKSet({ keys: [pub] }) };
  })();
  return keys;
};

const discovery = async () =>
  Response.json({
    device_authorization_endpoint: `${ISS}/api/v1/device_authorization`,
    token_endpoint: `${ISS}/api/v1/token`,
    jwks_uri: `${ISS}/.well-known/jwks.json`,
  });

/** The real World ID client, trusting the test key instead of World's. */
export async function worldTestKeys() {
  const { jwks } = await testKeys();
  return { client: () => worldClient(CFG, discovery as typeof fetch, jwks) };
}

/** An ID token as World would sign it: a fresh Orb-level check by "human-1", for our app. */
export async function token(claims: Record<string, unknown> = {}, aud = CFG.clientId) {
  const { key } = await testKeys();
  return new SignJWT({ auth_time: now(), acr: ORB, amr: ["pop"], ...claims })
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setIssuer(ISS)
    .setAudience(aud)
    .setSubject(String(claims.sub ?? "human-1"))
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(key);
}

/** World without World: a check starts at once, then each poll answers what `poll` says. */
export async function fakeWorld(poll: (deviceCode: string) => Promise<Poll>): Promise<WorldClient> {
  const { client } = await worldTestKeys();
  return {
    ...client(),
    start: async () => ({
      deviceCode: "private-device-code",
      userCode: "ABCD-EFGH",
      verificationUri: `${ISS}/device`,
      verificationUriComplete: `${ISS}/authorize?transaction_id=t1`,
      expiresIn: 600,
      interval: 5,
    }),
    poll,
  };
}
