import { prisma } from '../../../shared/infrastructure/PrismaClient';
import { IAdminRepository, Admin } from '../domain/Admin';

export class PrismaAdminRepository implements IAdminRepository {
  async save(admin: any): Promise<Admin> {
    return prisma.admin.create({
      data: admin,
    });
  }

  async findAll(): Promise<Admin[]> {
    return prisma.admin.findMany({
      select: {
        id: true,
        username: true,
        email: true,
        role: true,
        createdAt: true,
        updatedAt: true,
      },
    }) as any;
  }

  async findByEmail(email: string): Promise<Admin | null> {
    return prisma.admin.findUnique({
      where: { email },
    });
  }
}
