import { createRemoteJWKSet, type JWTVerifyGetKey, jwtVerify } from "jose";

/**
 * World ID ("Agent Pass") over OpenID Connect, device flow: our server asks World to start a
 * check, the person approves it in World App, and our server collects a signed ID token.
 * Web2 analogy: "Sign in with Google", except it proves a real, unique person, and nothing
 * about them: World gives each person one ID for this app (`sub`), and no name or email.
 */
export interface WorldConfig {
  issuer: string; // https://auth.world.org, or the sandbox (fake identities, same World App)
  clientId: string;
  clientSecret: string;
}

/** Null when not configured: the app works without it, minus the World ID extras. */
export function loadWorldConfig(env: NodeJS.ProcessEnv = process.env): WorldConfig | null {
  if (!env.WORLD_ID_CLIENT_ID || !env.WORLD_ID_CLIENT_SECRET) return null;
  return {
    issuer: env.WORLD_ID_ISSUER || "https://auth.world.org",
    clientId: env.WORLD_ID_CLIENT_ID,
    clientSecret: env.WORLD_ID_CLIENT_SECRET,
  };
}

/** Orb- or Selfie-Check-level World IDs: the levels that mean one real person. */
export const ACCEPTED_ACR = new Set([
  "https://world.org/oidc/acr/orb",
  "https://world.org/oidc/acr/orb-face",
  "https://world.org/oidc/acr/selfie",
  "https://world.org/oidc/acr/selfie-face",
]);
const SKEW_S = 30;

export interface DeviceStart {
  deviceCode: string; // private: only our server ever sees it
  userCode: string;
  verificationUri: string;
  verificationUriComplete?: string;
  expiresIn: number; // seconds
  interval: number; // seconds between polls
}

export type Poll =
  | { status: "pending" }
  | { status: "slow_down" }
  | { status: "done"; idToken: string }
  | { status: "denied" | "expired" | "failed"; error: string };

export interface Verified {
  iss: string;
  sub: string; // private to our app: the same person always gets the same sub
  authTime: number;
  acr: string;
  amr: string[];
}

export interface WorldClient {
  start(): Promise<DeviceStart>;
  poll(deviceCode: string): Promise<Poll>;
  /** Checks signature, issuer, audience, expiry, level and that it's fresh for this attempt. */
  verify(idToken: string, startedAtS: number): Promise<Verified>;
}

export function worldClient(
  cfg: WorldConfig,
  fetchImpl: typeof fetch = fetch,
  keys?: JWTVerifyGetKey,
): WorldClient {
  let discovery: Promise<Record<string, string>> | null = null;
  const discover = () => {
    discovery ??= fetchImpl(`${cfg.issuer}/.well-known/openid-configuration`)
      .then((r) => {
        if (!r.ok) throw new Error(`World ID discovery: HTTP ${r.status}`);
        return r.json() as Promise<Record<string, string>>;
      })
      .catch((err) => {
        discovery = null; // try again next time
        throw err;
      });
    return discovery;
  };
  let jwks = keys;
  // client_secret_basic, the portal's default: form-encoded id and secret as Basic credentials
  const basic = `Basic ${Buffer.from(
    `${encodeURIComponent(cfg.clientId)}:${encodeURIComponent(cfg.clientSecret)}`,
  ).toString("base64")}`;
  const post = async (url: string, form: Record<string, string>) =>
    fetchImpl(url, {
      method: "POST",
      headers: { authorization: basic, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(form),
      signal: AbortSignal.timeout(15_000),
    });

  return {
    async start() {
      const d = await discover();
      const res = await post(d.device_authorization_endpoint as string, {
        scope: "openid",
        // Any account the app's World settings accept; the level is checked in verify().
        claims: JSON.stringify({ id_token: { acr: null } }),
      });
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok || typeof body.device_code !== "string")
        throw new Error(`World ID: couldn't start a check (${String(body.error ?? res.status)})`);
      return {
        deviceCode: body.device_code,
        userCode: String(body.user_code),
        verificationUri: String(body.verification_uri),
        verificationUriComplete:
          typeof body.verification_uri_complete === "string"
            ? body.verification_uri_complete
            : undefined,
        expiresIn: Number(body.expires_in) || 600,
        interval: Number(body.interval) || 5,
      };
    },

    async poll(deviceCode) {
      const d = await discover();
      const res = await post(d.token_endpoint as string, {
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        device_code: deviceCode,
      }).catch(() => null);
      if (!res) return { status: "pending" }; // timeout: back off and poll again
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (res.ok && typeof body.id_token === "string")
        return { status: "done", idToken: body.id_token };
      const error = String(body.error ?? `HTTP ${res.status}`);
      if (error === "authorization_pending") return { status: "pending" };
      if (error === "slow_down") return { status: "slow_down" };
      if (error === "access_denied") return { status: "denied", error };
      if (error === "expired_token") return { status: "expired", error };
      return { status: "failed", error }; // 503, 429, invalid_grant…: stop, never approve
    },

    async verify(idToken, startedAtS) {
      const d = await discover();
      jwks ??= createRemoteJWKSet(new URL(d.jwks_uri as string));
      const { payload } = await jwtVerify(idToken, jwks, {
        issuer: cfg.issuer,
        audience: cfg.clientId,
        algorithms: ["RS256"],
        clockTolerance: SKEW_S,
        requiredClaims: ["sub", "auth_time", "acr"],
      });
      const authTime = Number(payload.auth_time);
      const nowS = Date.now() / 1000;
      // Fresh for THIS attempt: not an old World session, not from the future.
      if (authTime < startedAtS - SKEW_S || authTime > nowS + SKEW_S)
        throw new Error("the World ID check isn't fresh");
      const acr = String(payload.acr);
      if (!ACCEPTED_ACR.has(acr)) throw new Error(`World ID level ${acr} isn't accepted`);
      return {
        iss: String(payload.iss),
        sub: String(payload.sub),
        authTime,
        acr,
        amr: Array.isArray(payload.amr) ? payload.amr.map(String) : [],
      };
    },
  };
}
