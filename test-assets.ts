import 'dotenv/config';

async function testAssetsAPI() {
  const apiKey = process.env.STEAMWEBAPI_API_KEY;
  if (!apiKey) {
    console.error('No API Key found in .env');
    return;
  }

  // Las dos URLs de prueba teorizadas
  const urls = [
    `https://www.steamwebapi.com/steam/api/assets?key=${apiKey}&appid=730&market_hash_name=AK-47%20%7C%20Asiimov%20%28Field-Tested%29`,
    `https://www.steamwebapi.com/steam/api/float/assets?key=${apiKey}&appid=730&market_hash_name=AK-47%20%7C%20Asiimov%20%28Field-Tested%29`
  ];

  console.log('--- PROBANDO ENDPOINTS DE ASSETS DE STEAMWEBAPI ---');

  for (const url of urls) {
    console.log(`\nProbando URL: ${url}`);
    try {
      const response = await fetch(url);
      console.log(`Status devuelto: ${response.status} ${response.statusText}`);

      const text = await response.text();
      console.log('Respuesta cruda del servidor:');
      try {
        const json = JSON.parse(text);
        console.log(JSON.stringify(json, null, 2));
      } catch {
        console.log(text.substring(0, 500)); // Imprimir texto plano si no es JSON
      }
    } catch (error: any) {
      console.error(`Error en la consulta: ${error.message}`);
    }
  }
}

testAssetsAPI();
