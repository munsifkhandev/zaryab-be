import { Test } from '@nestjs/testing';
import { ServiceUnavailableException } from '@nestjs/common';
import { DatabaseHealthController } from './database-health.controller.js';
import { PrismaService } from '../database/prisma.service.js';

describe('DatabaseHealthController', () => {
  const query = vi.fn();
  let controller: DatabaseHealthController;

  beforeEach(async () => {
    query.mockReset();
    const module = await Test.createTestingModule({
      controllers: [DatabaseHealthController],
      providers: [{ provide: PrismaService, useValue: { $queryRaw: query } }],
    }).compile();
    controller = module.get(DatabaseHealthController);
  });

  it('runs a real health query rather than returning a constant success', async () => {
    query.mockResolvedValue([{ ok: 1 }]);
    expect(await controller.check()).toEqual({
      status: 'ok',
      database: 'connected',
    });
    expect(query).toHaveBeenCalledOnce();
    expect(query.mock.calls[0][0][0]).toContain('SELECT 1');
  });

  it('returns 503 without exposing database errors or connection strings', async () => {
    query.mockRejectedValue(
      new Error('postgresql://private:secret@internal/db'),
    );
    try {
      await controller.check();
      expect.fail('Expected a database failure');
    } catch (error) {
      expect(error).toBeInstanceOf(ServiceUnavailableException);
      const failure = error as ServiceUnavailableException;
      expect(failure.getStatus()).toBe(503);
      expect(failure.getResponse()).toEqual({
        status: 'error',
        database: 'disconnected',
      });
      expect(JSON.stringify(failure.getResponse())).not.toContain('secret');
    }
  });

  it('does not report an empty query result as healthy', async () => {
    query.mockResolvedValue([]);
    await expect(controller.check()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('keeps liveness independent of the database', () => {
    expect(controller.live()).toEqual({ status: 'ok' });
    expect(query).not.toHaveBeenCalled();
  });

  it('checks the database before reporting readiness', async () => {
    query.mockResolvedValue([{ ok: 1 }]);
    expect(await controller.ready()).toEqual({ status: 'ok' });
    expect(query).toHaveBeenCalledOnce();
    query.mockRejectedValue(new Error('private failure'));
    await expect(controller.ready()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
