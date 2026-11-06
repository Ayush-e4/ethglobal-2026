import {
  browserSupportsWebAuthn,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  startAuthentication,
  startRegistration,
} from "@simplewebauthn/browser";
import { api } from "./api";

/**
 * Passkeys: Face ID, a fingerprint, or a phone held up to a laptop. The device signs a one-time
 * challenge from our server; the private key never leaves it.
 */
export const passkeysSupported = () => typeof window !== "undefined" && browserSupportsWebAuthn();

// Which of the account's passkeys is this device's, so its list can say "this device".
const DEVICE_KEY = "app.passkey";
export function thisDevice(): string | null {
  try {
    return localStorage.getItem(DEVICE_KEY);
  } catch {
    return null;
  }
}
const remember = <T extends { id: string }>(response: T) => {
  try {
    localStorage.setItem(DEVICE_KEY, response.id);
  } catch {
    // private browsing: the list just won't mark this device
  }
  return response;
};

/** Makes a new passkey, which makes a new account, and signs in. */
export async function signUpWithPasskey(): Promise<void> {
  const optionsJSON = await api<PublicKeyCredentialCreationOptionsJSON>(
    "/auth/passkey/register-options",
    {
      method: "POST",
      body: {},
    },
  );
  const response = remember(await startRegistration({ optionsJSON }));
  await api("/auth/passkey/register", { method: "POST", body: { response } });
}

/** Signs in with a passkey this site made (the device asks which one). */
export async function signInWithPasskey(): Promise<void> {
  const optionsJSON = await api<PublicKeyCredentialRequestOptionsJSON>(
    "/auth/passkey/login-options",
    {
      method: "POST",
    },
  );
  const response = remember(await startAuthentication({ optionsJSON }));
  await api("/auth/passkey/login", { method: "POST", body: { response } });
}

/** Which account a code from another device is for, and the options to make a passkey on it. */
export const linkOptions = (code: string) =>
  api<{ name: string | null; options: PublicKeyCredentialCreationOptionsJSON }>(
    "/auth/passkey/link/options",
    { method: "POST", body: { code } },
  );

/** Makes this device's own passkey on that account, and signs in. */
export async function linkThisDevice(
  code: string,
  optionsJSON: PublicKeyCredentialCreationOptionsJSON,
) {
  const response = remember(await startRegistration({ optionsJSON }));
  await api("/auth/passkey/link", { method: "POST", body: { code, response } });
}

/**
 * A Face ID approval for your wallet: the server prepares the move and its challenge, the device
 * signs it (Face ID), the server submits it to your wallet on Hedera.
 */
export async function withFaceId<T>(prepare: string, prepareBody: unknown, submit: string) {
  const { opId, options } = await api<{
    opId: string;
    options: PublicKeyCredentialRequestOptionsJSON;
  }>(prepare, { method: "POST", body: prepareBody });
  const response = await startAuthentication({ optionsJSON: options });
  return api<T>(submit, { method: "POST", body: { opId, response } });
}

/** The browser's way of saying "the person closed the prompt" (or it timed out). */
export const cancelled = (err: unknown) =>
  err instanceof Error && (err.name === "NotAllowedError" || err.name === "AbortError");
