"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PrismaAdminRepository = void 0;
const PrismaClient_1 = require("../../../shared/infrastructure/PrismaClient");
class PrismaAdminRepository {
    async save(admin) {
        return PrismaClient_1.prisma.admin.create({
            data: admin,
        });
    }
    async findAll() {
        return PrismaClient_1.prisma.admin.findMany();
    }
    async findByEmail(email) {
        return PrismaClient_1.prisma.admin.findUnique({
            where: { email },
        });
    }
}
exports.PrismaAdminRepository = PrismaAdminRepository;
//# sourceMappingURL=PrismaAdminRepository.js.map