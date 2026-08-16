export type CropAreaPixels = { x: number; y: number; width: number; height: number };

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener("load", () => resolve(image));
    image.addEventListener("error", (event) => reject(event));
    image.src = src;
  });
}

/**
 * Renders just the cropped region of `imageSrc` onto an off-screen
 * canvas sized to the crop itself, then exports it — the standard
 * "crop with a canvas" recipe (see react-easy-crop's own docs), kept
 * here rather than inline in AvatarUploadButton.tsx so it's testable on
 * its own crop-area math without needing a real <img>/canvas in a test.
 */
export async function getCroppedImageBlob(imageSrc: string, area: CropAreaPixels, mimeType: string): Promise<Blob> {
  const image = await loadImage(imageSrc);
  const canvas = document.createElement("canvas");
  canvas.width = area.width;
  canvas.height = area.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context is not available in this browser.");

  ctx.drawImage(image, area.x, area.y, area.width, area.height, 0, 0, area.width, area.height);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Canvas produced an empty image."))), mimeType);
  });
}
