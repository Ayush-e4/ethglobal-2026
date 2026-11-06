"use client";

import { QRCodeSVG } from "qrcode.react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api } from "@/lib/api";
import { cancelled, thisDevice, withFaceId } from "@/lib/passkey";

interface Device {
  id: string;
  label: string | null;
  addedAt: string;
  onWallet: boolean;
}

const small = "h-9 rounded-[10px] border px-3 text-[13px] font-semibold disabled:opacity-60";
const day = (iso: string) =>
  new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });

/**
 * Your devices: each has its own passkey. A new one joins with a code from here (it can then
 * sign in), and Face ID on a device the wallet trusts lets it approve payments too. A lost one
 * is shut out the same way.
 */
export function Devices() {
  const [list, setList] = useState<Device[] | null>(null);
  const [link, setLink] = useState<{ code: string; expiresAt: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const known = useRef<number | null>(null);
  const me = useRef<string | null>(null);

  const load = useCallback(async () => {
    const l = await api<Device[]>("/account/devices").catch(() => null);
    if (!l) return;
    // A new device joined with the code on screen: put the code away, ask to approve it.
    if (known.current !== null && l.length > known.current) {
      setLink(null);
      setNote("Your new device is signed in. Let it approve payments below, with Face ID here.");
    }
    known.current = l.length;
    setList(l);
  }, []);
  useEffect(() => {
    me.current = thisDevice();
    if (new URLSearchParams(window.location.search).get("device") === "added")
      setNote(
        "This device is signed in. To approve payments from it, let it in on your other device: Wallet → Your devices.",
      );
    void load();
  }, [load]);
  useEffect(() => {
    if (!link) return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [link, load]);

  const act = async (id: string, fn: () => Promise<unknown>) => {
    setBusy(id);
    setNote(null);
    try {
      await fn();
    } catch (err) {
      if (!cancelled(err))
        setNote(err instanceof ApiError ? err.message : "That didn't work. Try again.");
    } finally {
      setBusy(null);
      void load();
    }
  };
  const faceId = (d: Device, action: "add" | "remove") =>
    act(d.id, () =>
      withFaceId(
        `/account/devices/${d.id}/wallet/face-id`,
        { action },
        `/account/devices/${d.id}/wallet`,
      ),
    );
  const forget = (d: Device) =>
    act(d.id, () => api(`/account/devices/${d.id}`, { method: "DELETE" }));
  const addDevice = () =>
    act("link", async () => setLink(await api("/account/devices/link", { method: "POST" })));

  if (!list) return null;
  const approvers = list.filter((d) => d.onWallet).length;
  const url = link && `${window.location.origin}/link#${link.code}`;
  return (
    <section id="devices" aria-labelledby="devices-h" className="flex scroll-mt-6 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="devices-h" className="text-lg font-bold">
          Your devices
        </h2>
        {!link && (
          <button
            type="button"
            onClick={addDevice}
            disabled={busy !== null}
            className={`${small} border-line-2 bg-white`}
          >
            Add another device
          </button>
        )}
      </div>
      <p className="text-sm text-ink-3">
        Each device has its own passkey. Devices marked “can approve” approve limits with their Face
        ID or fingerprint; nobody can add one without yours.
      </p>
      {link && url && (
        <div className="flex flex-wrap items-center gap-5 rounded-2xl border border-line bg-white p-4">
          <QRCodeSVG value={url} size={148} marginSize={1} aria-label="QR code to add a device" />
          <div className="flex min-w-[220px] flex-1 flex-col gap-2 text-sm">
            <span className="text-ink-3">On the new device, scan this, or open</span>
            <span className="font-semibold break-all">{window.location.host}/link</span>
            <span className="text-ink-3">and type</span>
            <span className="font-mono text-2xl font-bold tracking-widest">{link.code}</span>
            <span className="text-xs text-muted">
              Works once, until{" "}
              {new Date(link.expiresAt).toLocaleTimeString("en-IN", { timeStyle: "short" })}.
              Waiting for it…
            </span>
          </div>
          <button
            type="button"
            onClick={() => setLink(null)}
            className={`${small} border-line-2 bg-white`}
          >
            Done
          </button>
        </div>
      )}
      {note && <p className="rounded-xl bg-side px-4 py-3 text-sm text-ink-3">{note}</p>}
      <ul className="overflow-hidden rounded-2xl border border-line">
        {list.map((d) => (
          <li
            key={d.id}
            className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-[#F1EEE8] px-4 py-3 text-sm first:border-t-0"
          >
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="font-semibold">
                {d.label ?? "Passkey"}
                {d.id === me.current && (
                  <span className="ml-2 text-xs font-normal text-muted">this device</span>
                )}
              </span>
              <span className="text-xs text-muted">
                added {day(d.addedAt)} · {d.onWallet ? "can approve" : "signs in only"}
              </span>
            </span>
            {!d.onWallet && (
              <button
                type="button"
                onClick={() => faceId(d, "add")}
                disabled={busy !== null}
                className={`${small} border-teal bg-teal text-white`}
              >
                Let it approve (Face ID)
              </button>
            )}
            {(d.onWallet ? approvers > 1 : list.length > 1) && (
              <button
                type="button"
                onClick={() => (d.onWallet ? faceId(d, "remove") : forget(d))}
                disabled={busy !== null}
                className={`${small} border-[#E8B4AE] bg-white text-bad`}
              >
                Remove
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
