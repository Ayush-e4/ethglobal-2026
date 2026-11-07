import { type ConciergeEvent, ConciergeEventSchema } from "@app/shared";
import { ApiError, noAnswer, SIGNED_OUT_EVENT, saying } from "./errors";
import type { Photo } from "./photos";

/**
 * Reads a Server-Sent Events body chunk by chunk and yields each concierge event as soon as
 * its block is complete. Blocks are separated by a blank line; only `data:` lines matter here.
 * Anything that doesn't parse as a known event is skipped rather than breaking the chat.
 */
export async function* readEvents(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<ConciergeEvent> {
  const reader = body
    .pipeThrough(new TextDecoderStream() as unknown as TransformStream<Uint8Array, string>)
    .getReader();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (value) buffer += value.replace(/\r\n/g, "\n");
    let end = buffer.indexOf("\n\n");
    while (end !== -1) {
      const event = parseBlock(buffer.slice(0, end));
      buffer = buffer.slice(end + 2);
      if (event) yield event;
      end = buffer.indexOf("\n\n");
    }
    if (done) {
      const last = parseBlock(buffer);
      if (last) yield last;
      return;
    }
  }
}

export function parseBlock(block: string): ConciergeEvent | null {
  const data = block
    .split("\n")
    .filter((l) => l.startsWith("data:"))
    .map((l) => l.slice(5).trimStart())
    .join("\n");
  if (!data) return null;
  try {
    const parsed = ConciergeEventSchema.safeParse(JSON.parse(data));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * Sends a chat message and streams the reply's events. Not sent at all (offline, signed out,
 * refused) throws an ApiError in words before any event; a stream that drops part-way throws
 * something else, and the reply is still being made on the server.
 */
export async function* sendMessage(
  chatId: string,
  text: string,
  signal?: AbortSignal,
  photos: Photo[] = [],
) {
  const res = await fetch(`/api/chats/${chatId}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      text,
      images: photos.map((p) => p.image),
      ...(photos.length ? { thumbs: photos.map((p) => p.thumb) } : {}),
    }),
    credentials: "same-origin",
    signal,
  }).catch((err) => {
    throw signal?.aborted ? err : noAnswer();
  });
  if (!res.ok || !res.body) {
    const err = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
    if (res.status === 401 && err.error === "signed_out")
      window.dispatchEvent(new Event(SIGNED_OUT_EVENT));
    throw new ApiError(res.status, saying(res.status, err), err.error);
  }
  yield* readEvents(res.body);
}
