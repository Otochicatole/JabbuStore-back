import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockSend, mockGetSecretValue } = vi.hoisted(() => ({
  mockSend: vi.fn(),
  mockGetSecretValue: vi.fn(),
}));

vi.mock("resend", () => ({
  Resend: class MockResend {
    emails = {
      send: mockSend,
    };
    constructor(public token: string) {}
  },
}));

vi.mock("../../../modules/marketplace/application/AdminSecureConfigService", () => ({
  AdminSecureConfigService: {
    getSecretValue: mockGetSecretValue,
  },
}));

import { config } from "../../config";
import {
  ResendService,
  buildNotificationUrl,
  parseRecipients,
  resolveFromEmail,
} from "../ResendService";

describe("ResendService helpers", () => {
  const originalFrontendUrl = config.frontendUrl;

  afterEach(() => {
    config.frontendUrl = originalFrontendUrl;
  });

  it("parses multiple comma/semicolon-separated recipients and deduplicates", () => {
    expect(
      parseRecipients(
        ' "Admin One <admin@jabbustore.com>", ops@jabbustore.com; ADMIN@jabbustore.com, invalid-email ',
      ),
    ).toEqual(["admin@jabbustore.com", "ops@jabbustore.com"]);
  });

  it("normalizes from addresses and rejects invalid ones", () => {
    expect(resolveFromEmail('"notificaciones@jabbustore.com"')).toBe(
      "JabbuStore <notificaciones@jabbustore.com>",
    );
    expect(resolveFromEmail("Soporte <soporte@jabbustore.com>")).toBe(
      "JabbuStore <soporte@jabbustore.com>",
    );
    expect(resolveFromEmail("sin-arroba")).toBeNull();
  });

  it("uses the first origin when FRONTEND_URL contains multiple origins", () => {
    config.frontendUrl = "https://jabbustore.com/, https://www.jabbustore.com";
    expect(buildNotificationUrl("/admin/panel/tickets?ticket=123")).toBe(
      "https://jabbustore.com/es/admin/panel/tickets?ticket=123",
    );
    expect(buildNotificationUrl("/en/admin/panel/quotes")).toBe(
      "https://jabbustore.com/en/admin/panel/quotes",
    );
  });
});

describe("ResendService.sendNotificationEmail", () => {
  const originalFrontendUrl = config.frontendUrl;

  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    config.frontendUrl = "https://jabbustore.com";
  });

  afterEach(() => {
    config.frontendUrl = originalFrontendUrl;
    vi.restoreAllMocks();
  });

  it("skips cleanly when RESEND_FROM or RESEND_TO are missing", async () => {
    mockGetSecretValue.mockImplementation(async (key: string) => {
      if (key === "RESEND_TOKEN") return "re_test_1234";
      return "";
    });

    const result = await ResendService.sendNotificationEmail({
      title: "notifications.newQuote.title",
      content: JSON.stringify({
        key: "notifications.newQuote.content",
        params: { userName: "Ana", itemCount: 3 },
      }),
      type: "ORDER_STATUS",
      link: "/admin/panel/quotes",
    });

    expect(result.ok).toBe(false);
    expect(result.skipped).toBe(true);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("sends interpolated text and escaped html to multiple recipients", async () => {
    mockGetSecretValue.mockImplementation(async (key: string) => {
      if (key === "RESEND_TOKEN") return ' "re_test_1234" ';
      if (key === "RESEND_FROM") return ' "notificaciones@jabbustore.com" ';
      if (key === "RESEND_TO") return "admin1@jabbustore.com, admin2@jabbustore.com";
      return "";
    });
    mockSend.mockResolvedValue({ data: { id: "email_1" }, error: null });

    const result = await ResendService.sendNotificationEmail({
      title: "notifications.newTicket.title",
      content: JSON.stringify({
        key: "notifications.newTicket.content",
        params: {
          userName: '<script>alert("xss")</script>',
          subject: "Ayuda con orden",
        },
      }),
      type: "TICKET_MESSAGE",
      link: "/admin/panel/tickets?ticket=t-99",
    });

    expect(result).toEqual({
      ok: true,
      id: "email_1",
      from: "JabbuStore <notificaciones@jabbustore.com>",
      to: ["admin1@jabbustore.com", "admin2@jabbustore.com"],
    });
    expect(mockSend).toHaveBeenCalledTimes(1);
    const payload = mockSend.mock.calls[0]?.[0];
    expect(payload.from).toBe("JabbuStore <notificaciones@jabbustore.com>");
    expect(payload.to).toEqual(["admin1@jabbustore.com", "admin2@jabbustore.com"]);
    expect(payload.subject).toBe("JabbuStore - Nuevo ticket de soporte");
    expect(payload.text).toContain("https://jabbustore.com/es/admin/panel/tickets?ticket=t-99");
    expect(payload.html).not.toContain("<script>");
    expect(payload.html).toContain("&lt;script&gt;");
  });

  it("retries once on 429 rate_limit_exceeded and succeeds", async () => {
    vi.useFakeTimers();
    try {
      mockGetSecretValue.mockImplementation(async (key: string) => {
        if (key === "RESEND_TOKEN") return "re_test_1234";
        if (key === "RESEND_FROM") return "notificaciones@jabbustore.com";
        if (key === "RESEND_TO") return "admin@jabbustore.com";
        return "";
      });
      mockSend
        .mockResolvedValueOnce({
          data: null,
          error: {
            name: "rate_limit_exceeded",
            message: "Too many requests",
            statusCode: 429,
          },
        })
        .mockResolvedValueOnce({
          data: { id: "email_retry_ok" },
          error: null,
        });

      const promise = ResendService.sendNotificationEmail({
        title: "notifications.orderPaymentConfirmedAdmin.title",
        content: JSON.stringify({
          key: "notifications.orderPaymentConfirmedAdmin.content",
          params: {
            orderId: "abcd1234",
            userName: "Lucas",
            totalPrice: "50",
            provider: "Mercado Pago",
          },
        }),
        type: "ORDER_STATUS",
        link: "/admin/panel/orders/purchase?id=abcd1234",
      });

      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.ok).toBe(true);
      expect(result.id).toBe("email_retry_ok");
      expect(mockSend).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails fast without retrying on 403 validation/domain errors", async () => {
    mockGetSecretValue.mockImplementation(async (key: string) => {
      if (key === "RESEND_TOKEN") return "re_test_1234";
      if (key === "RESEND_FROM") return "onboarding@resend.dev";
      if (key === "RESEND_TO") return "otro@example.com";
      return "";
    });
    mockSend.mockResolvedValue({
      data: null,
      error: {
        name: "validation_error",
        message: "You can only send testing emails to your own email address",
        statusCode: 403,
      },
    });

    const result = await ResendService.sendTestEmail();

    expect(result.ok).toBe(false);
    expect(result.statusCode).toBe(403);
    expect(result.error).toContain("testing emails");
    expect(mockSend).toHaveBeenCalledTimes(1);
  });
});
