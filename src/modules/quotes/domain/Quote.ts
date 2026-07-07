import { QuoteStatus } from "@prisma/client";

export interface QuoteItem {
  id: string;
  quoteId: string;
  assetId: string;
  name: string;
  price: number | null;
  iconUrl: string | null;
  rarity: string | null;
  exterior: string | null;
  float: number | null;
  pattern: number | null;
  paintIndex: number | null;
}

export interface Quote {
  id: string;
  userId: string;
  status: QuoteStatus;
  items?: QuoteItem[];
  createdAt: Date;
  updatedAt: Date;
}
