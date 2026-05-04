"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PrismaUserRepository = void 0;
const PrismaClient_1 = require("../../../shared/infrastructure/PrismaClient");
class PrismaUserRepository {
    async save(user) {
        if (user.id) {
            const { id, ...data } = user;
            return PrismaClient_1.prisma.user.update({
                where: { id },
                data,
            });
        }
        return PrismaClient_1.prisma.user.create({
            data: user,
        });
    }
    async findAll() {
        return PrismaClient_1.prisma.user.findMany();
    }
    async findByEmail(email) {
        return PrismaClient_1.prisma.user.findUnique({
            where: { email },
        });
    }
    async findBySteamId(steamId) {
        return PrismaClient_1.prisma.user.findUnique({
            where: { steamId },
        });
    }
}
exports.PrismaUserRepository = PrismaUserRepository;
//# sourceMappingURL=PrismaUserRepository.js.map