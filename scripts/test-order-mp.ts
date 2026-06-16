import 'dotenv/config';
import { prisma } from '../src/shared/infrastructure/PrismaClient';
import { AuthService } from '../src/shared/infrastructure/AuthService';

async function runTest() {
  console.log('Starting end-to-end API test for Mercado Pago order creation...');

  // 1. Get user
  const user = await prisma.user.findFirst();
  if (!user) {
    console.error('No users found in database');
    return;
  }
  console.log(`Using user: ${user.id} (${user.displayName || user.steamId})`);

  // 2. Generate token
  const token = AuthService.generateToken({
    id: user.id,
    steamId: user.steamId,
    role: (user as any).role || 'USER'
  });
  console.log('JWT Token signed successfully');

  // 3. Get some store items to purchase
  const items = await prisma.storeItem.findMany({ take: 1 });
  if (items.length === 0) {
    console.error('No store items available for purchase in DB');
    return;
  }
  console.log(`Using store item for purchase: ${items[0].name} (${items[0].assetId}) - Price: ${items[0].price}`);

  // 4. Construct payload
  const payload = {
    itemIds: items.map(i => i.assetId),
    items: items.map(i => ({
      assetId: i.assetId,
      name: i.name,
      price: i.price,
      iconUrl: i.iconUrl,
      float: i.float,
      pattern: i.pattern,
      rarity: i.rarity || 'common',
      exterior: i.exterior || null,
      provider: 'bot'
    })),
    paymentMethod: 'mercado_pago',
    metadata: {
      firstName: 'Test',
      lastName: 'User',
      email: 'test@example.com',
      phone: '1234567890',
      cbu: null,
      cuil: null,
      accountHolder: null,
      walletAddress: null,
      network: null
    }
  };

  // 5. Send POST request
  try {
    console.log('Sending POST to http://localhost:3001/api/orders ...');
    const res = await fetch('http://localhost:3001/api/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(payload)
    });

    console.log(`Response Status: ${res.status}`);
    const data = await res.json();
    console.log('Response JSON:', JSON.stringify(data, null, 2));
  } catch (err: any) {
    console.error('Request failed:', err.message || err);
  }
}

runTest().then(() => prisma.$disconnect());
