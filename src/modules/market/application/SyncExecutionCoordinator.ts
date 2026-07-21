export type SyncExecutionKind =
  | "market_assets"
  | "bot_only";

export interface SyncExecutionLease {
  readonly kind: SyncExecutionKind;
  release(): void;
}

/**
 * Coordinador de jobs que no pasan por un servicio single-flight propio.
 * Assets y bots se excluyen mutuamente para que ninguna mutación de tienda se
 * solape con la publicación transaccional del mercado. El catálogo local tiene
 * su single-flight en ItemsCatalogRefreshService y permanece independiente.
 */
export class SyncExecutionCoordinator {
  private readonly active = new Set<SyncExecutionKind>();

  private conflicts(kind: SyncExecutionKind): SyncExecutionKind[] {
    return ["market_assets", "bot_only"];
  }

  tryAcquire(kind: SyncExecutionKind): SyncExecutionLease | null {
    if (this.getBlockingKind(kind)) return null;
    this.active.add(kind);
    let released = false;
    return {
      kind,
      release: () => {
        if (released) return;
        released = true;
        this.active.delete(kind);
      },
    };
  }

  getActiveKind(): SyncExecutionKind | null {
    return this.active.values().next().value ?? null;
  }

  getActiveKinds(): SyncExecutionKind[] {
    return [...this.active];
  }

  getBlockingKind(kind: SyncExecutionKind): SyncExecutionKind | null {
    return this.conflicts(kind).find((candidate) => this.active.has(candidate)) ?? null;
  }
}

export const syncExecutionCoordinator = new SyncExecutionCoordinator();
