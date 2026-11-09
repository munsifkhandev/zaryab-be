import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Queue, Worker } from 'bullmq';
import { PrismaService } from '../database/prisma.service.js';
import { EmailService, type EmailMessage } from './email.service.js';
@Injectable()
export class OutboxWorker implements OnApplicationBootstrap,OnModuleDestroy {
  private readonly logger=new Logger(OutboxWorker.name);
  private queue?:Queue;private worker?:Worker;private timer?:ReturnType<typeof setInterval>;private pending?:Promise<void>;
  constructor(@Inject(PrismaService) private readonly db:PrismaService,@Inject(ConfigService) private readonly config:ConfigService,@Inject(EmailService) private readonly email:EmailService) {}
  async onApplicationBootstrap() {
    if(!this.config.get<boolean>('ASYNC_JOBS_ENABLED'))return;
    const {Queue,Worker}=await import('bullmq');
    const url=new URL(this.config.getOrThrow<string>('REDIS_URL'));
    const connection={host:url.hostname,port:Number(url.port||6379),username:url.username?decodeURIComponent(url.username):undefined,password:url.password?decodeURIComponent(url.password):undefined,db:Number(url.pathname.slice(1)||0),...(url.protocol==='rediss:'?{tls:{}}:{})};
    this.queue=new Queue('zaryab-outbox',{connection:{...connection,maxRetriesPerRequest:1,enableOfflineQueue:false},defaultJobOptions:{removeOnComplete:true,removeOnFail:1000}});
    this.worker=new Worker('zaryab-outbox',async job=>{const data:unknown=job.data;if(data&&typeof data==='object'&&'eventId' in data&&typeof data.eventId==='string')await this.process(data.eventId);},{connection:{...connection,maxRetriesPerRequest:null},concurrency:3});
    this.worker.on('error',()=>this.logger.error('Background queue connection failed.'));
    this.queue.on('error',()=>this.logger.error('Background queue connection failed.'));
    this.timer=setInterval(()=>{if(!this.pending)this.pending=this.dispatch().catch(()=>{this.logger.error('Outbox dispatch failed.');}).finally(()=>{this.pending=undefined;});},5000);this.timer.unref();
  }
  private async dispatch() {
    if(!this.email.enabled||!this.queue)return;
    const events=await this.db.outboxEvent.findMany({where:{status:{in:['PENDING','PROCESSING']},availableAt:{lte:new Date()},OR:[{eventType:'mail.send'},{eventType:{startsWith:'order.'}}]},select:{id:true,attempts:true},orderBy:[{availableAt:'asc'},{id:'asc'}],take:100});
    for(const event of events)await this.queue.add('deliver',{eventId:event.id},{jobId:`${event.id}-${event.attempts}`});
  }
  async process(id:string) {
    if(!this.email.enabled)return;
    const now=new Date();
    const claimed=await this.db.outboxEvent.updateMany({where:{id,status:{in:['PENDING','PROCESSING']},availableAt:{lte:now}},data:{status:'PROCESSING',attempts:{increment:1},availableAt:new Date(now.getTime()+60000)}});
    if(!claimed.count)return;
    const event=await this.db.outboxEvent.findUniqueOrThrow({where:{id}});
    // Resend deduplication lasts 24h. Stop before that boundary; unknown sends need manual reconciliation.
    const lease={id,status:'PROCESSING' as const,attempts:event.attempts};
    if(event.attempts>5||now.getTime()-event.createdAt.getTime()>23*3600000) {await this.db.outboxEvent.updateMany({where:lease,data:{status:'FAILED'}});return;}
    try {
      let message:EmailMessage;
      if(event.eventType==='mail.send') {
        const payload=event.payload;if(!payload||Array.isArray(payload)||typeof payload!=='object'||typeof payload.ciphertext!=='string')throw new Error();
        message=this.email.decrypt(payload.ciphertext);
      } else {
        const order=await this.db.order.findUniqueOrThrow({where:{id:event.aggregateId},select:{orderNumber:true,addresses:{where:{kind:'SHIPPING'},select:{snapshot:true}}}});
        const address=order.addresses[0]?.snapshot;if(!address||Array.isArray(address)||typeof address!=='object'||typeof address.email!=='string')throw new Error();
        message={to:address.email,subject:`Zaryab order ${order.orderNumber}`,text:`Order ${order.orderNumber}: ${event.eventType.slice(6)}.`};
      }
      await this.email.deliver(message,id);
      await this.db.outboxEvent.updateMany({where:lease,data:{status:'DELIVERED',processedAt:new Date()}});
    } catch {
      await this.db.outboxEvent.updateMany({where:lease,data:{status:event.attempts>=5?'FAILED':'PENDING',availableAt:new Date(Date.now()+Math.min(3600000,30000*2**event.attempts))}});
      this.logger.error('Outbox email delivery failed; inspect event status before replay.');
    }
  }
  async onModuleDestroy() {if(this.timer)clearInterval(this.timer);await this.pending;await this.worker?.close();await this.queue?.close();}
}
