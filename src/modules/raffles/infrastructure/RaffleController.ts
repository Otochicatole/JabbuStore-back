import { Request, Response } from "express";
import {
  CreateRaffleUseCase,
  EditRaffleUseCase,
  CancelRaffleUseCase,
  DeleteRaffleUseCase,
  DrawRaffleUseCase,
  GetClientRafflesUseCase,
  GetAdminRafflesUseCase,
  GetRaffleDetailsUseCase,
} from "../application/RaffleUseCases";
import { prisma } from "../../../shared/infrastructure/PrismaClient";

interface RaffleSummary {
  id: string;
  name: string;
  description: string | null;
  status: string;
  drawDate: Date;
  ticketPrice: number;
  maxTickets: number | null;
  prizesCount: number;
  soldChances: number;
  pendingChances: number;
  revenue: number;
  ordersCount: number;
  prizes: { iconUrl: string | null; name: string }[];
}

export class RaffleController {
  constructor(
    private createRaffleUseCase: CreateRaffleUseCase,
    private editRaffleUseCase: EditRaffleUseCase,
    private cancelRaffleUseCase: CancelRaffleUseCase,
    private deleteRaffleUseCase: DeleteRaffleUseCase,
    private drawRaffleUseCase: DrawRaffleUseCase,
    private getClientRafflesUseCase: GetClientRafflesUseCase,
    private getAdminRafflesUseCase: GetAdminRafflesUseCase,
    private getRaffleDetailsUseCase: GetRaffleDetailsUseCase
  ) {}

