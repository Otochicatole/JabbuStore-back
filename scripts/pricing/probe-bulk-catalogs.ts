#!/usr/bin/env npx ts-node
import dotenv from "dotenv";
dotenv.config();

const key = process.env.STEAMWEBAPI_API_KEY;
const currency = process.env.YOUPIN_PRICES_CURRENCY || "USD";

async function probe(url: string, label: string) {
  const u = `${url}?key=${key}&currency=${currency}`;
  const res = await fetch(u);
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }
  const isArr = Array.isArray(parsed);
  const size = isArr
    ? parsed.length
    : parsed && typeof parsed === "object"
      ? Object.keys(parsed as object).length
      : 0;
  console.log(`--- ${label} status=${res.status} isArray=${isArr} size=${size}`);
  if (!isArr) {
    console.log("body preview:", text.slice(0, 300));
    return;
  }
  const rows = parsed as Array<{ market_hash_name?: string; price?: number; variants?: unknown }>;
  console.log("first row:", rows[0]);
  const knife = rows.find((r) =>
    r.market_hash_name?.includes("Karambit | Slaughter"),
  );
  console.log("knife:", knife?.market_hash_name, knife?.price);
  const doppler = rows.find((r) =>
    r.market_hash_name === "★ Karambit | Doppler (Factory New)",
  );
  console.log("doppler base:", doppler?.market_hash_name, doppler?.price, doppler?.variants);
}

async function main() {
  if (!key) {
    console.error("No STEAMWEBAPI_API_KEY");
    process.exit(1);
  }
  await probe("https://www.steamwebapi.com/market/youpin/prices", "youpin");
  await probe("https://www.steamwebapi.com/market/buff/prices", "buff");
}

main().catch(console.error);
