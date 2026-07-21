import { describe, expect, it, vi } from "vitest";
import { ItemsCatalogRefreshService } from "../ItemsCatalogRefreshService";

const persistedStatus = {
  exists: true,
  stale: false,
  fetchedAt: new Date(0).toISOString(),
  itemCount: 10,
  pageCount: 1,
  currency: "USD",
  market: "youpin",
  path: "items-catalog.json",
};

describe("ItemsCatalogRefreshService", () => {
  it("no reemplaza el catálogo anterior cuando la descarga es parcial", async () => {
    const client = {
      fetchCatalog: vi.fn(async () => ({
        ok: false,
        status: 500,
        errors: ["Página 2: HTTP 500"],
        snapshot: {
          fetchedAt: new Date().toISOString(),
          currency: "USD",
          market: "youpin",
          sourceUrl: "https://example.test/items",
          pageCount: 1,
          itemCount: 1,
          errors: ["Página 2: HTTP 500"],
          items: [{}],
        },
      })),
    };
    const store = {
      getStatus: vi.fn(async () => persistedStatus),
      writeCatalog: vi.fn(async () => undefined),
    };
    const service = new ItemsCatalogRefreshService(client as any, store as any);

    await expect(
      service.refreshNow({ triggeredBy: "test" }),
    ).rejects.toThrow("Página 2");
    expect(store.writeCatalog).not.toHaveBeenCalled();
  });

  it("une callers concurrentes al mismo refresh", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const snapshot = {
      fetchedAt: new Date().toISOString(),
      currency: "USD",
      market: "youpin",
      sourceUrl: "https://example.test/items",
      pageCount: 1,
      itemCount: 1,
      errors: [],
      items: [{}],
    };
    const client = {
      fetchCatalog: vi.fn(async () => {
        await gate;
        return { ok: true, status: 200, errors: [], snapshot };
      }),
    };
    const store = {
      getStatus: vi.fn(async () => persistedStatus),
      writeCatalog: vi.fn(async () => undefined),
    };
    const service = new ItemsCatalogRefreshService(client as any, store as any);

    const first = service.tryStart({ triggeredBy: "manual" });
    const second = service.tryStart({ triggeredBy: "scheduler" });
    expect(first.started).toBe(true);
    expect(second.started).toBe(false);
    expect(second.execution).toBe(first.execution);
    await expect(service.getStatus()).resolves.toMatchObject({ running: true });
    release();
    const [completed] = await Promise.all([
      first.execution,
      second.execution,
    ]);

    expect(completed).toMatchObject({ running: false });
    await expect(service.getStatus()).resolves.toMatchObject({ running: false });

    expect(client.fetchCatalog).toHaveBeenCalledOnce();
    expect(store.writeCatalog).toHaveBeenCalledOnce();
  });
});
