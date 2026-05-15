import { Request, Response } from 'express';
import { ListingService } from '../application/ListingService';
import { PurchaseService } from '../application/PurchaseService';

export class MarketplaceController {
  // Listings
  static async createListing(req: Request, res: Response) {
    try {
      // Usamos el id del usuario de la sesión (asumiendo que passport inyecta req.user)
      const user = req.user as any;
      if (!user) return res.status(401).json({ error: 'No autorizado' });

      const { skinId, requestedPrice } = req.body;
      const listing = await ListingService.createListing(user.id, skinId, parseFloat(requestedPrice));
      res.status(201).json(listing);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }

  static async getActiveListings(req: Request, res: Response) {
    try {
      const listings = await ListingService.getActiveListings();
      res.json(listings);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }

  static async cancelListing(req: Request, res: Response) {
    try {
      const user = req.user as any;
      if (!user) return res.status(401).json({ error: 'No autorizado' });

      const { id } = req.params;
      const listing = await ListingService.cancelListing(id as string, user.id);
      res.json(listing);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }

  // Purchases
  static async purchaseItem(req: Request, res: Response) {
    try {
      const user = req.user as any;
      if (!user) return res.status(401).json({ error: 'No autorizado' });

      const { listingId } = req.body;
      const purchase = await PurchaseService.reserveAndPurchase(user.id, listingId);
      res.status(201).json(purchase);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }

  static async confirmPayment(req: Request, res: Response) {
    try {
      const { id } = req.params;
      // Esto normalmente lo llama un webhook de la pasarela de pago
      // Para efectos de demostración o integración, lo dejamos como endpoint
      const purchase = await PurchaseService.confirmPayment(id as string);
      res.json(purchase);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }

  static async getUserPurchases(req: Request, res: Response) {
    try {
      const user = req.user as any;
      if (!user) return res.status(401).json({ error: 'No autorizado' });

      const purchases = await PurchaseService.getUserPurchases(user.id);
      res.json(purchases);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
}
