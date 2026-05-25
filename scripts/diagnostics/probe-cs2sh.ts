import 'dotenv/config';

async function testAll() {
  const apiKey = process.env.CS2_SH_API_KEY || "demo_XtEHDOxUhPjBmvYxesvNbqrPMfkiKNMC";
  console.log("Using API key:", apiKey);
  
  try {
    const res = await fetch('https://api.cs2.sh/v1/prices/latest', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    });
    console.log("GET /prices/latest status:", res.status);
    const data = await res.json();
    const items = data.items || data;
    const keys = Object.keys(items);
    console.log("Total items:", keys.length);
    console.log("First 3 items keys:", keys.slice(0, 3));
    console.log("First item value:", JSON.stringify(items[keys[0]], null, 2));
  } catch (err) {
    console.error("GET failed:", err);
  }
}

testAll();
