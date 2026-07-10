export interface SponsorImageMetadata {
  storageKey: string;
  mimeType: string;
  size: number;
  originalName: string;
}

export interface Sponsor {
  id: string;
  name: string;
  imageStorageKey: string;
  imageMimeType: string;
  imageSize: number;
  imageOriginalName: string;
  displayOrder: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateSponsorInput {
  name: string;
  image: SponsorImageMetadata;
}

export interface UpdateSponsorInput {
  name?: string;
  isActive?: boolean;
  image?: SponsorImageMetadata;
}

export interface ISponsorRepository {
  findPublic(): Promise<Sponsor[]>;
  findAll(): Promise<Sponsor[]>;
  findById(id: string): Promise<Sponsor | null>;
  create(input: CreateSponsorInput): Promise<Sponsor>;
  update(id: string, input: UpdateSponsorInput): Promise<Sponsor>;
  delete(id: string): Promise<Sponsor | null>;
  reorder(ids: string[]): Promise<Sponsor[]>;
}