  async createRaffle(req: Request, res: Response) {
    try {
      const { name, description, drawDate, ticketPrice, maxTickets, prizes } = req.body;
      const raffle = await this.createRaffleUseCase.execute(
        {
          name,
          description,
          drawDate: new Date(drawDate),
          ticketPrice: Number(ticketPrice),
          maxTickets: maxTickets ? Number(maxTickets) : null,
          status: "ACTIVE",
        },
        prizes
      );
      res.status(201).json(raffle);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }

  async updateRaffle(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const { name, description, drawDate, ticketPrice, maxTickets, status } = req.body;
      const updateData: any = {};
      if (name !== undefined) updateData.name = name;
      if (description !== undefined) updateData.description = description;
      if (drawDate !== undefined) updateData.drawDate = new Date(drawDate);
      if (ticketPrice !== undefined) updateData.ticketPrice = Number(ticketPrice);
      if (maxTickets !== undefined) updateData.maxTickets = maxTickets ? Number(maxTickets) : null;
      if (status !== undefined) updateData.status = status;

      const raffle = await this.editRaffleUseCase.execute(id as string, updateData);
      res.json(raffle);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }

  async cancelRaffle(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const raffle = await this.cancelRaffleUseCase.execute(id as string);
      res.json(raffle);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }

  async deleteRaffle(req: Request, res: Response) {
    try {
      const { id } = req.params;
      await this.deleteRaffleUseCase.execute(id as string);
      res.status(204).send();
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }

  async drawRaffle(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const raffle = await this.drawRaffleUseCase.execute(id as string);
      res.json(raffle);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }

  async getClientRaffles(req: Request, res: Response) {
    try {
      const raffles = await this.getClientRafflesUseCase.execute();
      res.json(raffles);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }

  async getAdminRaffles(req: Request, res: Response) {
    try {
      const raffles = await this.getAdminRafflesUseCase.execute();
      res.json(raffles);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }

  async getRaffleDetails(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const raffle = await this.getRaffleDetailsUseCase.execute(id as string);
      if (!raffle) {
        return res.status(404).json({ error: "Sorteo no encontrado." });
      }
      res.json(raffle);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }

  async getRaffleParticipants(req: Request, res: Response) {
    try {
      const { id } = req.params;
      
      const tickets = await prisma.raffleTicket.findMany({
        where: { raffleId: id as string },
        include: {
          user: {
            select: { name: true, steamId: true, avatar: true }
          },
          order: {
            select: { id: true, paymentMethod: true, metadata: true }
          }
        },
        orderBy: { ticketNumber: "asc" }
      });

      res.json(tickets);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }

  async getAdminRaffleSummaries(req: Request, res: Response) {
    try {
      const raffles = await prisma.raffle.findMany({
        include: {
          prizes: { select: { id: true, iconUrl: true, name: true } },
          tickets: { select: { id: true, status: true } },
        },
        orderBy: { createdAt: "desc" },
      });

      // Fetch all non-cancelled buy orders once for ordersCount aggregation
      const allBuyOrders = await prisma.order.findMany({
        where: { type: "BUY", status: { not: "CANCELLED" } },
        select: { id: true, metadata: true },
      });

      const summaries: RaffleSummary[] = raffles.map((raffle) => {
          const soldChances = raffle.tickets.filter((t) => t.status === "PAID").length;
          const pendingChances = raffle.tickets.filter((t) => t.status === "PENDING").length;

          const ordersCount = allBuyOrders.filter((o) => {
            const meta = o.metadata as Record<string, any> | null;
            return meta?.raffleId === raffle.id;
          }).length;

          return {
            id: raffle.id,
            name: raffle.name,
            description: raffle.description,
            status: raffle.status,
            drawDate: raffle.drawDate,
            ticketPrice: raffle.ticketPrice,
            maxTickets: raffle.maxTickets,
            prizesCount: raffle.prizes.length,
            soldChances,
            pendingChances,
            revenue: parseFloat((soldChances * raffle.ticketPrice).toFixed(2)),
            ordersCount,
            prizes: raffle.prizes.slice(0, 4).map((p) => ({ iconUrl: p.iconUrl, name: p.name })),
          };
        });

      res.json(summaries);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }

  async getAllRaffleOrders(req: Request, res: Response) {
    try {
      const allOrders = await prisma.order.findMany({
        include: {
          items: true,
          user: {
            select: {
              id: true,
              name: true,
              steamId: true,
              avatar: true,
              email: true,
              tradeUrl: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
      });

      const raffleOrders = allOrders.filter((order) => {
        const meta = order.metadata as Record<string, any> | null;
        return Boolean(meta?.raffleId);
      });

      const raffleIds = [
        ...new Set(
          raffleOrders
            .map((order) => (order.metadata as Record<string, any> | null)?.raffleId)
            .filter((id): id is string => typeof id === "string")
        ),
      ];

      const raffles = await prisma.raffle.findMany({
        where: { id: { in: raffleIds } },
        select: { id: true, name: true, status: true },
      });
      const raffleMap = new Map(raffles.map((raffle) => [raffle.id, raffle]));

      const enriched = await Promise.all(
        raffleOrders.map(async (order) => {
          const metadata = order.metadata as Record<string, any> | null;
          const raffleId = metadata?.raffleId as string;

          const tickets = await prisma.raffleTicket.findMany({
            where: { orderId: order.id, status: "PAID" },
            select: { ticketNumber: true, status: true },
            orderBy: { ticketNumber: "asc" },
          });

          const raffle = raffleMap.get(raffleId);

          return {
            ...order,
            raffleId,
            raffle: raffle ?? {
              id: raffleId,
              name: metadata?.raffleName ?? "Sorteo",
              status: "UNKNOWN",
            },
            ticketsCount: metadata?.ticketsCount ?? tickets.length,
            raffleTickets: tickets.map((ticket) => ticket.ticketNumber),
          };
        })
      );

      res.json({ orders: enriched });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }

  async getRaffleOrders(req: Request, res: Response) {
    try {
      const { id } = req.params;

      const raffle = await prisma.raffle.findUnique({
        where: { id: id as string },
        select: {
          id: true,
          name: true,
          description: true,
          status: true,
          drawDate: true,
          ticketPrice: true,
          maxTickets: true,
          tickets: { select: { status: true } },
        },
      });

      if (!raffle) {
        return res.status(404).json({ error: "Sorteo no encontrado." });
      }

      const allOrders = await prisma.order.findMany({
        include: {
          items: true,
          user: {
            select: {
              id: true,
              name: true,
              steamId: true,
              avatar: true,
              email: true,
              tradeUrl: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
      });

      const orders = allOrders.filter((o) => {
        const meta = o.metadata as Record<string, any> | null;
        return meta?.raffleId === id;
      });

      // For each order, resolve which ticket numbers were assigned
      const enriched = await Promise.all(
        orders.map(async (order) => {
          const tickets = await prisma.raffleTicket.findMany({
            where: { orderId: order.id, status: "PAID" },
            select: { ticketNumber: true, status: true },
            orderBy: { ticketNumber: "asc" },
          });

          const metadata = order.metadata as Record<string, any> | null;

          return {
            ...order,
            ticketsCount: metadata?.ticketsCount ?? tickets.length,
            raffleTickets: tickets.map((t) => t.ticketNumber),
          };
        })
      );

      const { tickets, ...raffleData } = raffle;

      res.json({
        raffle: {
          ...raffleData,
          soldChances: tickets.filter((t) => t.status === "PAID").length,
        },
        orders: enriched,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }

  async getRaffleOrderDetail(req: Request, res: Response) {
    try {
      const { id: raffleId, orderId } = req.params;

      const raffle = await prisma.raffle.findUnique({
        where: { id: raffleId as string },
        select: {
          id: true,
          name: true,
          status: true,
          drawDate: true,
          ticketPrice: true,
          maxTickets: true,
          _count: { select: { prizes: true } },
        },
      });

      if (!raffle) {
        return res.status(404).json({ error: "Sorteo no encontrado." });
      }

      const order = await prisma.order.findUnique({
        where: { id: orderId as string },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              steamId: true,
              avatar: true,
              email: true,
              tradeUrl: true,
            },
          },
        },
      });

      if (!order) {
        return res.status(404).json({ error: "Orden no encontrada." });
      }

      const metadata = order.metadata as Record<string, any> | null;
      if (order.type !== "BUY" || metadata?.raffleId !== raffleId) {
        return res.status(404).json({ error: "La orden no pertenece a este sorteo." });
      }

      const [assignedTicketsRows, chancesInRaffleTotal] = await Promise.all([
        prisma.raffleTicket.findMany({
          where: { orderId: order.id, status: "PAID" },
          select: { ticketNumber: true },
          orderBy: { ticketNumber: "asc" },
        }),
        prisma.raffleTicket.count({
          where: {
            raffleId: raffleId as string,
            userId: order.userId,
            status: "PAID",
          },
        }),
      ]);

      const ticketsCount = Number(metadata?.ticketsCount ?? assignedTicketsRows.length);
      const assignedTickets = assignedTicketsRows.map((t) => t.ticketNumber);

      res.json({
        raffle: {
          id: raffle.id,
          name: raffle.name,
          status: raffle.status,
          drawDate: raffle.drawDate,
          ticketPrice: raffle.ticketPrice,
          maxTickets: raffle.maxTickets,
          prizesCount: raffle._count.prizes,
        },
        order: {
          id: order.id,
          userId: order.userId,
          status: order.status,
          totalPrice: order.totalPrice,
          paymentMethod: order.paymentMethod,
          createdAt: order.createdAt,
          metadata: order.metadata,
          ticketsCount,
        },
        buyer: {
          id: order.user.id,
          name: order.user.name,
          steamId: order.user.steamId,
          avatar: order.user.avatar,
          email: order.user.email,
          tradeUrl: order.user.tradeUrl,
          chancesInThisOrder: ticketsCount,
          chancesInRaffleTotal,
        },
        assignedTickets,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
}
