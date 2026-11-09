import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import type { PrismaService } from '../../database/prisma.service.js';

export async function transaction<T>(database: PrismaService, work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await database.$transaction(work, { timeout: 15000, maxWait: 5000 }); }
    catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        const retryable = error.code === 'P2034' ||
          (error.code === 'P2010' && ['40001', '40P01'].includes(String(error.meta?.code)));
        if (retryable && attempt < 2) continue;
        if (retryable || error.code === 'P2002') throw new ConflictException();
        if (['P2003', 'P2025'].includes(error.code)) throw new BadRequestException();
      }
      throw error;
    }
  }
}
