import { describe, expect, it, vi } from "vitest";
import { StoreController } from "../StoreController";

function responseDouble() {
  return {
    statusCode: 200,
    body: null as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
  };
}

describe("StoreController.refreshPriceCatalog", () => {
  it("inicia sólo la descarga atómica del catálogo local", async () => {
    const execution = Promise.resolve({ itemCount: 42 });
    const catalogRefresh = {
      tryStart: vi.fn(() => ({ started: true, execution })),
      getStatus: vi.fn(async () => ({ running: true, itemCount: 10 })),
    };
    const repository = {
      findAll: vi.fn(),
      updatePricesMany: vi.fn(),
    };
    const controller = new StoreController(
      {} as any,
      repository as any,
      catalogRefresh as any,
    );
    const response = responseDouble();

    await controller.refreshPriceCatalog({} as any, response as any);
    await execution;

    expect(response.statusCode).toBe(202);
    expect(response.body).toMatchObject({
      started: true,
      statusUrl: "/api/store/prices/catalog/status",
      status: { running: true, itemCount: 10 },
      catalog: { running: true, itemCount: 10 },
    });
    expect(catalogRefresh.tryStart).toHaveBeenCalledWith({
      triggeredBy: "manual",
    });
    expect(repository.findAll).not.toHaveBeenCalled();
    expect(repository.updatePricesMany).not.toHaveBeenCalled();
  });

  it("devuelve 409 y status propio si el catálogo ya se está descargando", async () => {
    const current = { running: true, itemCount: 10 };
    const catalogRefresh = {
      tryStart: vi.fn(() => ({
        started: false,
        execution: new Promise(() => undefined),
      })),
      getStatus: vi.fn(async () => current),
    };
    const controller = new StoreController(
      {} as any,
      {} as any,
      catalogRefresh as any,
    );
    const response = responseDouble();

    await controller.refreshPriceCatalog({} as any, response as any);

    expect(response.statusCode).toBe(409);
    expect(response.body).toMatchObject({
      started: false,
      status: current,
      catalog: current,
    });
  });
});
