import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  SteamWebApiInventoryClient,
  SteamWebApiInventoryError,
  normalizeParsedInventoryItem,
} from '../../../../shared/infrastructure/SteamWebApiInventoryClient';
import { GetUserInventoryUseCase } from '../UserUseCases';
import type { IUserRepository, User, UserInventoryItem } from '../../domain/User';
import { config } from '../../../../shared/config';
import { PriceEnrichmentService } from '../../../../shared/infrastructure/PriceEnrichmentService';
import { prisma } from '../../../../shared/infrastructure/PrismaClient';

describe('SteamWebApiInventoryClient', () => {
  beforeEach(() => {
    config.steamwebapiApiKey = 'test-api-key';
  });

  it('paginates via last_assetid -> start_assetid and forwards no_cache=1 on page 0 only', async () => {
    const requestedUrls: string[] = [];
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      requestedUrls.push(url);
      if (requestedUrls.length === 1) {
        return new Response(
          JSON.stringify([{ assetid: '101', markethashname: 'AK-47 | Redline (Field-Tested)', tradable: true }]),
          { status: 200, headers: { last_assetid: '101' } },
        );
      }
      return new Response(
        JSON.stringify([{ assetid: '202', markethashname: 'AWP | Asiimov (Field-Tested)', tradable: true }]),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const client = new SteamWebApiInventoryClient(fetchMock);
    const items = await client.fetchInventory({
      steamId: '76561198100000000',
      noCache: true,
    });

    expect(items).toHaveLength(2);
    expect(requestedUrls).toHaveLength(2);
    expect(requestedUrls[0]).toContain('https://www.steamwebapi.com/steam/api/inventory?');
    expect(requestedUrls[0]).toContain('no_cache=1');
    expect(requestedUrls[0]).not.toContain('steamcommunity.com');
    expect(requestedUrls[1]).toContain('start_assetid=101');
    expect(requestedUrls[1]).not.toContain('no_cache=1');
  });

  it('returns an empty list on HTTP 410 or 411', async () => {
    const fetchMock = vi.fn(async () => new Response('{"error":"NO_ITEMS"}', { status: 411 })) as unknown as typeof fetch;
    const client = new SteamWebApiInventoryClient(fetchMock);

    const items = await client.fetchInventory({ steamId: '76561198100000000' });
    expect(items).toEqual([]);
  });

  it('maps HTTP 403 PRIVATE and 429 rate limit to structured errors', async () => {
    const privateFetch = vi.fn(async () => new Response('{"error":"PRIVATE"}', { status: 403 })) as unknown as typeof fetch;
    const privateClient = new SteamWebApiInventoryClient(privateFetch);
    await expect(privateClient.fetchInventory({ steamId: '76561198100000000' })).rejects.toMatchObject({
      name: 'SteamWebApiInventoryError',
      status: 403,
      code: 'STEAM_INVENTORY_PRIVATE',
    });

    const rateLimitFetch = vi.fn(async () => new Response('{"error":"Rate limit"}', { status: 429 })) as unknown as typeof fetch;
    const rateClient = new SteamWebApiInventoryClient(rateLimitFetch);
    await expect(rateClient.fetchInventory({ steamId: '76561198100000000' })).rejects.toMatchObject({
      name: 'SteamWebApiInventoryError',
      status: 429,
      code: 'STEAMWEBAPI_RATE_LIMIT',
    });
  });

  it('normalizes Doppler phase, inspect link, and exact float including 0', () => {
    const item = normalizeParsedInventoryItem({
      assetid: '555',
      classid: '999',
      markethashname: '★ Butterfly Knife | Doppler (Factory New)',
      image: 'https://cdn.example.com/ruby.png',
      tradable: true,
      inspectlink: 'steam://rungame/730/76561202255233023/+csgo_econ_action_preview S7656A555D123',
      float: {
        floatvalue: 0,
        paintseed: 12,
        paintindex: 415,
        phase: 'ruby',
      },
    });

    expect(item).not.toBeNull();
    expect(item!.name).toBe('★ Butterfly Knife | Doppler (Factory New) | Ruby');
    expect(item!.float).toBe(0);
    expect(item!.pattern).toBe(12);
    expect(item!.paintIndex).toBe(415);
    expect(item!.rarity).toBe('ancient');
    expect(item!.category).toBe('knife');
    expect(item!.inspectLink).toContain('steam://rungame/730/');

    const sticker = normalizeParsedInventoryItem({
      assetid: '777',
      markethashname: 'Sticker | Titan | Katowice 2014',
      rarity: 'High Grade',
      paintindex: 46,
      isstattrak: false,
      tradable: true,
    });
    expect(sticker?.rarity).toBe('rare');
    expect(sticker?.paintIndex).toBe(46);
  });
});

function createRepoMock(cached: UserInventoryItem[] = []): IUserRepository {
  return {
    save: vi.fn(),
    findAll: vi.fn(async () => []),
    findById: vi.fn(async (id: string): Promise<User | null> => ({
      id,
      email: null,
      name: 'Test',
      password: null,
      steamId: '76561198100000000',
      avatar: null,
      profileUrl: null,
      preferredCurrency: 'USD',
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
    findByEmail: vi.fn(async () => null),
    findBySteamId: vi.fn(async () => null),
    getUserInventory: vi.fn(async () => cached),
    saveUserInventory: vi.fn(async () => {}),
    updateUserInventoryPricesIfChanged: vi.fn(async () => 0),
  };
}

describe('GetUserInventoryUseCase (SteamWebAPI)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.STORE_SYNC_INTERVAL_MINUTES = '10';
    vi.spyOn(prisma.adminSettings, 'findFirst').mockResolvedValue(null);
    vi.spyOn(PriceEnrichmentService, 'enrichItemsWithMarketPrices').mockImplementation(
      async (items) => items.map((item) => ({ ...item, price: item.price || 150 })),
    );
  });

  it('fetches tradable items via SteamWebApiInventoryClient and saves them in DB', async () => {
    const repo = createRepoMock();
    const fetchInventoryMock = vi.fn(async () => [
      {
        assetid: '10',
        classid: '20',
        markethashname: 'AK-47 | Redline (Field-Tested)',
        image: 'https://cdn.example.com/ak.png',
        tradable: true,
        float: { floatvalue: 0.21, paintseed: 100, paintindex: 282 },
      },
      {
        assetid: '11',
        classid: '21',
        markethashname: 'AK-47 | Slate (Field-Tested)',
        tradable: false,
      },
    ]);

    const useCase = new GetUserInventoryUseCase(repo, {
      fetchInventory: fetchInventoryMock,
    } as unknown as SteamWebApiInventoryClient);

    const result = await useCase.execute('user-1', true);

    expect(fetchInventoryMock).toHaveBeenCalledWith({
      steamId: '76561198100000000',
      game: 'cs2',
      noCache: true,
      state: 'active',
      withNoTradable: true,
    });
    expect(result).toHaveLength(1);
    expect(result[0]!.assetId).toBe('10');
    expect(repo.saveUserInventory).toHaveBeenCalledTimes(1);
  });

  it('propagates STEAM_INVENTORY_PRIVATE even when cached items exist', async () => {
    const cachedItem: UserInventoryItem = {
      assetId: '1',
      classId: '2',
      name: 'Glock-18 | Water Elemental (Factory New)',
      type: 'Pistol',
      iconUrl: null,
      tradable: true,
      marketable: true,
      userId: 'user-1',
      price: 12,
      rarity: 'legendary',
      exterior: 'Factory New',
      category: 'pistol',
      isStatTrak: false,
      isSouvenir: false,
      float: 0.03,
      pattern: 4,
      updatedAt: new Date(Date.now() - 60 * 60 * 1000),
    };
    const repo = createRepoMock([cachedItem]);
    const useCase = new GetUserInventoryUseCase(repo, {
      fetchInventory: vi.fn(async () => {
        throw new SteamWebApiInventoryError(403, 'STEAM_INVENTORY_PRIVATE', 'PRIVATE');
      }),
    } as unknown as SteamWebApiInventoryClient);

    await expect(useCase.execute('user-1', true)).rejects.toMatchObject({
      code: 'STEAM_INVENTORY_PRIVATE',
      status: 403,
    });
  });

  it('falls back to stale DB cache on transient SteamWebAPI rate limits', async () => {
    const cachedItem: UserInventoryItem = {
      assetId: '1',
      classId: '2',
      name: 'Glock-18 | Water Elemental (Factory New)',
      type: 'Pistol',
      iconUrl: null,
      tradable: true,
      marketable: true,
      userId: 'user-1',
      price: 12,
      rarity: 'legendary',
      exterior: 'Factory New',
      category: 'pistol',
      isStatTrak: false,
      isSouvenir: false,
      float: 0.03,
      pattern: 4,
      updatedAt: new Date(Date.now() - 60 * 60 * 1000),
    };
    const repo = createRepoMock([cachedItem]);
    const fetchInventoryMock = vi.fn(async () => {
      throw new SteamWebApiInventoryError(429, 'STEAMWEBAPI_RATE_LIMIT', 'Rate limit');
    });
    const useCase = new GetUserInventoryUseCase(repo, {
      fetchInventory: fetchInventoryMock,
    } as unknown as SteamWebApiInventoryClient);

    const result = await useCase.execute('user-1', false);
    expect(fetchInventoryMock).toHaveBeenCalledTimes(1);
    expect(result).toHaveLength(1);
    expect(result[0]!.assetId).toBe('1');
  });
});
