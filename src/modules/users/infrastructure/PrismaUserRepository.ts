import { prisma } from '../../../shared/infrastructure/PrismaClient';
import { IUserRepository, User } from '../domain/User';

export class PrismaUserRepository implements IUserRepository {
  async save(user: any): Promise<User> {
    return prisma.user.create({
      data: user,
    });
  }

  async findAll(): Promise<User[]> {
    return prisma.user.findMany();
  }

  async findByEmail(email: string): Promise<User | null> {
    return prisma.user.findUnique({
      where: { email },
    });
  }
}
