import { Request, Response } from "express";
import fs from "fs";
import path from "path";
import { randomUUID } from "node:crypto";
import {
  CreateRaffleUseCase,
  EditRaffleUseCase,
  CancelRaffleUseCase,
  DeleteRaffleUseCase,
  DrawRaffleUseCase,
  GetUpcomingRafflesUseCase,
  GetClientRafflesUseCase,
  GetAdminRafflesUseCase,
  GetRaffleDetailsUseCase,
  SetRaffleVisibilityUseCase,
  AddFakeParticipantsUseCase,
} from "../application/RaffleUseCases";
import { prisma } from "../../../shared/infrastructure/PrismaClient";

const AVATAR_TYPES: Record<string, { extension: string; contentType: string }> = {
  jpeg: { extension: ".jpg", contentType: "image/jpeg" },
  png: { extension: ".png", contentType: "image/png" },
  webp: { extension: ".webp", contentType: "image/webp" },
};

function detectAvatarType(buffer: Buffer): keyof typeof AVATAR_TYPES | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "jpeg";
  }
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return "png";
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "webp";
  }
  return null;
}

async function saveAvatarUpload(file: Express.Multer.File): Promise<string> {
  if (!file.buffer || file.buffer.length === 0) {
    throw new Error("El avatar está vacío.");
  }

  const detected = detectAvatarType(file.buffer);
  if (!detected) {
    throw new Error("Formato de avatar no permitido. Usá JPG, PNG o WEBP.");
  }
  const avatarType = AVATAR_TYPES[detected]!;

  if (file.mimetype && file.mimetype !== avatarType.contentType) {
    throw new Error("El tipo del avatar no coincide con su contenido real.");
  }

  const dir = path.join(process.cwd(), "storage", "avatars");
  await fs.promises.mkdir(dir, { recursive: true });
  const fileName = `bot_${Date.now()}_${randomUUID()}${avatarType.extension}`;
  await fs.promises.writeFile(path.join(dir, fileName), file.buffer, { flag: "wx" });
  return fileName;
}

/**
 * Resolves an avatar URL to a base64 data URL.
 * - For local bot avatars stored on disk (/api/proxy/raffles/avatars/...), reads the file directly.
 * - For external URLs (Steam, etc.), fetches via HTTP.
 * - Returns null if resolution fails.
 */
