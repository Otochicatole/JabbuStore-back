export type RaffleStatus = "PENDING" | "ACTIVE" | "FINISHED" | "CANCELLED";

export interface Raffle {
  id: string;
  name: string;
  description: string | null;
  drawDate: Date;
  ticketPrice: number;
  maxTickets: number | null;
  status: string; // PENDING, ACTIVE, FINISHED, CANCELLED
  isPublic: boolean;
  createdAt: Date;
  updatedAt: Date;
  prizes?: RafflePrize[];
  tickets?: RaffleTicket[];
}

export interface RafflePrize {
  id: string;
  raffleId: string;
  position: number;
  assetId: string;
  name: string;
  price: number;
  iconUrl: string | null;
  rarity: string | null;
  exterior: string | null;
  float: number | null;
  pattern: number | null;
  provider: string; // 'bot' | 'youpin'
  winnerId: string | null;
  winningTicketId: string | null;
  winner?: {
    id: string;
    name: string | null;
    steamId: string | null;
    avatar: string | null;
    tradeUrl: string | null;
  } | null;
  winningTicket?: {
    ticketNumber: number;
  } | null;
}

export interface RaffleTicket {
  id: string;
  raffleId: string;
  userId: string;
  ticketNumber: number;
  orderId: string | null;
  status: string; // PENDING, PAID, CANCELLED
  purchaseDate: Date;
}

export interface IRaffleRepository {
  create(
    data: {
      name: string;
      description?: string | null;
      drawDate: Date;
      ticketPrice: number;
      maxTickets?: number | null;
      status?: string;
    },
    prizes: {
      assetId: string;
      position: number;
      name: string;
      price: number;
      iconUrl?: string | null;
      rarity?: string | null;
      exterior?: string | null;
      float?: number | null;
      pattern?: number | null;
      provider: string;
    }[]
  ): Promise<Raffle>;

  findById(id: string): Promise<Raffle | null>;
  findAll(): Promise<Raffle[]>;
  findActiveAndFinished(): Promise<Raffle[]>;
  update(id: string, data: {
    name?: string;
    description?: string | null;
    drawDate?: Date;
    ticketPrice?: number;
    maxTickets?: number | null;
    status?: string;
    isPublic?: boolean;
  }): Promise<Raffle>;
  
  cancelRaffle(id: string): Promise<Raffle>;
  deleteRaffle(id: string): Promise<void>;
  findTicketsByRaffleId(raffleId: string): Promise<RaffleTicket[]>;
  findTicketsByUserId(userId: string): Promise<RaffleTicket[]>;
  
  // Creates ticket purchases, returning the allocated tickets
  createTickets(
    tickets: {
      raffleId: string;
      userId: string;
      ticketNumber: number;
      orderId?: string | null;
      status?: string;
    }[]
  ): Promise<RaffleTicket[]>;

  // Sets winning statuses and updates raffle to finished
  drawWinners(
    raffleId: string,
    winners: {
      prizeId: string;
      winnerId: string;
      winningTicketId: string;
    }[]
  ): Promise<Raffle>;
}
