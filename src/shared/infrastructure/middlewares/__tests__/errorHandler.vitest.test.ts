import type { NextFunction, Request, Response } from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "../errorHandler";

function responseHarness() {
  const response = {
    status: vi.fn(),
    json: vi.fn(),
  };
  response.status.mockReturnValue(response);
  response.json.mockReturnValue(response);
  return response;
}

describe("errorHandler", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    process.env.NODE_ENV = "production";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env.NODE_ENV = originalNodeEnv;
  });

  it.each(["P2021", "P2022"])(
    "trata el drift de esquema Prisma %s como error interno",
    (code) => {
      const response = responseHarness();

      errorHandler(
        {
          name: "PrismaClientKnownRequestError",
          code,
          message: "missing production column",
        },
        {} as Request,
        response as unknown as Response,
        vi.fn() as NextFunction,
      );

      expect(response.status).toHaveBeenCalledWith(500);
      expect(response.json).toHaveBeenCalledWith({
        error: "Database schema mismatch",
        message: "A database error occurred",
      });
    },
  );

  it("conserva 400 para otros errores conocidos de operación Prisma", () => {
    const response = responseHarness();

    errorHandler(
      {
        name: "PrismaClientKnownRequestError",
        code: "P2000",
        message: "invalid value",
      },
      {} as Request,
      response as unknown as Response,
      vi.fn() as NextFunction,
    );

    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith({
      error: "Database operation failed",
      message: "A database error occurred",
    });
  });
});