async function resolveAvatarToBase64(avatarUrl: string | null | undefined): Promise<string | null> {
  if (!avatarUrl || avatarUrl.startsWith("data:")) return avatarUrl || null;

  // Local bot avatar stored on disk
  if (avatarUrl.startsWith("/api/proxy/raffles/avatars/")) {
    const filename = avatarUrl.split("/").pop();
    if (!filename) return null;
    const filePath = path.join(process.cwd(), "storage", "avatars", filename);
    try {
      const buffer = fs.readFileSync(filePath);
      const ext = path.extname(filename).toLowerCase();
      const mimeMap: Record<string, string> = {
        ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
        ".png": "image/png", ".gif": "image/gif",
        ".webp": "image/webp",
      };
      const contentType = mimeMap[ext] || "image/jpeg";
      return `data:${contentType};base64,${buffer.toString("base64")}`;
    } catch (e) {
      return null;
    }
  }

  // External URL (Steam, etc.)
  try {
    const response = await fetch(avatarUrl);
    if (response.ok) {
      const buffer = await response.arrayBuffer();
      const contentType = response.headers.get("content-type") || "image/jpeg";
      return `data:${contentType};base64,${Buffer.from(buffer).toString("base64")}`;
    }
  } catch (e) {
    // Silent fail for external URLs
  }
  return null;
}
import { PrismaRaffleRepository } from "./PrismaRaffleRepository";

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
    private getUpcomingRafflesUseCase: GetUpcomingRafflesUseCase,
    private getClientRafflesUseCase: GetClientRafflesUseCase,
    private getAdminRafflesUseCase: GetAdminRafflesUseCase,
    private getRaffleDetailsUseCase: GetRaffleDetailsUseCase,
    private setRaffleVisibilityUseCase: SetRaffleVisibilityUseCase
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
      const sanitized = raffles.map((r: any) => ({
        ...r,
        prizes: r.prizes.map((p: any) => {
          const { winner, ...rest } = p;
          return rest;
        })
      }));
      res.json(sanitized);
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

  async getUpcomingRaffles(req: Request, res: Response) {
    try {
      const minutes = req.query.minutes ? parseInt(req.query.minutes as string) : 30;
      const raffles = await this.getUpcomingRafflesUseCase.execute(minutes);
      // Omitir info sensible si queremos, pero getUpcoming debe devolver lo necesario para el nav.
      const sanitized = raffles.map((r: any) => ({
        id: r.id,
        name: r.name,
        drawDate: r.drawDate,
        status: r.status
      }));
      res.json(sanitized);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }

  async getRaffleDetails(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const raffle = await this.getRaffleDetailsUseCase.execute(id as string);
      if (!raffle || raffle.isPublic === false) {
        return res.status(404).json({ error: "Sorteo no encontrado." });
      }

      const uniqueUsers = new Map<string, any>();
      (raffle.tickets || []).forEach((t: any) => {
        if (t.user && t.user.id && !uniqueUsers.has(t.user.id)) {
          uniqueUsers.set(t.user.id, { ...t.user });
        }
      });

      await Promise.all(
        Array.from(uniqueUsers.values()).map(async (user: any) => {
          delete user.steamId;
          delete user.tradeUrl;
          user.avatar = await resolveAvatarToBase64(user.avatar);
        })
      );

      const sanitizedRaffle = {
        ...raffle,
        prizes: (raffle.prizes || []).map((p: any) => {
          const { winner, ...rest } = p;
          return rest;
        }),
        tickets: (raffle.tickets || []).map((t: any) => {
          if (t.user) {
            return {
              ...t,
              user: uniqueUsers.get(t.user.id)
            };
          }
          return t;
        })
      };

      res.json(sanitizedRaffle);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }

  async getRaffleWinners(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const raffle = await this.getRaffleDetailsUseCase.execute(id as string);
      
      if (!raffle || raffle.isPublic === false) {
        return res.status(404).json({ error: "Sorteo no encontrado." });
      }

      if (raffle.status !== "FINISHED") {
        return res.json([]);
      }

      const winners = await Promise.all(
        (raffle.prizes || [])
          .filter((p: any) => p.winnerId && p.winner)
          .map(async (p: any) => {
            const originalName = p.winner.name || "Usuario Steam";

            const avatarDataUrl = await resolveAvatarToBase64(p.winner.avatar);

            return {
              prizeId: p.id,
              position: p.position,
              winner: {
                id: p.winner.id,
                name: originalName,
                avatar: avatarDataUrl
              },
              winningTicket: p.winningTicket
            };
          })
      );

      res.json(winners);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }

  async setRaffleVisibility(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const { isPublic } = req.body;

      if (typeof isPublic !== "boolean") {
        return res.status(400).json({ error: "El campo isPublic es obligatorio." });
      }

      const raffle = await this.setRaffleVisibilityUseCase.execute(id as string, isPublic);
      res.json(raffle);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
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
              isFake: true,
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

  async getAdminBots(req: Request, res: Response) {
    try {
      const bots = await prisma.user.findMany({
        where: { isFake: true },
        select: {
          id: true,
          name: true,
          avatar: true,
          steamId: true,
        },
        orderBy: { createdAt: "desc" }
      });
      res.json(bots);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }

  async addFakeParticipants(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const { mode, name, botId, tickets } = req.body;
      let avatar = req.body.avatar;

      if (req.file) {
        const fileName = await saveAvatarUpload(req.file);
        // Usamos la ruta del proxy del frontend para evitar bloqueos CORS o de devtunnels
        avatar = `/api/proxy/raffles/avatars/${fileName}`;
      }
      
      const useCase = new AddFakeParticipantsUseCase(
        new PrismaRaffleRepository()
      );
      
      await useCase.execute(id as string, mode, Number(tickets), { name, avatar, botId });
      
      res.status(200).json({ success: true });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }
}
