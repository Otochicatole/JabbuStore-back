import { prisma } from './shared/infrastructure/PrismaClient';
import { SyncStoreItemsUseCase } from './modules/store/application/SyncStoreItemsUseCase';
import { PrismaStoreRepository } from './modules/store/infrastructure/PrismaStoreRepository';

async function run() {
  console.log("Forcing a complete Store Sync to fix Doppler phases and prices...");
  const repository = new PrismaStoreRepository(prisma);
  const syncUseCase = new SyncStoreItemsUseCase(repository);
  
  try {
    await syncUseCase.execute();
    console.log("Store Sync Complete!");
  } catch (error) {
    console.error("Error during sync:", error);
  } finally {
    await prisma.$disconnect();
  }
}

run();
