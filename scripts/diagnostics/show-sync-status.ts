import { prisma } from '../../src/shared/infrastructure/PrismaClient';

async function main() {
  const activeRuns = await prisma.marketSyncRun.findMany({
    orderBy: { createdAt: 'desc' },
    take: 5
  });
  
  console.log('Last 5 sync runs:');
  for (const run of activeRuns) {
    console.log(`Run ID: ${run.id}`);
    console.log(`  Status: ${run.status}`);
    console.log(`  Progress: candidatesVisited=${run.candidatesVisited} totalCandidates=${run.totalCandidates}`);
    console.log(`  Assets: validAssetCount=${run.validAssetCount} rawAssetCount=${run.rawAssetCount} runQuotaUnitsUsed=${run.runQuotaUnitsUsed}`);
    console.log(`  Dates: runStartedAt=${run.runStartedAt?.toISOString()} createdAt=${run.createdAt?.toISOString()} updatedAt=${run.updatedAt?.toISOString()}`);
    console.log();
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
