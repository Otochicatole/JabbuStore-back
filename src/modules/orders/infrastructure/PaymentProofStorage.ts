import crypto from "crypto";
import fs from "fs";
import path from "path";
import multer from "multer";

const MAX_PAYMENT_PROOF_SIZE_BYTES = 10 * 1024 * 1024;
const STORAGE_ROOT = path.resolve(
  process.env.PAYMENT_PROOFS_DIR || path.join(process.cwd(), "storage", "payment-proofs"),
);

const ALLOWED_TYPES: Record<string, { extension: string; label: string }> = {
  "image/jpeg": { extension: ".jpg", label: "JPEG" },
  "image/png": { extension: ".png", label: "PNG" },
  "image/webp": { extension: ".webp", label: "WEBP" },
  "image/gif": { extension: ".gif", label: "GIF" },
  "application/pdf": { extension: ".pdf", label: "PDF" },
};

export interface PaymentProofMetadata {
  id: string;
  fileName: string;
  mimeType: string;
  size: number;
  storageKey: string;
  uploadedAt: string;
  uploadedBy: "buyer" | "admin";
}

export const uploadPaymentProof = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_PAYMENT_PROOF_SIZE_BYTES,
    files: 1,
  },
});

const hasPdfSignature = (buffer: Buffer) => {
  return buffer.length >= 4 && buffer.subarray(0, 4).toString("ascii") === "%PDF";
};

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

const hasGifSignature = (buffer: Buffer) => {
  if (buffer.length < 6) return false;
  const signature = buffer.subarray(0, 6).toString("ascii");
  return signature === "GIF87a" || signature === "GIF89a";
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
  if (hasGifSignature(buffer)) return "image/gif";
  if (hasPdfSignature(buffer)) return "application/pdf";
  return null;
};

const sanitizeOriginalName = (name: string) => {
  return path
    .basename(name || "comprobante")
    .replace(/[^\w.\-() ]+/g, "_")
    .slice(0, 120);
};

export const savePaymentProof = async (
  orderId: string,
  uploadedBy: "buyer" | "admin",
  file?: Express.Multer.File,
): Promise<PaymentProofMetadata> => {
  if (!file) {
    throw new Error("No se adjuntó ningún comprobante.");
  }

  if (!file.buffer || file.buffer.length === 0) {
    throw new Error("El comprobante está vacío.");
  }

  if (file.size > MAX_PAYMENT_PROOF_SIZE_BYTES) {
    throw new Error("El comprobante supera el tamaño máximo permitido de 10 MB.");
  }

  const detectedMimeType = detectMimeType(file.buffer);
  if (!detectedMimeType || !ALLOWED_TYPES[detectedMimeType]) {
    throw new Error("Formato de comprobante no permitido. Usá JPG, PNG, WEBP, GIF o PDF.");
  }

  if (file.mimetype && file.mimetype !== detectedMimeType) {
    throw new Error("El tipo del archivo no coincide con su contenido real.");
  }

  const proofId = crypto.randomUUID();
  const extension = ALLOWED_TYPES[detectedMimeType].extension;
  const storageDir = path.join(STORAGE_ROOT, orderId);
  const fileName = `${proofId}${extension}`;
  const filePath = path.join(storageDir, fileName);
  const storageKey = `${orderId}/${fileName}`;

  await fs.promises.mkdir(storageDir, { recursive: true });
  await fs.promises.writeFile(filePath, file.buffer, { flag: "wx" });

  return {
    id: proofId,
    fileName: sanitizeOriginalName(file.originalname),
    mimeType: detectedMimeType,
    size: file.size,
    storageKey,
    uploadedAt: new Date().toISOString(),
    uploadedBy,
  };
};

export const resolvePaymentProofPath = (proof: PaymentProofMetadata) => {
  if (!proof.storageKey || proof.storageKey.includes("..")) {
    throw new Error("Comprobante inválido.");
  }

  const proofPath = path.resolve(STORAGE_ROOT, proof.storageKey);
  if (!proofPath.startsWith(STORAGE_ROOT)) {
    throw new Error("Comprobante inválido.");
  }

  return proofPath;
};

