import { prisma } from "../../../shared/infrastructure/PrismaClient";
import type {
  CreateSponsorInput,
  ISponsorRepository,
  Sponsor,
  UpdateSponsorInput,
} from "../domain/Sponsor";

const sponsorOrder = [{ displayOrder: "asc" as const }, { createdAt: "asc" as const }];

export class PrismaSponsorRepository implements ISponsorRepository {
  async findPublic(): Promise<Sponsor[]> {
    return prisma.sponsor.findMany({
      where: { isActive: true },
      orderBy: sponsorOrder,
    });
  }

  async findAll(): Promise<Sponsor[]> {
    return prisma.sponsor.findMany({
      orderBy: sponsorOrder,
    });
  }

  async findById(id: string): Promise<Sponsor | null> {
    return prisma.sponsor.findUnique({ where: { id } });
  }

  async create(input: CreateSponsorInput): Promise<Sponsor> {
    const maxOrder = await prisma.sponsor.aggregate({
      _max: { displayOrder: true },
    });

    return prisma.sponsor.create({
      data: {
        name: input.name,
        imageStorageKey: input.image.storageKey,
        imageMimeType: input.image.mimeType,
        imageSize: input.image.size,
        imageOriginalName: input.image.originalName,
        displayOrder: (maxOrder._max.displayOrder ?? -1) + 1,
        isActive: true,
      },
    });
  }

  async update(id: string, input: UpdateSponsorInput): Promise<Sponsor> {
    return prisma.sponsor.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        ...(input.image
          ? {
              imageStorageKey: input.image.storageKey,
              imageMimeType: input.image.mimeType,
              imageSize: input.image.size,
              imageOriginalName: input.image.originalName,
            }
          : {}),
      },
    });
  }

  async delete(id: string): Promise<Sponsor | null> {
    const sponsor = await this.findById(id);
    if (!sponsor) return null;

    await prisma.sponsor.delete({ where: { id } });
    return sponsor;
  }

  async reorder(ids: string[]): Promise<Sponsor[]> {
    await prisma.$transaction(
      ids.map((id, displayOrder) =>
        prisma.sponsor.update({
          where: { id },
          data: { displayOrder },
        }),
      ),
    );

    return this.findAll();
  }
}
