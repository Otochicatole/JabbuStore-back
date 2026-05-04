import { prisma } from '../src/shared/infrastructure/PrismaClient';
import { AuthService } from '../src/shared/infrastructure/AuthService';

async function main() {
  console.log('Seeding database...');

  const hashedPassword = await AuthService.hashPassword('password123');
  const hashedAdminPassword = await AuthService.hashPassword('admin_password');

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
    update: { password: hashedAdminPassword },
    create: {
      username: 'admin_master',
      email: 'admin@example.com',
      password: hashedAdminPassword,
      role: 'SUPER_ADMIN',
    },
  });

  console.log({ user1, user2, admin });
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
