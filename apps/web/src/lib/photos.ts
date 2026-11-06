import type { ChatImage } from "@app/shared";

/** A photo ready to send: the image Claude reads, and a thumbnail to keep in the chat. */
export interface Photo {
  image: ChatImage;
  thumb: string; // data:image/jpeg;base64,…
}

const MAX_SIDE = 1568; // Claude reads images up to about this size without shrinking them
const THUMB_SIDE = 320;

async function draw(file: File, side: number, quality: number): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, side / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", quality);
}

/** Shrinks a photo on this device before it's sent: quicker, and cheaper for Claude to read. */
export async function toPhoto(file: File): Promise<Photo> {
  if (!file.type.startsWith("image/")) throw new Error("That isn't an image.");
  const [full, thumb] = await Promise.all([
    draw(file, MAX_SIDE, 0.85),
    draw(file, THUMB_SIDE, 0.7),
  ]);
  return { image: { mediaType: "image/jpeg", data: full.split(",")[1] ?? "" }, thumb };
}
