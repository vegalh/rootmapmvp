// Reads an image file and downscales it to a JPEG data URL so photos stay small enough for localStorage.
// Journal photos use the defaults; profile pictures pass a smaller `maxSide`, since they're shown as avatars.
export function resizePhoto(file: File, maxSide = 1280, quality = 0.78): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Unsupported image"));
      img.onload = () => {
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext("2d");
        if (!ctx) return resolve(reader.result as string);
        // JPEG has no transparency; paint a white backdrop so transparent PNGs don't turn black.
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const resized = canvas.toDataURL("image/jpeg", quality);
        // A small image can grow when re-encoded; keep the original then.
        const original = reader.result as string;
        resolve(scale === 1 && /^data:image\/(jpeg|png|webp);/.test(original) && original.length < resized.length ? original : resized);
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}
