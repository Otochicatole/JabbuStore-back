import { IUserRepository, User, UserInventoryItem } from '../domain/User';
import { AuthService } from '../../../shared/infrastructure/AuthService';
import { PriceEnrichmentService } from '../../../shared/infrastructure/PriceEnrichmentService';

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
      console.log(`[User Inventory Cache] Serving ${cachedInventory.length} items from database for user: ${userId}`);
      return cachedInventory;
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
    
    const steamUrl = `https://steamcommunity.com/inventory/${steamId}/${appId}/${contextId}?l=spanish&count=2000`;
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

      // 5. Enriquecer los ítems con precios acordes al mercado real
      console.log(`[User Inventory Sync] Enriching ${parsedItems.length} items with market prices...`);
      const pricedItems = await PriceEnrichmentService.enrichItemsWithMarketPrices(parsedItems);

      // 6. Guardar en DB para no tener que volver a consultar a Steam
      console.log(`[User Inventory Cache] Saving ${pricedItems.length} items to database cache for user: ${userId}`);
      await this.userRepository.saveUserInventory(userId, pricedItems);

      return pricedItems;
    } catch (error: any) {
      console.error('Error fetching steam inventory:', error);
      
      // Fallback: Si Steam falla pero tenemos ítems cacheados de antes, los devolvemos en vez de lanzar error
      const cachedInventory = await this.userRepository.getUserInventory(userId);
      if (cachedInventory.length > 0) {
        console.warn(`[User Inventory] Steam query failed. Serving stale cached inventory as fallback.`);
        return cachedInventory;
      }
      
      throw new Error(error.message || 'Could not load Steam inventory');
    }
  }

  private parseSteamInventory(data: any, userId: string): UserInventoryItem[] {
    if (!data || !data.assets || !data.descriptions) return [];

    const descriptionsMap = new Map(
      data.descriptions.map((desc: any) => [desc.classid, desc])
    );

    return data.assets.map((asset: any) => {
      const description: any = descriptionsMap.get(asset.classid);
      
      // Obtener el tipo/categoría del ítem si existe
      const type = description?.type || '';

      return {
        assetId: asset.assetid,
        classId: asset.classid,
        name: description?.market_hash_name || description?.name || '',
        type: type,
        iconUrl: description?.icon_url 
          ? `https://community.cloudflare.steamstatic.com/economy/image/${description.icon_url}`
          : null,
        tradable: description?.tradable === 1,
        marketable: description?.marketable === 1,
        userId: userId,
        price: 0, // Se actualizará en el enriquecimiento de precios
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

