import { prisma } from '../src/shared/infrastructure/PrismaClient';

async function main() {
  console.log('=== INICIANDO LIMPIEZA DE DATOS DE BUFF EN LA BASE DE DATOS ===');
  
  try {
    // 1. Contar y eliminar FloatItems de Buff
    const buffFloatsCount = await prisma.floatItem.count({
      where: {
        market: {
          in: ['BUFF', 'buff']
        }
      }
    });

    console.log(`Floats de Buff encontrados para eliminar: ${buffFloatsCount}`);

    if (buffFloatsCount > 0) {
      const deleteFloatsRes = await prisma.floatItem.deleteMany({
        where: {
          market: {
            in: ['BUFF', 'buff']
          }
        }
      });
      console.log(`Eliminados ${deleteFloatsRes.count} registros de floats asociados a Buff.`);
    }

    // 2. Contar y actualizar MarketListings de Buff
    const buffListingsCount = await prisma.marketListing.count({
      where: {
        provider: {
          in: ['buff', 'BUFF']
        }
      }
    });

    console.log(`Listings con proveedor 'buff' encontrados: ${buffListingsCount}`);

    if (buffListingsCount > 0) {
      // Si el proveedor es buff, lo actualizamos a youpin
      const updateListingsRes = await prisma.marketListing.updateMany({
        where: {
          provider: {
            in: ['buff', 'BUFF']
          }
        },
        data: {
          provider: 'youpin'
        }
      });
      console.log(`Actualizados ${updateListingsRes.count} listings de mercado para establecer YouPin como proveedor.`);
    }

    console.log('=== LIMPIEZA DE DATOS DE BUFF COMPLETADA CON ÉXITO ===');
  } catch (error: any) {
    console.error('Error durante la limpieza de datos:', error.message || error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
