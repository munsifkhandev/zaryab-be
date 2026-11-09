import { ConfigService } from '@nestjs/config';
import type { MockInstance } from 'vitest';
import { PrismaService } from './prisma.service.js';

describe('PrismaService lifecycle', () => {
  let service: PrismaService;
  let query: MockInstance<PrismaService['$queryRaw']>;
  beforeEach(() => {
    service = new PrismaService(
      new ConfigService({
        DATABASE_URL:
          'postgresql://localhost:5434/zaryab_ecommerce?schema=public',
      }),
    );
    query = vi.spyOn(service, '$queryRaw').mockResolvedValue([{ ok: 1 }]);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('connects at startup and disconnects at shutdown', async () => {
    const connect = vi.spyOn(service, '$connect').mockResolvedValue(undefined);
    const disconnect = vi
      .spyOn(service, '$disconnect')
      .mockResolvedValue(undefined);
    await service.onModuleInit();
    await service.onModuleDestroy();
    expect(connect).toHaveBeenCalledOnce();
    expect(query).toHaveBeenCalledOnce();
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it('cleans up a failed startup and does not expose the raw connection error', async () => {
    vi.spyOn(service, '$connect').mockRejectedValue(
      new Error('private database credentials'),
    );
    const disconnect = vi
      .spyOn(service, '$disconnect')
      .mockResolvedValue(undefined);
    await expect(service.onModuleInit()).rejects.toThrow(
      /^Database initialization failed\.$/,
    );
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it('fails startup if the lazy pool cannot execute its first query', async () => {
    vi.spyOn(service, '$connect').mockResolvedValue(undefined);
    query.mockRejectedValue(new Error('authentication failed'));
    const disconnect = vi
      .spyOn(service, '$disconnect')
      .mockResolvedValue(undefined);
    await expect(service.onModuleInit()).rejects.toThrow(
      'Database initialization failed.',
    );
    expect(disconnect).toHaveBeenCalledOnce();
  });
});
