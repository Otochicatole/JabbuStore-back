import 'dotenv/config';
import { prisma } from '../src/shared/infrastructure/PrismaClient';
import { BotService } from '../src/modules/marketplace/application/BotService';
import {
  buildInspectLinkFromCertificateHex,
  normalizeSteamWebApiInspectLink,
} from '../src/shared/infrastructure/inspectLinkHelpers';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const GAP_MS = 31_000;

async function fetchLinks(botSteamId: string, apiKey: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const params = new URLSearchParams({
    key: apiKey,
    steam_id: botSteamId,
    game: 'cs2',
    parse: '1',
    with_no_tradable: '1',
    limit: '10000',
  });
  const res = await fetch(`https://www.steamwebapi.com/steam/api/inventory?${params}`);
  if (!res.ok) return map;
  const items: any[] = await res.json();
  if (!Array.isArray(items)) return map;
  for (const item of items) {
    const id = String(item.assetid ?? '');
    if (!id) continue;
    const link =
      normalizeSteamWebApiInspectLink(item.inspectlink) ??
      (item.float?.certificate
        ? buildInspectLinkFromCertificateHex(String(item.float.certificate))
        : null);
    if (link) map.set(id, link);
  }
  return map;
}

async function main() {
  const apiKey = process.env.STEAMWEBAPI_API_KEY;
  if (!apiKey) throw new Error('STEAMWEBAPI_API_KEY requerido');

  const bots = (await BotService.getAllBots()).filter((b) => b.isActive);
  let updated = 0;

  for (let i = 0; i < bots.length; i++) {
    if (i > 0) await sleep(GAP_MS);
    const bot = bots[i]!;
    console.log(`Bot ${bot.steamId}...`);
    const links = await fetchLinks(bot.steamId, apiKey);
    const items = await prisma.storeItem.findMany({
      where: { botSteamId: bot.steamId },
      select: { assetId: true, inspectLink: true },
    });
    for (const item of items) {
      const link = links.get(item.assetId);
      if (!link || link === item.inspectLink) continue;
      await prisma.storeItem.update({
        where: { assetId: item.assetId },
        data: { inspectLink: link },
      });
      updated++;
    }
  }

  console.log(`Actualizados ${updated} inspect links.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
