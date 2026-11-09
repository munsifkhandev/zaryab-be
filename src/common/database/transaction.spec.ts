import { ConflictException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import type { PrismaService } from '../../database/prisma.service.js';
import { transaction } from './transaction.js';

it('bounds retries for database-confirmed transaction conflicts', async () => {
  const failure = new Prisma.PrismaClientKnownRequestError('transaction conflict', { code: 'P2034', clientVersion: '7' });
  const run = vi.fn().mockRejectedValue(failure);
  await expect(transaction({ $transaction: run } as unknown as PrismaService, async () => 1)).rejects.toBeInstanceOf(ConflictException);
  expect(run).toHaveBeenCalledTimes(3);
});

it('does not replay mutations when the connection outcome is unknown', async () => {
  const failure = new Prisma.PrismaClientKnownRequestError('connection lost', { code: 'P1017', clientVersion: '7' });
  const run = vi.fn().mockRejectedValue(failure);
  await expect(transaction({ $transaction: run } as unknown as PrismaService, async () => 1)).rejects.toBe(failure);
  expect(run).toHaveBeenCalledOnce();
});
