import { ConfigService } from '@nestjs/config';
import { OutboxWorker } from './outbox.worker.js';
import type { EmailService } from './email.service.js';
import type { PrismaService } from '../database/prisma.service.js';
describe('outbox delivery lifecycle',()=>{
  function fixture(age=0,attempts=1) {
    const event={id:'event',eventType:'mail.send',payload:{ciphertext:'encrypted'},attempts,createdAt:new Date(Date.now()-age)};
    const events={updateMany:vi.fn().mockResolvedValue({count:1}),findUniqueOrThrow:vi.fn().mockResolvedValue(event)};
    const email={enabled:true,decrypt:vi.fn().mockReturnValue({to:'test@example.com',subject:'Test',text:'Test'}),deliver:vi.fn().mockResolvedValue(undefined)};
    return {events,email,worker:new OutboxWorker({outboxEvent:events} as unknown as PrismaService,new ConfigService({}),email as unknown as EmailService)};
  }
  it('records confirmed delivery and skips a concurrently claimed event',async()=>{
    const f=fixture();await f.worker.process('event');expect(f.events.updateMany).toHaveBeenCalledWith({where:{id:'event',status:'PROCESSING',attempts:1},data:{status:'DELIVERED',processedAt:expect.any(Date)}});
    f.events.updateMany.mockResolvedValue({count:0});await f.worker.process('event');expect(f.email.deliver).toHaveBeenCalledTimes(1);
  });
  it('does not replay unknown outcomes beyond the provider deduplication window',async()=>{
    const f=fixture(24*3600000);await f.worker.process('event');expect(f.email.deliver).not.toHaveBeenCalled();expect(f.events.updateMany).toHaveBeenCalledWith({where:{id:'event',status:'PROCESSING',attempts:1},data:{status:'FAILED'}});
  });
  it('stops retrying after the bounded attempt budget',async()=>{
    const f=fixture(0,5);f.email.deliver.mockRejectedValue(new Error('provider secret'));
    await f.worker.process('event');expect(f.events.updateMany).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({status:'FAILED'})}));
  });
});
