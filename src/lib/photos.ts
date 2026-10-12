import { savePhoto } from "./data/store";

export { photoUrl } from "./data/store";

// Reads an image file and downscales it to a JPEG Blob. Journal photos use the defaults; profile pictures pass
// a smaller `maxSide`, since they're shown as avatars.
export function resizePhoto(file: File, maxSide = 2048, quality = 0.85): Promise<{ blob: Blob; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    const finish = () => URL.revokeObjectURL(url);
    img.onerror = () => { finish(); reject(new Error("Unsupported image")); };
    img.onload = () => {
      finish();
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const width = Math.round(img.width * scale);
      const height = Math.round(img.height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) { resolve({ blob: file, width: img.width, height: img.height }); return; }
      // JPEG has no transparency; paint a white backdrop so transparent PNGs don't turn black.
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob(blob => {
        if (!blob) { reject(new Error("Unsupported image")); return; }
        // A small image can grow when re-encoded; keep the original then.
        const keepOriginal = scale === 1 && /^image\/(jpeg|png|webp)$/.test(file.type) && file.size < blob.size;
        resolve(keepOriginal ? { blob: file, width, height } : { blob, width, height });
      }, "image/jpeg", quality);
    };
    img.src = url;
  });
}

// Resizes and stores an uploaded image; resolves to the reference to keep in a record. Rejects with
// "unsupported" for files that aren't readable images, or with the storage failure.
export async function addPhoto(file: File, maxSide?: number, quality?: number): Promise<string> {
  let resized: Awaited<ReturnType<typeof resizePhoto>>;
  try {
    resized = await resizePhoto(file, maxSide, quality);
  } catch {
    throw new Error("unsupported");
  }
  const saved = await savePhoto(resized.blob, { width: resized.width, height: resized.height });
  if (!saved.ok) throw new Error(saved.failure);
  return saved.ref;
}
