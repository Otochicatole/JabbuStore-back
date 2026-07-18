import { IUserRepository, User, UserInventoryItem } from '../domain/User';
import { AuthService } from '../../../shared/infrastructure/AuthService';
import { PriceEnrichmentService } from '../../../shared/infrastructure/PriceEnrichmentService';
import { prisma } from '../../../shared/infrastructure/PrismaClient';

export class CreateUserUseCase {
  constructor(private userRepository: IUserRepository) {}

  async execute(userData: Partial<User>): Promise<User> {
    const existing = await this.userRepository.findByEmail(userData.email!);
    if (existing) {
      throw new Error('User already exists');
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
  constructor(private userRepository: IUserRepository) {}

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
      console.log(`[User Inventory Cache] Cache has expired (older than ${syncIntervalMinutes} mins). Triggering automatic fresh sync from Steam...`);
    }

    // 2. Obtener el usuario de la DB para extraer su steamId verificado si necesitamos sincronizar con Steam
    const user = await this.userRepository.findById(userId);
    if (!user) {
      throw new Error('User not found');
    }
    if (!user.steamId) {
      throw new Error('User does not have a linked Steam account');
    }

    // 3. Consultar el inventario a la API de Steam (Server-to-Server)
    const steamId = user.steamId;
    const appId = 730; // AppID de CS:GO / CS2
    const contextId = 2; // ContextID para inventario de skins
    
    const steamUrl = `https://steamcommunity.com/inventory/${steamId}/${appId}/${contextId}?l=english&count=2000`;
    console.log(`[Steam Inventory Sync] Fetching fresh inventory for Steam ID: ${steamId}`);
    console.log(`[Steam Inventory Sync] Request URL: ${steamUrl}`);
    
    try {
      const response = await fetch(steamUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json',
          'Referer': 'https://steamcommunity.com',
        }
      });
      if (!response.ok) {
        console.error(`[Steam Inventory Error] Status: ${response.status} ${response.statusText}`);
        throw new Error(`Failed to fetch inventory from Steam: ${response.statusText} (${response.status})`);
      }
      const data = (await response.json()) as any;

      // 4. Mapear y limpiar el inventario de Steam para retornar solo lo que el frontend necesita
      const parsedItems = this.parseSteamInventory(data, userId);

      // Filtrar únicamente los artículos que son intercambiables (Enfoque B)
      const tradableItems = parsedItems.filter(item => item.tradable === true);

      // Mapear precios cacheados de la base de datos a los ítems frescos para habilitar las reglas de preservación y protección de precios
      const cachedMap = new Map(cachedInventory.map((i) => [i.assetId, i]));
      const itemsWithCachedPrices = tradableItems.map((item) => {
        const cached = cachedMap.get(item.assetId);
        return {
          ...item,
          price: cached && cached.price > 0 ? cached.price : 0,
        };
      });

      // 5. Enriquecer los ítems con precios acordes al mercado real
      console.log(`[User Inventory Sync] Enriching ${itemsWithCachedPrices.length} tradable items with market prices...`);
      const pricedItems = await this.repriceUserInventoryFromCatalog(
        itemsWithCachedPrices,
        'fresh-steam',
      );

      // 6. Guardar en DB para no tener que volver a consultar a Steam
      console.log(`[User Inventory Cache] Saving ${pricedItems.length} tradable items to database cache for user: ${userId}`);
      await this.userRepository.saveUserInventory(userId, pricedItems);

      return this.applySellModifier(pricedItems);
    } catch (error: any) {
      console.error('Error fetching steam inventory:', error);
      
      // Fallback: Si Steam falla pero tenemos ítems cacheados de antes, los devolvemos en vez de lanzar error
      const cachedInventory = await this.userRepository.getUserInventory(userId);
      if (cachedInventory.length > 0) {
        const tradableCache = cachedInventory.filter(item => item.tradable);
        console.warn(`[User Inventory] Steam query failed. Revalidating stale cache against local Items API catalog.`);
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

  private parseSteamInventory(data: any, userId: string): UserInventoryItem[] {
    if (!data || !data.assets || !data.descriptions) return [];

    const descriptionsMap = new Map<string, any>(
      data.descriptions.map((desc: any) => [String(desc.classid), desc])
    );

    // Parsear asset_properties para obtener floats y patterns exactos provistos por Steam
    const assetPropertiesMap = new Map<string, { float: number | null, pattern: number | null, paintIndex: number | null }>();
    if (data.asset_properties) {
      const propertiesList = Array.isArray(data.asset_properties)
        ? data.asset_properties
        : Object.values(data.asset_properties);

      for (const entry of propertiesList as any[]) {
        if (!entry || !entry.assetid || !entry.asset_properties) continue;
        
        let float: number | null = null;
        let pattern: number | null = null;
        let paintIndex: number | null = null;

        for (const prop of entry.asset_properties) {
          if (prop.propertyid === 1) {
            pattern = prop.int_value ? parseInt(prop.int_value, 10) : null;
          } else if (prop.propertyid === 2) {
            float = prop.float_value ? parseFloat(prop.float_value) : null;
          } else if (prop.propertyid === 7) {
            paintIndex = prop.int_value ? parseInt(prop.int_value, 10) : null;
          }
        }
        assetPropertiesMap.set(String(entry.assetid), { float, pattern, paintIndex });
      }
    }

    return data.assets.map((asset: any) => {
      const description: any = descriptionsMap.get(asset.classid);
      
      // Obtener el tipo/categoría del ítem si existe
      const type = description?.type || '';
      
      const details = PriceEnrichmentService.parseItemDetails(description, asset.assetid);

      // Obtener float y pattern exactos desde la propiedad de Steam si existen
      const propData = assetPropertiesMap.get(String(asset.assetid));
      const floatVal = propData?.float !== undefined ? propData.float : details.float;
      const patternVal = propData?.pattern !== undefined ? propData.pattern : details.pattern;
      const paintIndexVal = propData?.paintIndex !== undefined ? propData.paintIndex : null;
      let rawName = description?.market_hash_name || description?.name || '';
      
      // Detect Doppler phase and append to name if applicable
      const iconHash = description?.icon_url || null;
      const detectedPhase = PriceEnrichmentService.detectDopplerPhase(rawName, iconHash, paintIndexVal);
      if (detectedPhase) {
        const phaseMapping: Record<string, string> = {
          phase1: 'Phase 1',
          phase2: 'Phase 2',
          phase3: 'Phase 3',
          phase4: 'Phase 4',
          ruby: 'Ruby',
          sapphire: 'Sapphire',
          blackpearl: 'Black Pearl',
          emerald: 'Emerald'
        };
        const phaseDisplayName = phaseMapping[detectedPhase];
        if (phaseDisplayName && !rawName.includes(phaseDisplayName)) {
          rawName = `${rawName} | ${phaseDisplayName}`;
        }
      }

      return {
        assetId: asset.assetid,
        classId: asset.classid,
        name: rawName,
        type: type,
        iconUrl: description?.icon_url 
          ? `https://community.cloudflare.steamstatic.com/economy/image/${description.icon_url}`
          : null,
        tradable: description?.tradable === 1,
        marketable: description?.marketable === 1,
        userId: userId,
        price: 0, // Se actualizará en el enriquecimiento de precios
        ...details,
        float: floatVal,
        pattern: patternVal,
        paintIndex: paintIndexVal,
      };
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

