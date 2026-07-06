import crypto from "crypto";
import { prisma } from "../../../shared/infrastructure/PrismaClient";

export const SECRET_KEYS = [
  "STEAM_API_KEY",
  "STEAMWEBAPI_API_KEY",
  "MERCADOPAGO_ACCESS_TOKEN",
  "MERCADOPAGO_WEBHOOK_SECRET",
  "NOWPAYMENTS_API_KEY",
  "NOWPAYMENTS_IPN_SECRET",
  "PAYPAL_CLIENT_ID",
  "PAYPAL_CLIENT_SECRET",
  "PAYPAL_SANDBOX",
] as const;

export type SecretKey = (typeof SECRET_KEYS)[number];

export const RUNTIME_SETTING_KEYS = [
  "STORE_SYNC_INTERVAL_MINUTES",
  "ENABLE_ITEMS_CATALOG_SYNC",
  "ITEMS_CATALOG_SYNC_INTERVAL_MINUTES",
  "MARKET_SYNC_PAGE_SIZE",
  "MARKET_SYNC_MAX_PAGES",
  "MARKET_SYNC_MIN_PRICE",
  "MARKET_SYNC_SORT",
  "FLOAT_SYNC_SORT",
  "ENABLE_SYNC",
] as const;

export const EDITABLE_RUNTIME_SETTING_KEYS = [
  "ENABLE_SYNC",
  "ENABLE_ITEMS_CATALOG_SYNC",
] as const;

export type RuntimeSettingKey = (typeof RUNTIME_SETTING_KEYS)[number];

const isSecretKey = (key: string): key is SecretKey => {
  return SECRET_KEYS.includes(key as SecretKey);
};

const isRuntimeSettingKey = (key: string): key is RuntimeSettingKey => {
  return RUNTIME_SETTING_KEYS.includes(key as RuntimeSettingKey);
};

const getEncryptionKey = () => {
  const rawKey = process.env.ADMIN_SECRETS_ENCRYPTION_KEY;
  if (!rawKey) {
    throw new Error("ADMIN_SECRETS_ENCRYPTION_KEY no está configurada.");
  }

  const normalizedKey = rawKey
    .trim()
    .replace(/^\uFEFF/, "")
    .replace(/^['"]|['"]$/g, "");

  const isBase64Key =
    /^[A-Za-z0-9+/]+={0,2}$/.test(normalizedKey) &&
    normalizedKey.length % 4 === 0;

  if (isBase64Key) {
    const decoded = Buffer.from(normalizedKey, "base64");
    if (decoded.length === 32) return decoded;
  }

  const utf8 = Buffer.from(normalizedKey, "utf8");
  if (utf8.length === 32) return utf8;

  throw new Error(
    `ADMIN_SECRETS_ENCRYPTION_KEY debe tener 32 bytes o ser base64 de 32 bytes. Longitud actual: ${normalizedKey.length} caracteres.`,
  );
};

const assertMasterPassword = (password?: string) => {
  const expectedPassword = process.env.ADMIN_SECRETS_PASSWORD;
  if (!expectedPassword) {
    throw new Error("ADMIN_SECRETS_PASSWORD no está configurada.");
  }

  const provided = Buffer.from(password || "", "utf8");
  const expected = Buffer.from(expectedPassword, "utf8");
  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
    throw new Error("Contraseña maestra inválida.");
  }
};

const encryptValue = (value: string) => {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    encryptedValue: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
  };
};

