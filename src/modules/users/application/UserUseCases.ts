import { IUserRepository, User, UserInventoryItem } from '../domain/User';
import { AuthService } from '../../../shared/infrastructure/AuthService';
import { PriceEnrichmentService } from '../../../shared/infrastructure/PriceEnrichmentService';
import { prisma } from '../../../shared/infrastructure/PrismaClient';
import {
  SteamWebApiInventoryClient,
  SteamWebApiInventoryError,
  normalizeParsedInventoryItem,
} from '../../../shared/infrastructure/SteamWebApiInventoryClient';

const NON_FALLBACK_ERROR_CODES = new Set([
  'STEAM_INVENTORY_PRIVATE',
  'STEAM_PROFILE_NOT_FOUND',
  'INVALID_STEAM_ID',
  'MISSING_API_KEY',
]);

export class CreateUserUseCase {
  constructor(private userRepository: IUserRepository) {}

  async execute(userData: Partial<User>): Promise<User> {
    const existing = await this.userRepository.findByEmail(userData.email!);
    if (existing) {
      throw new Error('Email already registered');
    }

    if (userData.password) {
      userData.password = await AuthService.hashPassword(userData.password);
    }

    return this.userRepository.save(userData);
  }
}

export class LoginUserUseCase {
  constructor(private userRepository: IUserRepository) {}

  async execute(email: string, password: string): Promise<{ user: User, token: string }> {
    const user = await this.userRepository.findByEmail(email);
    if (!user) {
      throw new Error('Invalid credentials');
    }

    if (!user.password) {
      throw new Error('This account uses Steam login. Please login with Steam.');
    }

    const isValid = await AuthService.comparePassword(password, user.password);
    if (!isValid) {
      throw new Error('Invalid credentials');
    }

    const token = AuthService.generateToken({ id: user.id, email: user.email, role: 'USER' });

    // Remove password from response
    const { password: _, ...userWithoutPassword } = user;

    return { user: userWithoutPassword as User, token };
  }
}

export class GetUsersUseCase {
  constructor(private userRepository: IUserRepository) {}

  async execute(): Promise<User[]> {
    return this.userRepository.findAll();
  }
}

export class GetUserInventoryUseCase {
  constructor(
    private userRepository: IUserRepository,
    private inventoryClient: SteamWebApiInventoryClient = new SteamWebApiInventoryClient(),
  ) {}

  async execute(userId: string, forceSync: boolean = false): Promise<UserInventoryItem[]> {
    // 1. Intentar obtener el inventario ya cacheado en la DB
    const cachedInventory = await this.userRepository.getUserInventory(userId);

    // Obtener el intervalo de expiración en milisegundos (por defecto 10 minutos)
    const syncIntervalMinutes = parseInt(process.env.STORE_SYNC_INTERVAL_MINUTES || '10', 10);
    const syncIntervalMs = syncIntervalMinutes * 60 * 1000;

    let isExpired = false;
    if (cachedInventory.length > 0) {
      const lastUpdated = cachedInventory[0]?.updatedAt;
      if (lastUpdated) {
        const timeDiff = Date.now() - new Date(lastUpdated).getTime();
        isExpired = timeDiff > syncIntervalMs;
        console.log(`[User Inventory Cache] Found ${cachedInventory.length} cached items. Last updated: ${new Date(lastUpdated).toISOString()}. Time elapsed: ${Math.round(timeDiff / 1000)}s. Expired (> ${syncIntervalMinutes}m)? ${isExpired}`);
      } else {
        isExpired = true;
      }
    }

    if (!forceSync && cachedInventory.length > 0 && !isExpired) {
      const tradableCache = cachedInventory.filter(item => item.tradable);
      console.log(`[User Inventory Cache] Revalidating ${tradableCache.length} cached tradable items against local Items API catalog for user: ${userId}`);
      const repricedCache = await this.repriceUserInventoryFromCatalog(
        tradableCache,
        'cache',
      );
      await this.userRepository.updateUserInventoryPricesIfChanged(
        userId,
        repricedCache,
      );
      return this.applySellModifier(repricedCache);
    }

    if (isExpired && !forceSync) {
      console.log(`[User Inventory Cache] Cache has expired (older than ${syncIntervalMinutes} mins). Triggering automatic fresh sync from SteamWebAPI...`);
    }

    // 2. Obtener el usuario de la DB para extraer su steamId verificado (Steam solo se usa para autenticación)
    const user = await this.userRepository.findById(userId);
    if (!user) {
      throw new Error('User not found');
    }
    if (!user.steamId) {
      throw new Error('User does not have a linked Steam account');
    }

    // 3. Consultar el inventario directamente a SteamWebAPI (sin pegar directo a steamcommunity.com)
    console.log(`[SteamWebAPI Inventory Sync] Fetching inventory for Steam ID: ${user.steamId} (forceSync=${forceSync})`);

    try {
      const rawItems = await this.inventoryClient.fetchInventory({
        steamId: user.steamId,
        game: 'cs2',
        noCache: forceSync,
        state: 'active',
        withNoTradable: true,
      });

      // 4. Mapear al formato de inventario del usuario conservando precios cacheados previos
      const cachedMap = new Map(cachedInventory.map((i) => [i.assetId, i]));
      const tradableItems: UserInventoryItem[] = [];

      for (const rawItem of rawItems) {
        const normalized = normalizeParsedInventoryItem(rawItem);
        if (!normalized || !normalized.tradable) continue;
        const cached = cachedMap.get(normalized.assetId);
        tradableItems.push({
          assetId: normalized.assetId,
          classId: normalized.classId,
          name: normalized.name,
          type: normalized.type,
          iconUrl: normalized.iconUrl,
          tradable: normalized.tradable,
          marketable: normalized.marketable,
          userId,
          price: cached && cached.price > 0 ? cached.price : 0,
          rarity: normalized.rarity,
          exterior: normalized.exterior,
          category: normalized.category,
          isStatTrak: normalized.isStatTrak,
          isSouvenir: normalized.isSouvenir,
          float: normalized.float,
          pattern: normalized.pattern,
          paintIndex: normalized.paintIndex,
        });
      }

      // 5. Enriquecer los ítems con precios acordes al mercado real
      console.log(`[User Inventory Sync] Enriching ${tradableItems.length} tradable items with market prices...`);
      const pricedItems = await this.repriceUserInventoryFromCatalog(
        tradableItems,
        'fresh-steam',
      );

      // 6. Guardar en DB para no tener que volver a consultar innecesariamente
      console.log(`[User Inventory Cache] Saving ${pricedItems.length} tradable items to database cache for user: ${userId}`);
      await this.userRepository.saveUserInventory(userId, pricedItems);

      return this.applySellModifier(pricedItems);
    } catch (error: any) {
      console.error('Error fetching inventory from SteamWebAPI:', error);

      if (
        error instanceof SteamWebApiInventoryError &&
        NON_FALLBACK_ERROR_CODES.has(error.code)
      ) {
        throw error;
      }

      // Fallback ante fallas transitorias: si tenemos caché previo en DB, lo revalidamos
      if (cachedInventory.length > 0) {
        const tradableCache = cachedInventory.filter(item => item.tradable);
        console.warn(`[User Inventory] SteamWebAPI query failed. Revalidating stale cache against local Items API catalog.`);
        const repricedCache = await this.repriceUserInventoryFromCatalog(
          tradableCache,
          'stale-cache',
        );
        await this.userRepository.updateUserInventoryPricesIfChanged(
          userId,
          repricedCache,
        );
        return this.applySellModifier(repricedCache);
      }

      if (error instanceof SteamWebApiInventoryError) {
        throw error;
      }
      throw new Error(error.message || 'Could not load Steam inventory');
    }
  }

