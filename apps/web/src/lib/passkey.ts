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

/** Makes a new passkey, which makes a new account, and signs in. */
export async function signUpWithPasskey(): Promise<void> {
  const optionsJSON = await api<PublicKeyCredentialCreationOptionsJSON>(
    "/auth/passkey/register-options",
    {
      method: "POST",
      body: {},
    },
  );
  const response = await startRegistration({ optionsJSON });
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
  const response = await startAuthentication({ optionsJSON });
  await api("/auth/passkey/login", { method: "POST", body: { response } });
}

/** The browser's way of saying "the person closed the prompt" (or it timed out). */
export const cancelled = (err: unknown) =>
  err instanceof Error && (err.name === "NotAllowedError" || err.name === "AbortError");
