"use client";

import { useEffect } from "react";
import {
  CARD_SCAN_FRAME_CSS_COLOR,
  CARD_SCAN_FRAME_VERSION,
  cardScanFrameInsets,
} from "../../lib/card-scan-frame-policy";

const GUARDED_FORM_ENDPOINTS = new Set([
  "/api/admin/pending-card-import",
  "/api/admin/quick-list",
  "/api/instacomp/scan",
  "/api/instacomp/scan-fast",
  "/api/instacomp/draft-listings",
  "/api/account/seller/inventory/instacomp",
  "/api/account/seller/inventory/instacomp-universal",
]);
const FULL_CARD_IMAGE_FIELD = /^(?:frontImage|backImage)(?:-\d+)?$/i;
const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const MAX_STORAGE_FRAME_BYTES = 11_500_000;
const MAX_SCAN_FRAME_BYTES = 1_050_000;
const MAX_STORAGE_LONGEST_SIDE = 4200;
const MAX_SCAN_LONGEST_SIDE = 2800;

function uploadUrl(input: RequestInfo | URL) {
  const value =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url;

  try {
    return new URL(value, window.location.href);
  } catch {
    return null;
  }
}

function isScanEndpoint(pathname: string) {
  return (
    pathname === "/api/instacomp/scan" ||
    pathname === "/api/instacomp/scan-fast" ||
    pathname.endsWith("/inventory/instacomp") ||
    pathname.endsWith("/inventory/instacomp-universal")
  );
}

function framedFileName(file: File) {
  const base = file.name.replace(/\.[^.]+$/, "") || "card-scan";
  return `${base}-whole-card.jpg`;
}

function loadLocalImage(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error(`Could not read ${file.name} as a card image.`));
    };
    image.src = objectUrl;
  });
}

function canvasJpeg(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("The browser could not create the framed card image."));
      },
      "image/jpeg",
      quality,
    );
  });
}

async function frameWholeCardFile(
  file: File,
  options: { maxBytes: number; maxLongestSide: number },
) {
  if (file.name.toLowerCase().includes("-whole-card.")) return file;

  if (!ALLOWED_IMAGE_TYPES.has(file.type.toLowerCase())) {
    throw new Error(
      `${file.name} must be a JPEG, PNG, or WebP so the whole-card safety frame can be applied.`,
    );
  }

  const image = await loadLocalImage(file);
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;

  if (!sourceWidth || !sourceHeight) {
    throw new Error(`Could not measure ${file.name} before upload.`);
  }

  let scale = Math.min(
    1,
    options.maxLongestSide / Math.max(sourceWidth, sourceHeight),
  );
  let lastBlob: Blob | null = null;

  for (let attempt = 0; attempt < 7; attempt += 1) {
    const renderedWidth = Math.max(1, Math.round(sourceWidth * scale));
    const renderedHeight = Math.max(1, Math.round(sourceHeight * scale));
    const frame = cardScanFrameInsets(renderedWidth, renderedHeight);
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");

    if (!context) {
      throw new Error("The browser could not prepare the whole-card upload canvas.");
    }

    canvas.width = renderedWidth + frame.left + frame.right;
    canvas.height = renderedHeight + frame.top + frame.bottom;
    context.fillStyle = CARD_SCAN_FRAME_CSS_COLOR;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(
      image,
      frame.left,
      frame.top,
      renderedWidth,
      renderedHeight,
    );

    for (const quality of [0.94, 0.88, 0.82, 0.76, 0.7, 0.64, 0.58]) {
      const blob = await canvasJpeg(canvas, quality);
      lastBlob = blob;

      if (blob.size <= options.maxBytes) {
        return new File([blob], framedFileName(file), {
          type: "image/jpeg",
          lastModified: file.lastModified || Date.now(),
        });
      }
    }

    scale *= 0.84;
  }

  throw new Error(
    `${file.name} could not be safely framed below the upload limit${
      lastBlob ? ` (${Math.ceil(lastBlob.size / 1024)} KB)` : ""
    }. Upload stopped instead of saving a tight or cropped-looking scan.`,
  );
}

async function frameFormData(pathname: string, formData: FormData) {
  const framed = new FormData();
  let changed = false;
  const scanEndpoint = isScanEndpoint(pathname);

  for (const [key, value] of formData.entries()) {
    if (value instanceof File && FULL_CARD_IMAGE_FIELD.test(key) && value.size > 0) {
      const nextFile = await frameWholeCardFile(value, {
        maxBytes: scanEndpoint
          ? MAX_SCAN_FRAME_BYTES
          : MAX_STORAGE_FRAME_BYTES,
        maxLongestSide: scanEndpoint
          ? MAX_SCAN_LONGEST_SIDE
          : MAX_STORAGE_LONGEST_SIDE,
      });
      framed.append(key, nextFile, nextFile.name);
      changed = changed || nextFile !== value;
      continue;
    }

    framed.append(key, value);
  }

  return changed ? framed : formData;
}

export default function WholeCardUploadGuard() {
  useEffect(() => {
    const previousFetch = window.fetch;

    const guardedFetch: typeof window.fetch = async (input, init) => {
      const url = uploadUrl(input);
      const body = init?.body;

      if (
        !url ||
        url.origin !== window.location.origin ||
        !GUARDED_FORM_ENDPOINTS.has(url.pathname) ||
        !(body instanceof FormData)
      ) {
        return previousFetch(input, init);
      }

      const framedBody = await frameFormData(url.pathname, body);

      if (framedBody === body) {
        return previousFetch(input, init);
      }

      const headers = new Headers(
        input instanceof Request ? input.headers : undefined,
      );
      new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
      headers.delete("content-type");

      return previousFetch(input, {
        ...init,
        body: framedBody,
        headers,
      });
    };

    window.fetch = guardedFetch;
    document.documentElement.dataset.cardScanFrame = CARD_SCAN_FRAME_VERSION;

    return () => {
      if (window.fetch === guardedFetch) window.fetch = previousFetch;
      delete document.documentElement.dataset.cardScanFrame;
    };
  }, []);

  return null;
}
