import crypto from "crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockFindUnique, mockAuditCreate } = vi.hoisted(() => ({
  mockFindUnique: vi.fn(),
  mockAuditCreate: vi.fn(),
}));

vi.mock("../../../../shared/infrastructure/PrismaClient", () => ({
  prisma: {
    encryptedSetting: {
      findUnique: mockFindUnique,
    },
    adminAuditLog: {
      create: mockAuditCreate,
    },
  },
}));

import { AdminSecureConfigService } from "../AdminSecureConfigService";

function encryptForTest(plaintext: string, rawKey: string) {
  const key = Buffer.from(rawKey, "utf8");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    encryptedValue: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
  };
}

describe("AdminSecureConfigService", () => {
  const testKey = "12345678901234567890123456789012";
  const originalEncryptionKey = process.env.ADMIN_SECRETS_ENCRYPTION_KEY;
  const originalMasterPassword = process.env.ADMIN_SECRETS_PASSWORD;
  const originalSendGridFrom = process.env.SENDGRID_FROM;

  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockFindUnique.mockReset();
    mockAuditCreate.mockReset();
  });

  afterEach(() => {
    process.env.ADMIN_SECRETS_ENCRYPTION_KEY = originalEncryptionKey;
    process.env.ADMIN_SECRETS_PASSWORD = originalMasterPassword;
    if (originalSendGridFrom === undefined) {
      delete process.env.SENDGRID_FROM;
    } else {
      process.env.SENDGRID_FROM = originalSendGridFrom;
    }
    vi.restoreAllMocks();
  });

  it("prioritizes cleaned .env value over DB secret in getSecretValue, listSecretStatus, and revealSecret", async () => {
    process.env.ADMIN_SECRETS_ENCRYPTION_KEY = testKey;
    process.env.ADMIN_SECRETS_PASSWORD = "master-secret-password";
    process.env.SENDGRID_FROM = ' "env-notificaciones@jabbustore.com" ';

    const dbEncrypted = encryptForTest("db-old@jabbustore.com", testKey);
    mockFindUnique.mockImplementation(async ({ where }: { where: { key: string } }) => {
      if (where.key === "SENDGRID_FROM") {
        return {
          key: "SENDGRID_FROM",
          ...dbEncrypted,
          last4: ".com",
          updatedAt: new Date("2026-08-01T00:00:00Z"),
        };
      }
      return null;
    });

    const value = await AdminSecureConfigService.getSecretValue("SENDGRID_FROM");
    expect(value).toBe("env-notificaciones@jabbustore.com");
    expect(mockFindUnique).not.toHaveBeenCalled();

    const revealed = await AdminSecureConfigService.revealSecret(
      "SENDGRID_FROM",
      "master-secret-password",
      "admin-1",
    );
    expect(revealed).toEqual({
      key: "SENDGRID_FROM",
      value: "env-notificaciones@jabbustore.com",
      source: "env",
    });

    const statuses = await AdminSecureConfigService.listSecretStatus();
    const sendgridFromStatus = statuses.find((s) => s.key === "SENDGRID_FROM");
    expect(sendgridFromStatus).toMatchObject({
      key: "SENDGRID_FROM",
      configured: true,
      source: "env",
    });
  });

  it("falls back to DB secret when .env variable is absent", async () => {
    process.env.ADMIN_SECRETS_ENCRYPTION_KEY = testKey;
    process.env.ADMIN_SECRETS_PASSWORD = "master-secret-password";
    delete process.env.SENDGRID_FROM;

    const dbEncrypted = encryptForTest("db-notificaciones@jabbustore.com", testKey);
    mockFindUnique.mockResolvedValue({
      key: "SENDGRID_FROM",
      ...dbEncrypted,
      last4: ".com",
      updatedAt: new Date("2026-08-01T00:00:00Z"),
    });

    const value = await AdminSecureConfigService.getSecretValue("SENDGRID_FROM");
    expect(value).toBe("db-notificaciones@jabbustore.com");

    const revealed = await AdminSecureConfigService.revealSecret(
      "SENDGRID_FROM",
      "master-secret-password",
      "admin-1",
    );
    expect(revealed).toEqual({
      key: "SENDGRID_FROM",
      value: "db-notificaciones@jabbustore.com",
      source: "database",
    });
  });

  it("returns empty string cleanly when .env is empty and DB secret cannot be decrypted", async () => {
    process.env.ADMIN_SECRETS_ENCRYPTION_KEY = "invalid-key-mismatch";
    delete process.env.SENDGRID_FROM;
    mockFindUnique.mockResolvedValue({
      key: "SENDGRID_FROM",
      encryptedValue: "AAAA",
      iv: "BBBB",
      authTag: "CCCC",
    });

    const value = await AdminSecureConfigService.getSecretValue("SENDGRID_FROM");
    expect(value).toBe("");
  });
});
