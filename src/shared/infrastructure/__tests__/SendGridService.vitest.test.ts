import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockSend, mockSetApiKey, mockSetTimeout, mockGetSecretValue } = vi.hoisted(() => ({
  mockSend: vi.fn(),
  mockSetApiKey: vi.fn(),
  mockSetTimeout: vi.fn(),
  mockGetSecretValue: vi.fn(),
}));

vi.mock("@sendgrid/mail", () => {
  class MockMailService {
    setApiKey = mockSetApiKey;
    setTimeout = mockSetTimeout;
    send = mockSend;
  }

  return {
    default: new MockMailService(),
    MailService: MockMailService,
  };
});

vi.mock("../../../modules/marketplace/application/AdminSecureConfigService", () => ({
  AdminSecureConfigService: {
    getSecretValue: mockGetSecretValue,
  },
}));

import {
  SendGridService,
  buildNotificationUrl,
  extractEmailAddress,
  parseFromIdentity,
  parseRecipients,
  resolveFromEmail,
} from "../SendGridService";
import { config } from "../../config";

describe("SendGridService helpers", () => {
  const originalFrontendUrl = config.frontendUrl;

  afterEach(() => {
    config.frontendUrl = originalFrontendUrl;
  });

  it("strips quotes and normalizes sender identity", () => {
    expect(extractEmailAddress(' "notificaciones@jabbustore.com" ')).toBe(
      "notificaciones@jabbustore.com",
    );
    expect(parseFromIdentity('"notificaciones@jabbustore.com"')).toEqual({
      email: "notificaciones@jabbustore.com",
      name: "JabbuStore",
    });
    expect(parseFromIdentity("Equipo Jabbu <soporte@jabbustore.com>")).toEqual({
      email: "soporte@jabbustore.com",
      name: "Equipo Jabbu",
    });
    expect(resolveFromEmail('"notificaciones@jabbustore.com"')).toBe(
      "JabbuStore <notificaciones@jabbustore.com>",
    );
    expect(resolveFromEmail("no-es-un-email")).toBeNull();
  });

  it("parses multiple recipients, trims quotes and deduplicates case-insensitively", () => {
    expect(
      parseRecipients(
        ' "admin1@jabbustore.com", Admin <admin2@jabbustore.com>; ADMIN1@jabbustore.com\ninvalid',
      ),
    ).toEqual(["admin1@jabbustore.com", "admin2@jabbustore.com"]);
  });

  it("uses the first origin from comma-separated FRONTEND_URL", () => {
    config.frontendUrl = "https://jabbustore.com, https://admin.jabbustore.com";
    expect(buildNotificationUrl("/admin/panel/tickets?ticket=abc")).toBe(
      "https://jabbustore.com/es/admin/panel/tickets?ticket=abc",
    );
    expect(buildNotificationUrl("/en/admin/panel/orders/purchase?id=123")).toBe(
      "https://jabbustore.com/en/admin/panel/orders/purchase?id=123",
    );
  });
});

