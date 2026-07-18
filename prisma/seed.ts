import { prisma } from '../src/shared/infrastructure/PrismaClient';
import { AuthService } from '../src/shared/infrastructure/AuthService';
import crypto from 'node:crypto';

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to run development seed in production.');
  }

  console.log('Seeding database...');

  const userPassword = process.env.SEED_USER_PASSWORD || crypto.randomBytes(18).toString('hex');
  const adminPassword = process.env.SEED_ADMIN_PASSWORD || crypto.randomBytes(24).toString('hex');
  
  console.log('User password type:', typeof userPassword);
  console.log('Admin password type:', typeof adminPassword);
  
  const hashedPassword = await AuthService.hashPassword(userPassword);
  const hashedAdminPassword = await AuthService.hashPassword(adminPassword);

  // Create Users
  const user1 = await prisma.user.upsert({
    where: { email: 'user1@example.com' },
    update: { password: hashedPassword },
    create: {
      email: 'user1@example.com',
      name: 'John Doe',
      password: hashedPassword,
    },
  });

  const user2 = await prisma.user.upsert({
    where: { email: 'user2@example.com' },
    update: { password: hashedPassword },
    create: {
      email: 'user2@example.com',
      name: 'Jane Smith',
      password: hashedPassword,
    },
  });

  // Create Admin
  const admin = await prisma.admin.upsert({
    where: { email: 'admin@example.com' },
    update: { password: hashedAdminPassword, role: 'SUPER_ADMIN' },
    create: {
      username: 'admin_master',
      email: 'admin@example.com',
      password: hashedAdminPassword,
      role: 'SUPER_ADMIN',
    },
  });

  console.log({
    users: [user1.email, user2.email],
    admin: admin.email,
    generatedPasswords: {
      user: process.env.SEED_USER_PASSWORD ? 'from env' : 'generated',
      admin: process.env.SEED_ADMIN_PASSWORD ? 'from env' : 'generated',
    },
  });
  console.log('Seeding finished.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
