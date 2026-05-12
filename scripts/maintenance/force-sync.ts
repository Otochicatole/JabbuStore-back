import { prisma } from '../../src/shared/infrastructure/PrismaClient';
import { SyncStoreItemsUseCase } from '../../src/modules/store/application/SyncStoreItemsUseCase';
import { PrismaStoreRepository } from '../../src/modules/store/infrastructure/PrismaStoreRepository';

async function run() {
  console.log("Forcing a complete Store Sync to fix Doppler phases and prices...");
  const repository = new PrismaStoreRepository();
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
