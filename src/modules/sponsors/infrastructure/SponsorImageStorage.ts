import crypto from "crypto";
import fs from "fs";
import path from "path";
import multer from "multer";
import type { SponsorImageMetadata } from "../domain/Sponsor";

const MAX_SPONSOR_IMAGE_SIZE_BYTES = 2 * 1024 * 1024;
const STORAGE_ROOT = path.resolve(
  process.env.SPONSOR_IMAGES_DIR || path.join(process.cwd(), "storage", "sponsors"),
);

const ALLOWED_TYPES: Record<string, { extension: string; label: string }> = {
  "image/jpeg": { extension: ".jpg", label: "JPG" },
  "image/png": { extension: ".png", label: "PNG" },
  "image/webp": { extension: ".webp", label: "WEBP" },
};

export const uploadSponsorImage = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_SPONSOR_IMAGE_SIZE_BYTES,
    files: 1,
  },
});

const hasJpegSignature = (buffer: Buffer) => {
  return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
};

const hasPngSignature = (buffer: Buffer) => {
  return (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  );
};

const hasWebpSignature = (buffer: Buffer) => {
  return (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  );
};

const detectMimeType = (buffer: Buffer) => {
  if (hasJpegSignature(buffer)) return "image/jpeg";
  if (hasPngSignature(buffer)) return "image/png";
  if (hasWebpSignature(buffer)) return "image/webp";
  return null;
};

const sanitizeOriginalName = (name: string) => {
  return path
    .basename(name || "sponsor")
    .replace(/[^\w.\-() ]+/g, "_")
    .slice(0, 120);
};

export const saveSponsorImage = async (
  file?: Express.Multer.File,
): Promise<SponsorImageMetadata> => {
  if (!file) {
    throw new Error("No se adjuntó ninguna imagen.");
  }

  if (!file.buffer || file.buffer.length === 0) {
    throw new Error("La imagen está vacía.");
  }

  if (file.size > MAX_SPONSOR_IMAGE_SIZE_BYTES) {
    throw new Error("La imagen supera el tamaño máximo permitido de 2 MB.");
  }

  const detectedMimeType = detectMimeType(file.buffer);
  if (!detectedMimeType || !ALLOWED_TYPES[detectedMimeType]) {
    throw new Error("Formato de imagen no permitido. Usá JPG, PNG o WEBP.");
  }

  if (file.mimetype && file.mimetype !== detectedMimeType) {
    throw new Error("El tipo del archivo no coincide con su contenido real.");
  }

  const imageId = crypto.randomUUID();
  const extension = ALLOWED_TYPES[detectedMimeType].extension;
  const fileName = `${imageId}${extension}`;
  const filePath = path.join(STORAGE_ROOT, fileName);

  await fs.promises.mkdir(STORAGE_ROOT, { recursive: true });
  await fs.promises.writeFile(filePath, file.buffer, { flag: "wx" });

  return {
    storageKey: fileName,
    mimeType: detectedMimeType,
    size: file.size,
    originalName: sanitizeOriginalName(file.originalname),
  };
};

export const resolveSponsorImagePath = (storageKey: string) => {
  if (!storageKey || storageKey.includes("..")) {
    throw new Error("Imagen de sponsor inválida.");
  }

  const imagePath = path.resolve(STORAGE_ROOT, storageKey);
  if (!imagePath.startsWith(STORAGE_ROOT)) {
    throw new Error("Imagen de sponsor inválida.");
  }

  return imagePath;
};

export const removeSponsorImage = async (storageKey: string | null | undefined) => {
  if (!storageKey) return;

  try {
    await fs.promises.unlink(resolveSponsorImagePath(storageKey));
  } catch (error: any) {
    if (error?.code !== "ENOENT") {
      console.warn("[SponsorImageStorage] Could not remove sponsor image:", error);
    }
  }
};
