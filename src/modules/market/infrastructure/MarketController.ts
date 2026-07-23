import { Request, Response } from 'express';
import { GetMarketStoreAssetsUseCase } from '../application/GetMarketStoreAssetsUseCase';
import { GetResaleItemFloatsUseCase } from '../application/GetResaleItemFloatsUseCase';
import { RunFullCatalogSyncUseCase } from '../application/RunFullCatalogSyncUseCase';
import { GetMarketSyncStatusUseCase } from '../application/GetMarketSyncStatusUseCase';

export class MarketController {
  constructor(
    private getMarketStoreAssetsUseCase: GetMarketStoreAssetsUseCase,
    private runFullCatalogSyncUseCase: RunFullCatalogSyncUseCase,
    private getMarketSyncStatusUseCase: GetMarketSyncStatusUseCase,
    private getResaleItemFloatsUseCase: GetResaleItemFloatsUseCase,
  ) {}

  /** GET /market/listings — catálogo YouPin: un ítem por FloatItem (admin y tienda pública). */
  async getListings(_req: Request, res: Response): Promise<void> {
    try {
      const assets = await this.getMarketStoreAssetsUseCase.execute();
      res.json(
        assets.map((asset) => ({
          ...asset,
          float: asset.floatValue,
          pattern: asset.paintSeed,
        })),
      );
    } catch (error) {
      console.error('[Market Controller] Error obteniendo listings:', error);
      res.status(500).json({ error: 'Error al obtener el catálogo de mercado.' });
    }
  }

  /** POST /market/sync — recolecta y publica exclusivamente el snapshot de assets. */
  async triggerSync(_req: Request, res: Response): Promise<void> {
    try {
      const started = this.runFullCatalogSyncUseCase.tryStart('manual');
      if (!started.started) {
        const blockedByBots = started.blockingReason === 'bot_only';
        const message = blockedByBots
          ? 'Hay una sincronización de bots en curso.'
          : 'Ya hay una sincronización de assets en curso.';
        res.status(409).json({
          started: false,
          error: message,
          message,
          blockingJob: started.blockingReason,
          ...(blockedByBots
            ? {}
            : { status: await this.getMarketSyncStatusUseCase.execute() }),
        });
        return;
      }

      res.status(202).json({
        started: true,
        message: 'Recolección y publicación de assets iniciada en segundo plano.',
        statusUrl: '/api/market/sync/status',
      });

      void started.execution.then(
        (result) => {
          console.log(
            `[Market Assets Background] Snapshot ${result.snapshotHash.slice(0, 12)} publicado: ${result.validAssets} assets y ${result.listings} listings.`,
          );
        },
        (error) => {
          console.error('[Market Assets Background] Error:', error);
        },
      );

    } catch (error: any) {
      console.error('[Market Controller] Error al iniciar sincronización:', error);
      res.status(500).json({ error: error.message || 'Error al iniciar la sincronización.' });
    }
  }

  /** GET /market/sync/status — devuelve exclusivamente el estado del job de assets. */
  async getSyncStatus(_req: Request, res: Response): Promise<void> {
    try {
      const status = await this.getMarketSyncStatusUseCase.execute();
      res.json(status);
    } catch (error: any) {
      console.error('[Market Controller] Error obteniendo status de sync:', error);
      res.status(500).json({ error: error.message || 'Error al obtener el estado de sincronización.' });
    }
  }

  /** POST /market/sync/cancel — detiene de forma cooperativa la recolección activa. */
  async cancelSync(_req: Request, res: Response): Promise<void> {
    try {
      const cancellation = this.runFullCatalogSyncUseCase.tryCancel();
      if (!cancellation.accepted) {
        const message =
          cancellation.blockingReason === 'not_cancellable'
            ? 'La sincronización ya está validando o publicando y no puede cancelarse de forma segura.'
            : 'No hay una sincronización de assets activa para cancelar.';
        res.status(409).json({
          cancelRequested: false,
          error: message,
          message,
          blockingReason: cancellation.blockingReason,
          status: await this.getMarketSyncStatusUseCase.execute(),
        });
        return;
      }

      res.status(202).json({
        cancelRequested: true,
        alreadyRequested: cancellation.alreadyRequested,
        message: cancellation.alreadyRequested
          ? 'La cancelación ya estaba en curso.'
          : 'Cancelación solicitada; guardando el checkpoint.',
        statusUrl: '/api/market/sync/status',
      });

      void cancellation.completion.catch((error) => {
        console.error('[Market Assets Cancellation] Error:', error);
      });
    } catch (error: any) {
      console.error('[Market Controller] Error al cancelar sincronización:', error);
      res.status(500).json({
        error: error.message || 'Error al cancelar la sincronización.',
      });
    }
  }

  /** GET /market/listings/:id/floats — devuelve floats para un resale item con displayPrice */
  async getFloats(req: Request, res: Response): Promise<void> {
    try {
      const id = decodeURIComponent(req.params.id as string);
      if (!id) {
        res.status(400).json({ error: 'Falta el ID del artículo de reventa.' });
        return;
      }
      const floats = await this.getResaleItemFloatsUseCase.execute(id);
      res.json(floats);
    } catch (error: any) {
      console.error('[Market Controller] Error obteniendo floats:', error);
      res.status(500).json({ error: error.message || 'Error al obtener los floats del artículo.' });
    }
  }
}
