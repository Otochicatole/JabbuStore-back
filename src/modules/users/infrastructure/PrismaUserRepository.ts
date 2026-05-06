import { prisma } from '../../../shared/infrastructure/PrismaClient';
import { IUserRepository, User } from '../domain/User';

export class PrismaUserRepository implements IUserRepository {
  async save(user: any): Promise<User> {
    if (user.id) {
      const { id, ...data } = user;
      return prisma.user.update({
        where: { id },
        data,
      });
    }
    return prisma.user.create({
      data: user,
    });
  }

  async findAll(): Promise<User[]> {
    return prisma.user.findMany();
  }

  async findById(id: string): Promise<User | null> {
    return prisma.user.findUnique({
      where: { id },
    });
  }

  async findByEmail(email: string): Promise<User | null> {
    return prisma.user.findUnique({
      where: { email },
    });
  }

  async findBySteamId(steamId: string): Promise<User | null> {
    return prisma.user.findUnique({
      where: { steamId },
    });
  }
}