describe("SendGridService.sendNotificationEmail", () => {
  beforeEach(() => {
    mockSend.mockReset();
    mockSetApiKey.mockReset();
    mockSetTimeout.mockReset();
    mockGetSecretValue.mockReset();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("skips cleanly when SENDGRID_FROM or SENDGRID_TO are missing", async () => {
    mockGetSecretValue.mockImplementation(async (key: string) => {
      if (key === "SENDGRID_API_KEY") return "SG.test-key";
      return "";
    });

    const result = await SendGridService.sendNotificationEmail({
      title: "notifications.newBuyOrder.title",
      content: JSON.stringify({
        key: "notifications.newBuyOrder.content",
        params: { userName: "Mateo", totalPrice: "25.00" },
      }),
      type: "ORDER_STATUS",
      link: "/admin/panel/orders/purchase?id=order-1",
    });

    expect(result.ok).toBe(false);
    expect(result.skipped).toBe(true);
    expect(result.error).toContain("SENDGRID_FROM");
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("sends email with cleaned sender, multiple recipients and HTML + text via SendGrid", async () => {
    mockGetSecretValue.mockImplementation(async (key: string) => {
      if (key === "SENDGRID_API_KEY") return ' "SG.test-key" ';
      if (key === "SENDGRID_FROM") return ' "notificaciones@jabbustore.com" ';
      if (key === "SENDGRID_TO") return "admin1@jabbustore.com, admin2@jabbustore.com";
      return "";
    });
    mockSend.mockResolvedValue([
      {
        statusCode: 202,
        body: "",
        headers: { "x-message-id": "sg-msg-123" },
      },
      {},
    ]);

    const result = await SendGridService.sendNotificationEmail({
      title: "notifications.orderPaymentConfirmedAdmin.title",
      content: JSON.stringify({
        key: "notifications.orderPaymentConfirmedAdmin.content",
        params: {
          orderId: "abc12345",
          userName: "Luca",
          totalPrice: "42.50",
          provider: "Mercado Pago",
        },
      }),
      type: "ORDER_STATUS",
      link: "/admin/panel/orders/purchase?id=abc12345",
    });

    expect(result).toEqual({
      ok: true,
      id: "sg-msg-123",
      from: "JabbuStore <notificaciones@jabbustore.com>",
      to: ["admin1@jabbustore.com", "admin2@jabbustore.com"],
      statusCode: 202,
    });
    expect(mockSetApiKey).toHaveBeenCalledWith("SG.test-key");
    expect(mockSend).toHaveBeenCalledTimes(1);
    const [payload, isMultiple] = mockSend.mock.calls[0]!;
    expect(isMultiple).toBe(true);
    expect(payload.from).toEqual({
      email: "notificaciones@jabbustore.com",
      name: "JabbuStore",
    });
    expect(payload.to).toEqual(["admin1@jabbustore.com", "admin2@jabbustore.com"]);
    expect(payload.subject).toBe("JabbuStore - Orden Pagada - Lista para Trade");
    expect(payload.text).toContain("Mercado Pago");
    expect(payload.html).toContain("Abrir en JabbuStore");
  });

  it("retries transient 429 rate-limit errors and succeeds on retry", async () => {
    vi.useFakeTimers();
    mockGetSecretValue.mockImplementation(async (key: string) => {
      if (key === "SENDGRID_API_KEY") return "SG.test-key";
      if (key === "SENDGRID_FROM") return "notificaciones@jabbustore.com";
      if (key === "SENDGRID_TO") return "admin@jabbustore.com";
      return "";
    });
    mockSend
      .mockRejectedValueOnce({
        code: 429,
        message: "Too Many Requests",
        response: {
          statusCode: 429,
          headers: { "retry-after": "1" },
          body: { errors: [{ message: "Rate limit exceeded" }] },
        },
      })
      .mockResolvedValueOnce([
        {
          statusCode: 202,
          body: "",
          headers: { "x-message-id": "sg-msg-retry" },
        },
        {},
      ]);

    const promise = SendGridService.sendNotificationEmail({
      title: "Prueba",
      content: "Contenido",
      type: "SYSTEM",
      link: null,
    });

    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.ok).toBe(true);
    expect(result.id).toBe("sg-msg-retry");
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  it("fails fast without retrying on 403 unverified sender identity errors", async () => {
    mockGetSecretValue.mockImplementation(async (key: string) => {
      if (key === "SENDGRID_API_KEY") return "SG.test-key";
      if (key === "SENDGRID_FROM") return "no-verificado@example.com";
      if (key === "SENDGRID_TO") return "admin@example.com";
      return "";
    });
    mockSend.mockRejectedValue({
      code: 403,
      message: "Forbidden",
      response: {
        statusCode: 403,
        headers: {},
        body: {
          errors: [
            {
              message: "The from address does not match a verified Sender Identity.",
              field: "from",
            },
          ],
        },
      },
    });

    const result = await SendGridService.sendTestEmail();

    expect(result).toEqual({
      ok: false,
      from: "JabbuStore <no-verificado@example.com>",
      to: ["admin@example.com"],
      error: "The from address does not match a verified Sender Identity. (from)",
      statusCode: 403,
    });
    expect(mockSend).toHaveBeenCalledTimes(1);
  });
});
