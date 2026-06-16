import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';

async function downloadData() {
  const apiKey = process.env.STEAMWEBAPI_API_KEY;
  if (!apiKey) {
    console.error("ERROR: No se encontró la variable STEAMWEBAPI_API_KEY en el archivo .env");
    return;
  }

  const outputDir = path.join(__dirname, '..', 'steamwebapi json data');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
    console.log(`Creada la carpeta: ${outputDir}`);
  }

  const endpoints = [
    {
      name: 'items.json',
      url: `https://www.steamwebapi.com/steam/api/items?key=${apiKey}&appid=730`
    },
    {
      name: 'prices.json',
      url: `https://www.steamwebapi.com/steam/api/prices?key=${apiKey}&appid=730`
    },
    {
      name: 'market_prices.json',
      url: `https://www.steamwebapi.com/market/prices?key=${apiKey}&appid=730`
    },
    {
      name: 'buff_prices.json',
      url: `https://www.steamwebapi.com/market/buff/prices?key=${apiKey}`
    }
  ];

  for (const endpoint of endpoints) {
    console.log(`Descargando ${endpoint.name} desde ${endpoint.url.replace(apiKey, 'HIDDEN_KEY')}...`);
    try {
      const response = await fetch(endpoint.url);
      if (!response.ok) {
        throw new Error(`HTTP Error status: ${response.status}`);
      }
      
      const data = await response.json();
      const filePath = path.join(outputDir, endpoint.name);
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
      
      let count = 'N/A';
      if (Array.isArray(data)) {
        count = `${data.length} elementos (Array)`;
      } else if (data && typeof data === 'object') {
        count = `${Object.keys(data).length} claves (Objeto)`;
      }
      console.log(`✅ Guardado exitosamente: ${filePath} (${count})\n`);
    } catch (error: any) {
      console.error(`❌ Error descargando ${endpoint.name}: ${error.message}\n`);
    }
  }

  console.log("=== Proceso finalizado ===");
}

downloadData();
