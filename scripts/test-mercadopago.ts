import 'dotenv/config';
import { MercadoPagoService } from '../src/shared/infrastructure/MercadoPagoService';

async function runTest() {
  console.log('Testing Mercado Pago preference creation...');
  console.log('MERCADOPAGO_ACCESS_TOKEN:', process.env.MERCADOPAGO_ACCESS_TOKEN ? 'Present' : 'Missing');
  console.log('BACKEND_URL:', process.env.BACKEND_URL);
  console.log('FRONTEND_URL:', process.env.FRONTEND_URL);

  const mockOrder = {
    id: 'test-order-mp-' + Date.now(),
    userId: 'test-user-id',
    items: [
      {
        assetId: 'test-skin-1',
        name: 'AK-47 | Redline (Field-Tested)',
        price: 15.50
      }
    ]
  };

  try {
    const initPoint = await MercadoPagoService.createPreference(
      mockOrder,
      process.env.FRONTEND_URL || 'http://localhost:3000',
      process.env.BACKEND_URL || 'http://localhost:3001'
    );
    console.log('SUCCESS!');
    console.log('Init Point (Checkout URL):', initPoint);
  } catch (err: any) {
    console.error('ERROR creating preference:');
    if (err.message) console.error('Message:', err.message);
    if (err.stack) console.error('Stack:', err.stack);
    console.error('Full error object:', JSON.stringify(err, null, 2));
  }
}

runTest();
