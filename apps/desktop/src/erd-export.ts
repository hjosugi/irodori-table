const ERD_EXPORT_MAX_CANVAS_SIDE = 16_384;
const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function erdFileName(connectionId: string, extension: string) {
  const safeConnectionId = sanitizeFileNamePart(connectionId, "connection");
  const safeExtension =
    sanitizeFileNamePart(extension, "dat").replace(/\./g, "").toLowerCase() || "dat";
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `irodori-erd-${safeConnectionId}-${timestamp}.${safeExtension}`;
}

function sanitizeFileNamePart(value: string, fallback: string) {
  const sanitized = value
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return sanitized || fallback;
}

export function serializeSvgElement(svg: SVGSVGElement) {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  if (clone.namespaceURI === SVG_NAMESPACE) {
    clone.removeAttribute("xmlns");
  } else if (!clone.hasAttribute("xmlns")) {
    clone.setAttribute("xmlns", SVG_NAMESPACE);
  }
  clone.setAttribute("version", "1.1");
  clone.querySelectorAll("style").forEach((style) => {
    style.setAttribute("type", "text/css");
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(clone)}`;
}

function dataUrlToBlob(dataUrl: string) {
  const [metadata, data] = dataUrl.split(",", 2);
  const mime = metadata.match(/^data:([^;,]+)/)?.[1] ?? "image/png";
  const binary = window.atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: mime });
}

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    if (typeof canvas.toBlob === "function") {
      canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error("Could not encode PNG"));
        }
      }, "image/png");
      return;
    }
    try {
      resolve(dataUrlToBlob(canvas.toDataURL("image/png")));
    } catch (error) {
      reject(error);
    }
  });
}

function erdPngScale(width: number, height: number) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error("ERD has invalid dimensions");
  }
  const maxSafeScale = Math.min(
    ERD_EXPORT_MAX_CANVAS_SIDE / width,
    ERD_EXPORT_MAX_CANVAS_SIDE / height,
  );
  if (maxSafeScale < 1) {
    throw new Error("ERD is too large to export as PNG; export SVG instead");
  }
  const deviceScale = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  return Math.min(deviceScale, maxSafeScale);
}

export function svgMarkupToPngBlob(
  svgMarkup: string,
  width: number,
  height: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const svgBlob = new Blob([svgMarkup], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(svgBlob);
    const image = new Image();
    image.onload = () => {
      try {
        const scale = erdPngScale(width, height);
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(width * scale);
        canvas.height = Math.ceil(height * scale);
        const context = canvas.getContext("2d");
        if (!context) {
          throw new Error("Canvas is not available");
        }
        context.setTransform(scale, 0, 0, scale, 0, 0);
        context.drawImage(image, 0, 0, width, height);
        URL.revokeObjectURL(url);
        void canvasToPngBlob(canvas).then(resolve, reject);
      } catch (error) {
        URL.revokeObjectURL(url);
        reject(error);
      }
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not render SVG"));
    };
    image.src = url;
  });
}

function legacyCopyTextToClipboard(text: string) {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  document.body.append(textarea);
  textarea.focus();
  textarea.select();
  try {
    return document.execCommand("copy");
  } finally {
    textarea.remove();
  }
}

export async function writeTextToClipboard(text: string) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch (error) {
      if (legacyCopyTextToClipboard(text)) {
        return;
      }
      throw error;
    }
  }
  if (!legacyCopyTextToClipboard(text)) {
    throw new Error("Text clipboard is not available in this environment");
  }
}

export async function writePngBlobToClipboard(blob: Blob) {
  const clipboard = navigator.clipboard;
  const ClipboardItemCtor = window.ClipboardItem;
  if (
    !clipboard ||
    typeof clipboard.write !== "function" ||
    typeof ClipboardItemCtor !== "function"
  ) {
    throw new Error("PNG clipboard is not available in this environment");
  }
  if (
    typeof ClipboardItemCtor.supports === "function" &&
    !ClipboardItemCtor.supports("image/png")
  ) {
    throw new Error("PNG clipboard is not supported in this environment");
  }
  const pngBlob = blob.type === "image/png" ? blob : new Blob([blob], { type: "image/png" });
  await clipboard.write([new ClipboardItemCtor({ "image/png": pngBlob })]);
}
