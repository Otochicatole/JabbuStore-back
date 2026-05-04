"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PrismaUserRepository = void 0;
const PrismaClient_1 = require("../../../shared/infrastructure/PrismaClient");
class PrismaUserRepository {
    async save(user) {
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
}
exports.PrismaUserRepository = PrismaUserRepository;
//# sourceMappingURL=PrismaUserRepository.js.map