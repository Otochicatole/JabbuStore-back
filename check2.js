require('ts-node/register');
const { prisma } = require('./src/shared/infrastructure/PrismaClient');
async function run() {
  const list = await prisma.floatItem.findMany({where: {floatValue: 0}});
  console.log('count:', list.length);
  if(list.length > 0) {
    console.log(list.slice(0, 5));
  }
  await prisma.$disconnect();
}
run();
