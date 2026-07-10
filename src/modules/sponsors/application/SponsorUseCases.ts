import type {
  CreateSponsorInput,
  ISponsorRepository,
  Sponsor,
  SponsorImageMetadata,
  UpdateSponsorInput,
} from "../domain/Sponsor";

const normalizeName = (name: string) => name.trim();

export class ListPublicSponsorsUseCase {
  constructor(private sponsorRepository: ISponsorRepository) {}

  async execute(): Promise<Sponsor[]> {
    return this.sponsorRepository.findPublic();
  }
}

export class AdminListSponsorsUseCase {
  constructor(private sponsorRepository: ISponsorRepository) {}

  async execute(): Promise<Sponsor[]> {
    return this.sponsorRepository.findAll();
  }
}

export class GetSponsorImageUseCase {
  constructor(private sponsorRepository: ISponsorRepository) {}

  async execute(id: string): Promise<Sponsor> {
    const sponsor = await this.sponsorRepository.findById(id);
    if (!sponsor) {
      throw new Error("SPONSOR_NOT_FOUND");
    }
    return sponsor;
  }
}

export class CreateSponsorUseCase {
  constructor(private sponsorRepository: ISponsorRepository) {}

  async execute(input: CreateSponsorInput): Promise<Sponsor> {
    return this.sponsorRepository.create({
      name: normalizeName(input.name),
      image: input.image,
    });
  }
}

export class UpdateSponsorUseCase {
  constructor(private sponsorRepository: ISponsorRepository) {}

  async execute(
    id: string,
    input: UpdateSponsorInput,
  ): Promise<{ sponsor: Sponsor; previousImageStorageKey: string | null }> {
    const current = await this.sponsorRepository.findById(id);
    if (!current) {
      throw new Error("SPONSOR_NOT_FOUND");
    }

    const updateInput: UpdateSponsorInput = {};
    if (input.name !== undefined) updateInput.name = normalizeName(input.name);
    if (input.isActive !== undefined) updateInput.isActive = input.isActive;
    if (input.image !== undefined) updateInput.image = input.image;

    const sponsor = await this.sponsorRepository.update(id, updateInput);

    return {
      sponsor,
      previousImageStorageKey: input.image ? current.imageStorageKey : null,
    };
  }
}

export class DeleteSponsorUseCase {
  constructor(private sponsorRepository: ISponsorRepository) {}

  async execute(id: string): Promise<Sponsor> {
    const sponsor = await this.sponsorRepository.delete(id);
    if (!sponsor) {
      throw new Error("SPONSOR_NOT_FOUND");
    }
    return sponsor;
  }
}

export class ReorderSponsorsUseCase {
  constructor(private sponsorRepository: ISponsorRepository) {}

  async execute(ids: string[]): Promise<Sponsor[]> {
    const uniqueIds = new Set(ids);
    if (uniqueIds.size !== ids.length) {
      throw new Error("SPONSOR_REORDER_INVALID");
    }

    const sponsors = await this.sponsorRepository.findAll();
    const existingIds = new Set(sponsors.map((sponsor) => sponsor.id));
    if (ids.length !== sponsors.length || ids.some((id) => !existingIds.has(id))) {
      throw new Error("SPONSOR_REORDER_INVALID");
    }

    return this.sponsorRepository.reorder(ids);
  }
}
