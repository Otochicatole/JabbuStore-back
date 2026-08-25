import { promises as fs } from "node:fs";
import path from "node:path";

const catalogPath = path.resolve(process.cwd(), "steamwebapi-json-data/items-catalog.json");
const outputDirectory = path.resolve(process.cwd(), "..", "JabbuStore", "public", "category-images");

const categories = [
  ["knife", "knives"],
  ["gloves", "gloves"],
  ["rifle", "rifles"],
  ["sniper rifle", "snipers"],
  ["pistol", "pistols"],
  ["smg", "smgs"],
  ["shotgun", "shotguns"],
  ["machinegun", "machine_guns"],
  ["equipment", "equipment"],
  ["sticker", "stickers"],
  ["container", "containers"],
  ["agent", "agents"],
  ["charm", "charms"],
  ["graffiti", "graffiti"],
  ["patch", "patches"],
  ["music kit", "music_kits"],
  ["collectible", "collectibles"],
  ["pass", "passes"],
  ["key", "keys"],
  ["gift", "gifts"],
  ["tool", "tools"],
  ["tag", "tags"],
];

function normalize(value) {
  return String(value ?? "").trim().toLowerCase().replace(/_/g, " ").replace(/\s+/g, " ");
}

function imageUrl(row) {
  const candidates = [
    row.itemimage,
    row.image,
    ...(Array.isArray(row.variants) ? row.variants.map((variant) => variant?.image) : []),
  ];
  for (const value of candidates) {
    if (typeof value !== "string" || !/^https?:\/\/[^\s]+$/i.test(value)) continue;
    const nestedUrlStart = Math.max(value.indexOf("https://", 8), value.indexOf("http://", 8));
    if (nestedUrlStart >= 0) return value.slice(nestedUrlStart);
    return value;
  }
  return null;
}

function extensionFor(contentType) {
  if (contentType.includes("webp")) return "webp";
  if (contentType.includes("jpeg") || contentType.includes("jpg")) return "jpg";
  return "png";
}

const catalog = JSON.parse(await fs.readFile(catalogPath, "utf8"));
await fs.mkdir(outputDirectory, { recursive: true });

const downloaded = [];
for (const [group, token] of categories) {
  const candidates = (catalog.items ?? [])
    .filter((row) => normalize(row.itemgroup) === group && imageUrl(row))
    .sort((left, right) => {
      const leftSouvenir = /^souvenir\b/i.test(String(left.markethashname ?? ""));
      const rightSouvenir = /^souvenir\b/i.test(String(right.markethashname ?? ""));
      return Number(leftSouvenir) - Number(rightSouvenir);
    });

  const selected = candidates[0];
  if (!selected) throw new Error(`No se encontró una imagen para itemgroup=${group}`);

  const source = imageUrl(selected);
  const response = await fetch(source, { headers: { accept: "image/*" } });
  if (!response.ok) throw new Error(`SteamWebAPI image ${response.status}: ${source}`);

  const extension = extensionFor(response.headers.get("content-type") ?? "");
  const filename = `${token}-steam.${extension}`;
  await fs.writeFile(path.join(outputDirectory, filename), Buffer.from(await response.arrayBuffer()));
  downloaded.push({ token, filename, itemgroup: group, marketHashName: selected.markethashname, source });
}

console.log(JSON.stringify({ downloaded }, null, 2));
