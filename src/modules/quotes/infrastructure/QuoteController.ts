import { Request, Response } from 'express';
import {
  CreateQuoteUseCase,
  GetUserQuotesUseCase,
  GetQuoteByIdUseCase,
  CancelQuoteUseCase,
  AdminGetQuotesUseCase,
  AdminQuoteItemsUseCase
} from '../application/QuoteUseCases';

export class QuoteController {
  constructor(
    private createQuoteUseCase: CreateQuoteUseCase,
    private getUserQuotesUseCase: GetUserQuotesUseCase,
    private getQuoteByIdUseCase: GetQuoteByIdUseCase,
    private cancelQuoteUseCase: CancelQuoteUseCase,
    private adminGetQuotesUseCase: AdminGetQuotesUseCase,
    private adminQuoteItemsUseCase: AdminQuoteItemsUseCase
  ) {}

  private extractId(req: Request): string | null {
    const id = req.params.id;
    if (!id) return null;
    return (Array.isArray(id) ? id[0] : id) as string;
  }

  async create(req: Request, res: Response) {
    try {
      const userId = (req as any).user?.id;
      const { assetIds } = req.body;
      if (!userId) {
        return res.status(401).json({ error: 'UNAUTHORIZED' });
      }
      const quote = await this.createQuoteUseCase.execute(userId, assetIds);
      return res.status(201).json(quote);
    } catch (error: any) {
      console.error('[QuoteController] Error in create:', error);
      return res.status(400).json({ error: error.message });
    }
  }

  async getMyQuotes(req: Request, res: Response) {
    try {
      const userId = (req as any).user?.id;
      if (!userId) {
        return res.status(401).json({ error: 'UNAUTHORIZED' });
      }
      const quotes = await this.getUserQuotesUseCase.execute(userId);
      return res.json(quotes);
    } catch (error: any) {
      console.error('[QuoteController] Error in getMyQuotes:', error);
      return res.status(500).json({ error: error.message });
    }
  }

  async getById(req: Request, res: Response) {
    try {
      const userId = (req as any).user?.id;
      const id = this.extractId(req);
      if (!userId) {
        return res.status(401).json({ error: 'UNAUTHORIZED' });
      }
      if (!id) {
        return res.status(400).json({ error: 'INVALID_ID' });
      }
      const quote = await this.getQuoteByIdUseCase.execute(id, userId);
      return res.json(quote);
    } catch (error: any) {
      console.error('[QuoteController] Error in getById:', error);
      return res.status(404).json({ error: error.message });
    }
  }

  async cancel(req: Request, res: Response) {
    try {
      const userId = (req as any).user?.id;
      const id = this.extractId(req);
      if (!userId) {
        return res.status(401).json({ error: 'UNAUTHORIZED' });
      }
      if (!id) {
        return res.status(400).json({ error: 'INVALID_ID' });
      }
      const quote = await this.cancelQuoteUseCase.execute(id, userId);
      return res.json(quote);
    } catch (error: any) {
      console.error('[QuoteController] Error in cancel:', error);
      return res.status(400).json({ error: error.message });
    }
  }

  async adminGetAll(req: Request, res: Response) {
    try {
      const quotes = await this.adminGetQuotesUseCase.execute();
      return res.json(quotes);
    } catch (error: any) {
      console.error('[QuoteController] Error in adminGetAll:', error);
      return res.status(500).json({ error: error.message });
    }
  }

  async adminQuoteItems(req: Request, res: Response) {
    try {
      const id = this.extractId(req);
      const { prices } = req.body;
      if (!id) {
        return res.status(400).json({ error: 'INVALID_ID' });
      }
      if (!Array.isArray(prices)) {
        return res.status(400).json({ error: 'Los precios deben ser un array de { assetId, price }.' });
      }
      const quote = await this.adminQuoteItemsUseCase.execute(id, prices);
      return res.json(quote);
    } catch (error: any) {
      console.error('[QuoteController] Error in adminQuoteItems:', error);
      return res.status(400).json({ error: error.message });
    }
  }

  async adminCancel(req: Request, res: Response) {
    try {
      const id = this.extractId(req);
      if (!id) {
        return res.status(400).json({ error: 'INVALID_ID' });
      }
      const quote = await this.cancelQuoteUseCase.execute(id);
      return res.json(quote);
    } catch (error: any) {
      console.error('[QuoteController] Error in adminCancel:', error);
      return res.status(400).json({ error: error.message });
    }
  }
}
