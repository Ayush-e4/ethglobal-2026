"use client";

import {
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { type Photo, toPhoto } from "@/lib/photos";
import { CloseIcon, ImageIcon, SendIcon } from "../icons";

const MAX_HEIGHT = 200; // about 8 lines, then it scrolls

/**
 * The message box. It grows with what you type. On a keyboard, Enter sends and Shift+Enter adds
 * a line; on a phone, Enter adds a line and the button sends (as in messaging apps). Up to three
 * photos go with a message (a ticket, a booking, a hotel page), shrunk on the device first.
 */
export function Composer({
  onSend,
  disabled,
  placeholder = "Ask anything",
  toolbar,
}: {
  onSend: (text: string, photos: Photo[]) => void;
  disabled?: boolean;
  placeholder?: string;
  toolbar?: ReactNode;
}) {
  const [text, setText] = useState("");
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const addPhotos = async (files: FileList | null) => {
    setPhotoError(null);
    try {
      const picked = await Promise.all([...(files ?? [])].slice(0, 3 - photos.length).map(toPhoto));
      setPhotos((p) => [...p, ...picked].slice(0, 3));
    } catch {
      setPhotoError("Couldn't read that photo. Try another.");
    }
    if (picker.current) picker.current.value = "";
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure whenever the text changes
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
  }, [text]);

  const send = (e?: FormEvent) => {
    e?.preventDefault();
    const t = text.trim();
    if ((!t && photos.length === 0) || disabled) return;
    onSend(t, photos);
    setText("");
    setPhotos([]);
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const touch = window.matchMedia("(pointer: coarse)").matches;
    if (e.key === "Enter" && !e.shiftKey && !touch && !e.nativeEvent.isComposing) send(e);
  };
  return (
    <form
      onSubmit={send}
      aria-label="Message the concierge"
      className="flex flex-col rounded-[22px] border border-line-2 bg-white shadow-[0_1px_2px_rgba(24,32,38,0.05),0_10px_30px_rgba(24,32,38,0.06)] transition-[border-color,box-shadow] focus-within:border-teal/50 focus-within:shadow-[0_0_0_3px_rgba(14,90,100,0.12),0_10px_30px_rgba(24,32,38,0.06)]"
    >
      {photos.length > 0 && (
        <div className="flex gap-2 px-3 pt-3">
          {photos.map((p, i) => (
            <span key={p.thumb.slice(-24)} className="relative">
              {/* biome-ignore lint/performance/noImgElement: a local data URL preview */}
              <img
                src={p.thumb}
                alt={`Attachment ${i + 1}`}
                className="size-16 rounded-xl border border-line object-cover"
              />
              <button
                type="button"
                aria-label={`Remove photo ${i + 1}`}
                onClick={() => setPhotos((all) => all.filter((x) => x !== p))}
                className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full bg-ink text-white"
              >
                <CloseIcon size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      <label htmlFor="msg" className="sr-only">
        Message
      </label>
      <textarea
        id="msg"
        ref={area}
        rows={1}
        value={text}
        maxLength={4000}
        enterKeyHint="send"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKey}
        placeholder={placeholder}
        className="block max-h-[200px] min-h-12 w-full resize-none bg-transparent px-4 pt-3.5 pb-1 text-base leading-6 outline-none placeholder:text-[#6B747C] focus-visible:outline-none"
      />
      <div className="flex items-center gap-2 px-2.5 pt-1 pb-2.5">
        <input
          ref={picker}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => void addPhotos(e.target.files)}
        />
        <button
          type="button"
          aria-label="Add a photo"
          title="Add a photo: a ticket, a booking, a hotel page"
          disabled={disabled || photos.length >= 3}
          onClick={() => picker.current?.click()}
          className="flex size-9 max-md:size-11 flex-none items-center justify-center rounded-full text-ink-3 hover:bg-side disabled:opacity-35"
        >
          <ImageIcon size={20} />
        </button>
        {photoError && <span className="text-xs text-bad">{photoError}</span>}
        {toolbar}
        <span className="flex-1" />
        <button
          type="submit"
          aria-label="Send"
          disabled={disabled || (!text.trim() && photos.length === 0)}
          className="flex size-10 max-md:size-11 flex-none items-center justify-center rounded-full bg-teal text-white transition-opacity hover:bg-teal-dark disabled:opacity-35"
        >
          <SendIcon />
        </button>
      </div>
    </form>
  );
}