  private async repriceUserInventoryFromCatalog(
    items: UserInventoryItem[],
    source: 'cache' | 'fresh-steam' | 'stale-cache',
  ): Promise<UserInventoryItem[]> {
    if (items.length === 0) return items;

    console.log(
      `[User Inventory Pricing] Repricing ${items.length} ${source} item(s) from local Items API catalog...`,
    );

    return PriceEnrichmentService.enrichItemsWithMarketPrices(items, {
      preserveExistingWhenMissing: true,
      useFallbackWhenMissing: true,
    });
  }

  private async applySellModifier(items: UserInventoryItem[]): Promise<UserInventoryItem[]> {
    const settings = await prisma.adminSettings.findFirst();

    if (!settings || !settings.userSellModifierEnabled) {
      return items;
    }

    const value = settings.userSellModifierValue;
    const type = settings.userSellModifierType;

    return items.map(item => {
      let modifiedPrice = item.price;
      if (type === 'percentage_increase') {
        modifiedPrice = item.price * (1 + value / 100);
      } else if (type === 'percentage_decrease') {
        modifiedPrice = item.price * (1 - value / 100);
      } else if (type === 'fixed_increase') {
        modifiedPrice = item.price + value;
      } else if (type === 'fixed_decrease') {
        modifiedPrice = item.price - value;
      }
      return {
        ...item,
        price: Math.max(0, modifiedPrice)
      };
    });
  }
}

export class GetUserProfileUseCase {
  constructor(private userRepository: IUserRepository) {}

  async execute(userId: string): Promise<User | null> {
    const user = await this.userRepository.findById(userId);
    return user;
  }
}

export class UpdateUserProfileUseCase {
  constructor(private userRepository: IUserRepository) {}

  async execute(userId: string, data: {
    name?: string | null;
    email?: string | null;
    tradeUrl?: string | null;
    preferredCurrency?: User["preferredCurrency"];
  }): Promise<User> {
    const user = await this.userRepository.findById(userId);
    if (!user) {
      throw new Error('User not found');
    }

    const nextEmail = data.email !== undefined ? data.email : user.email;
    if (nextEmail && nextEmail !== user.email) {
      const existing = await this.userRepository.findByEmail(nextEmail);
      if (existing && existing.id !== userId) {
        throw new Error('Email already registered');
      }
    }

    const updatedUser = await this.userRepository.save({
      id: userId,
      name: data.name !== undefined ? data.name : user.name,
      email: data.email !== undefined ? data.email : user.email,
      tradeUrl: data.tradeUrl !== undefined ? data.tradeUrl : (user as any).tradeUrl,
      preferredCurrency:
        data.preferredCurrency !== undefined
          ? data.preferredCurrency
          : user.preferredCurrency,
    });

    return updatedUser;
  }
}
