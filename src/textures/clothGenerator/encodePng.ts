export function rgbaToCanvas(
  rgba: Uint8Array,
  width: number,
  height: number,
  canvas: HTMLCanvasElement,
): void {
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Could not acquire 2D canvas context');
  }
  const imageData = new ImageData(new Uint8ClampedArray(rgba), width, height);
  ctx.putImageData(imageData, 0, 0);
}

export function downloadCanvasPng(filename: string, canvas: HTMLCanvasElement): void {
  canvas.toBlob((blob) => {
    if (!blob) {
      return;
    }
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }, 'image/png');
}

export function downloadRgbaAsPng(
  filename: string,
  rgba: Uint8Array,
  width: number,
  height: number,
): void {
  const canvas = document.createElement('canvas');
  rgbaToCanvas(rgba, width, height, canvas);
  downloadCanvasPng(filename, canvas);
}
