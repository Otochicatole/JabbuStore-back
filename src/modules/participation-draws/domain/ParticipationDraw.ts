export interface EligibleUser {
  id: string;
  name: string | null;
  avatar: string | null;
  raffleCount: number;
  isBot?: boolean;
  chances?: number;
}

export interface ParticipationDrawWinner {
  id: string;
  name: string | null;
  avatar: string | null;
  steamId?: string | null;
  tradeUrl?: string | null;
  isFake?: boolean;
}

export interface ParticipationDrawPrize {
  id: string;
  drawId: string;
  position: number;
  assetId: string;
  name: string;
  price: number;
  iconUrl: string | null;
  rarity: string | null;
  exterior: string | null;
  float: number | null;
  pattern: number | null;
  provider: string;
  winnerId: string | null;
  winner?: ParticipationDrawWinner | null;
}

export interface ParticipationDrawEntry {
  id: string;
  drawId: string;
  userId: string;
  raffleCount: number;
  isWinner: boolean;
  createdAt: Date;
  user?: ParticipationDrawWinner | null;
}

export interface ParticipationDraw {
  id: string;
  name: string;
  description: string | null;
  minRaffles: number;
  drawDate: Date;
  status: string;
  isPublic: boolean;
  createdAt: Date;
  updatedAt: Date;
  prizes?: ParticipationDrawPrize[];
  entries?: ParticipationDrawEntry[];
  eligibleCount?: number;
  eligibleUsers?: EligibleUser[];
}

export interface ResolvedPrizeData {
  assetId: string;
  position: number;
  name: string;
  price: number;
  iconUrl: string | null;
  rarity: string | null;
  exterior: string | null;
  float: number | null;
  pattern: number | null;
  provider: string;
}

export interface CreateParticipationDrawInput {
  name: string;
  description?: string | null;
  minRaffles: number;
  drawDate: Date;
  isPublic?: boolean;
  prizes: ResolvedPrizeData[];
}

export interface UpdateParticipationDrawInput {
  name?: string;
  description?: string | null;
  minRaffles?: number;
  drawDate?: Date;
  isPublic?: boolean;
  prizes?: ResolvedPrizeData[];
}

export interface UserEligibility {
  raffleCount: number;
  eligible: boolean;
  minRaffles: number;
}

export interface PrizeWinnerAssignment {
  prizeId: string;
  winnerId: string;
}

export interface IParticipationDrawRepository {
  findPublic(): Promise<ParticipationDraw[]>;
  findAll(): Promise<ParticipationDraw[]>;
  findById(id: string): Promise<ParticipationDraw | null>;
  findDrawsReadyToDraw(): Promise<ParticipationDraw[]>;
  create(input: CreateParticipationDrawInput): Promise<ParticipationDraw>;
  update(id: string, input: UpdateParticipationDrawInput): Promise<ParticipationDraw>;
  cancel(id: string): Promise<ParticipationDraw>;
  delete(id: string): Promise<ParticipationDraw | null>;
  findEligibleUsers(minRaffles: number): Promise<EligibleUser[]>;
  findEligibleUsersForDraw(drawId: string, minRaffles: number): Promise<EligibleUser[]>;
  getUserRaffleCount(userId: string): Promise<number>;
  addBotEntry(drawId: string, userId: string, chances: number): Promise<void>;
  finishDraw(
    id: string,
    prizeWinners: PrizeWinnerAssignment[],
    entries: { userId: string; raffleCount: number; isWinner: boolean }[],
  ): Promise<ParticipationDraw>;
  finishWithoutWinners(id: string): Promise<ParticipationDraw>;
}