const decryptValue = (record: { encryptedValue: string; iv: string; authTag: string }) => {
  const key = getEncryptionKey();
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(record.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(record.authTag, "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(record.encryptedValue, "base64")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
};

const getLast4 = (value: string) => {
  return value.length <= 4 ? value : value.slice(-4);
};

const envFallback = (key: SecretKey) => {
  if (key === "PAYPAL_CLIENT_ID") {
    return process.env.PAYPAL_CLIENT_ID || process.env.PAYPAY_CLIENT_ID || "";
  }
  if (key === "PAYPAL_CLIENT_SECRET") {
    return process.env.PAYPAL_CLIENT_SECRET || process.env.PAYPAY_CLIENT_SECRET || "";
  }
  return process.env[key] || "";
};

const audit = async (adminId: string | undefined, action: string, target: string) => {
  await prisma.adminAuditLog.create({
    data: {
      adminId: adminId ?? null,
      action,
      target,
    },
  });
};

export class AdminSecureConfigService {
  static listSecretStatus() {
    return Promise.all(
      SECRET_KEYS.map(async (key) => {
        const setting = await prisma.encryptedSetting.findUnique({ where: { key } });
        const fallback = envFallback(key);
        return {
          key,
          configured: Boolean(setting || fallback),
          source: setting ? "database" : fallback ? "env" : "missing",
          last4: setting?.last4 || (fallback ? getLast4(fallback) : null),
          updatedAt: setting?.updatedAt || null,
        };
      }),
    );
  }

  static async upsertSecret(key: string, value: string, password: string | undefined, adminId?: string) {
    if (!isSecretKey(key)) throw new Error("Secret key inválida.");
    assertMasterPassword(password);
    if (!value || value.trim().length === 0) {
      throw new Error("El valor del secreto no puede estar vacío.");
    }

    const encrypted = encryptValue(value.trim());
    const setting = await prisma.encryptedSetting.upsert({
      where: { key },
      create: {
        key,
        ...encrypted,
        last4: getLast4(value.trim()),
        updatedByAdminId: adminId ?? null,
      },
      update: {
        ...encrypted,
        last4: getLast4(value.trim()),
        updatedByAdminId: adminId ?? null,
      },
    });

    await audit(adminId, "secret.upsert", key);
    return {
      key,
      configured: true,
      source: "database",
      last4: setting.last4,
      updatedAt: setting.updatedAt,
    };
  }

  static async revealSecret(key: string, password: string | undefined, adminId?: string) {
    if (!isSecretKey(key)) throw new Error("Secret key inválida.");
    assertMasterPassword(password);

    const setting = await prisma.encryptedSetting.findUnique({ where: { key } });
    const value = setting ? decryptValue(setting) : envFallback(key);
    if (!value) throw new Error("Secreto no configurado.");

    await audit(adminId, "secret.reveal", key);
    return { key, value, source: setting ? "database" : "env" };
  }

  static async deleteSecret(key: string, password: string | undefined, adminId?: string) {
    if (!isSecretKey(key)) throw new Error("Secret key inválida.");
    assertMasterPassword(password);
    await prisma.encryptedSetting.deleteMany({ where: { key } });
    await audit(adminId, "secret.delete", key);
    return { key, deleted: true };
  }

  static async getSecretValue(key: SecretKey) {
    const setting = await prisma.encryptedSetting.findUnique({ where: { key } });
    if (setting) return decryptValue(setting);
    return envFallback(key);
  }

  static async getRuntimeSettings() {
    const settings = await prisma.runtimeSetting.findMany();
    const map = new Map(settings.map((setting) => [setting.key, setting.value]));

    return Object.fromEntries(
      RUNTIME_SETTING_KEYS.map((key) => [key, map.get(key) ?? process.env[key] ?? ""]),
    );
  }

  static async updateRuntimeSettings(values: Record<string, unknown>, adminId?: string) {
    const entries = Object.entries(values).filter(([key]) =>
      EDITABLE_RUNTIME_SETTING_KEYS.includes(key as any)
    );

    await prisma.$transaction(
      entries.map(([key, value]) =>
        prisma.runtimeSetting.upsert({
          where: { key },
          create: {
            key,
            value: String(value ?? ""),
            updatedByAdminId: adminId ?? null,
          },
          update: {
            value: String(value ?? ""),
            updatedByAdminId: adminId ?? null,
          },
        }),
      ),
    );

    await audit(adminId, "runtime.update", "runtime-settings");
    return this.getRuntimeSettings();
  }
}

