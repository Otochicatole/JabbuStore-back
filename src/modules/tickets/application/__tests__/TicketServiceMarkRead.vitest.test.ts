import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../../../shared/infrastructure/PrismaClient';
import { TicketService } from '../TicketService';

describe('TicketService.markRead & setStatus ordering stability', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('skips DB write and returns changed=false when unreadCount is 0', async () => {
    const fixedUpdatedAt = new Date('2026-11-20T10:00:00.000Z');
    vi.spyOn(prisma.orderTicket, 'findUnique').mockResolvedValue({
      id: 'ticket-1',
      orderId: 'order-1',
      userId: 'user-1',
      subject: 'Consulta',
      status: 'CLOSED',
      userLastReadAt: fixedUpdatedAt,
      adminLastReadAt: fixedUpdatedAt,
      closedAt: fixedUpdatedAt,
      closedByAdminId: 'admin-1',
      createdAt: fixedUpdatedAt,
      updatedAt: fixedUpdatedAt,
    });
    vi.spyOn(prisma.ticketMessage, 'count').mockResolvedValue(0);
    const updateSpy = vi.spyOn(prisma.orderTicket, 'update');

    const result = await TicketService.markRead('ticket-1', {
      id: 'admin-1',
      role: 'ADMIN',
    });

    expect(result.changed).toBe(false);
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('preserves original updatedAt when marking unread messages as read so ticket list never reorders', async () => {
    const originalUpdatedAt = new Date('2026-11-20T10:00:00.000Z');
    vi.spyOn(prisma.orderTicket, 'findUnique').mockResolvedValue({
      id: 'ticket-2',
      orderId: 'order-2',
      userId: 'user-2',
      subject: 'Pago pendiente',
      status: 'OPEN',
      userLastReadAt: null,
      adminLastReadAt: null,
      closedAt: null,
      closedByAdminId: null,
      createdAt: originalUpdatedAt,
      updatedAt: originalUpdatedAt,
    });
    vi.spyOn(prisma.ticketMessage, 'count').mockResolvedValue(2);
    const updateSpy = vi
      .spyOn(prisma.orderTicket, 'update')
      .mockImplementation((async (args: any) => ({
        id: 'ticket-2',
        ...args.data,
      })) as any);

    const result = await TicketService.markRead('ticket-2', {
      id: 'admin-1',
      role: 'SUPER_ADMIN',
    });

    expect(result.changed).toBe(true);
    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy.mock.calls[0]?.[0]?.data?.updatedAt).toBe(originalUpdatedAt);
    expect(updateSpy.mock.calls[0]?.[0]?.data?.adminLastReadAt).toBeInstanceOf(Date);
  });

  it('preserves original updatedAt when toggling ticket status', async () => {
    const originalUpdatedAt = new Date('2026-11-21T15:30:00.000Z');
    vi.spyOn(prisma.orderTicket, 'findUnique').mockResolvedValue({
      id: 'ticket-3',
      orderId: 'order-3',
      userId: 'user-3',
      subject: 'Float',
      status: 'OPEN',
      userLastReadAt: null,
      adminLastReadAt: null,
      closedAt: null,
      closedByAdminId: null,
      createdAt: originalUpdatedAt,
      updatedAt: originalUpdatedAt,
    });
    const updateSpy = vi
      .spyOn(prisma.orderTicket, 'update')
      .mockResolvedValue({ id: 'ticket-3' } as any);

    await TicketService.setStatus('ticket-3', 'admin-1', 'CLOSED');

    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy.mock.calls[0]?.[0]?.data?.updatedAt).toBe(originalUpdatedAt);
    expect(updateSpy.mock.calls[0]?.[0]?.data?.status).toBe('CLOSED');
  });

  it('honors explicit updatedAt in the real Prisma 7 engine without bumping @updatedAt', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'jabbu-ticket-prisma-'));
    const dbPath = path.join(dir, 'test.db');
    const sqlite = new Database(dbPath);
    sqlite.pragma('foreign_keys = ON');
    const migrationsDir = path.join(process.cwd(), 'prisma', 'migrations');
    const migrations = readdirSync(migrationsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    for (const migration of migrations) {
      sqlite.exec(readFileSync(path.join(migrationsDir, migration, 'migration.sql'), 'utf8'));
    }
    sqlite.close();

    const localPrisma = new PrismaClient({
      adapter: new PrismaBetterSqlite3({ url: `file:${dbPath}` }),
    });
    try {
      const pastDate = new Date('2026-01-15T12:00:00.000Z');
      await localPrisma.user.create({
        data: { id: 'u1', name: 'Test User' },
      });
      await localPrisma.order.create({
        data: {
          id: 'o1',
          userId: 'u1',
          type: 'BUY',
          status: 'COMPLETED',
          totalPrice: 10,
        },
      });
      await localPrisma.orderTicket.create({
        data: {
          id: 't1',
          orderId: 'o1',
          userId: 'u1',
          subject: 'Test Subject',
          createdAt: pastDate,
          updatedAt: pastDate,
        },
      });

      const updated = await localPrisma.orderTicket.update({
        where: { id: 't1' },
        data: {
          adminLastReadAt: new Date(),
          updatedAt: pastDate,
        },
      });

      expect(updated.updatedAt.toISOString()).toBe(pastDate.toISOString());
    } finally {
      await localPrisma.$disconnect();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
