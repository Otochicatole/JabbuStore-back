import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockFindUnique } = vi.hoisted(() => ({
  mockFindUnique: vi.fn(),
}));

vi.mock("../../../../shared/infrastructure/PrismaClient", () => ({
  prisma: {
    encryptedSetting: {
      findUnique: mockFindUnique,
    },
  },
}));

import { AdminSecureConfigService } from "../AdminSecureConfigService";

describe("AdminSecureConfigService.getSecretValue", () => {
  const originalEncryptionKey = process.env.ADMIN_SECRETS_ENCRYPTION_KEY;
  const originalResendFrom = process.env.RESEND_FROM;

  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    process.env.ADMIN_SECRETS_ENCRYPTION_KEY = originalEncryptionKey;
    process.env.RESEND_FROM = originalResendFrom;
    vi.restoreAllMocks();
  });

  it("falls back to cleaned env value when DB secret cannot be decrypted", async () => {
    process.env.ADMIN_SECRETS_ENCRYPTION_KEY = "invalid-key-mismatch";
    process.env.RESEND_FROM = ' "notificaciones@jabbustore.com" ';
    mockFindUnique.mockResolvedValue({
      key: "RESEND_FROM",
      encryptedValue: "AAAA",
      iv: "BBBB",
      authTag: "CCCC",
    });

    const value = await AdminSecureConfigService.getSecretValue("RESEND_FROM");
    expect(value).toBe("notificaciones@jabbustore.com");
  });
});
