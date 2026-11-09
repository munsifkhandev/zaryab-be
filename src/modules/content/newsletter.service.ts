import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { transaction } from '../../common/database/transaction.js';
import { EmailService } from '../../infrastructure/email.service.js';
import { newSessionToken, tokenHash } from '../auth/auth.tokens.js';
@Injectable()
export class NewsletterService {
  constructor(@Inject(PrismaService) private readonly db:PrismaService,@Inject(EmailService) private readonly mail:EmailService) {}
  subscribe(email:string) {
    this.mail.requireEnabled();return transaction(this.db,async tx=>{
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`newsletter:${email}`},0))`;
      const old=await tx.newsletterSubscriber.findUnique({where:{email}});const now=new Date();
      if(old?.status==='CONFIRMED'||(old?.status==='PENDING'&&old.expiresAt&&old.expiresAt.getTime()>now.getTime()+29*60000))return {accepted:true};
      const token=newSessionToken();const data={status:'PENDING',tokenHash:tokenHash(token),expiresAt:new Date(now.getTime()+1800000)};
      const subscriber=await tx.newsletterSubscriber.upsert({where:{email},create:{email,...data},update:data});
      await this.mail.enqueue(tx,subscriber.id,{to:email,subject:'Confirm your Zaryab subscription',text:`Confirm within 30 minutes: ${this.mail.link('/newsletter/confirm',token)}`});return {accepted:true};
    });
  }
  confirm(token:string) {
    this.mail.requireEnabled();return transaction(this.db,async tx=>{
      const old=await tx.newsletterSubscriber.findUnique({where:{tokenHash:tokenHash(token)}});if(!old)throw new BadRequestException();
      const unsubscribe=newSessionToken();
      const changed=await tx.newsletterSubscriber.updateMany({where:{id:old.id,tokenHash:tokenHash(token),status:'PENDING',expiresAt:{gt:new Date()}},data:{status:'CONFIRMED',tokenHash:tokenHash(unsubscribe),expiresAt:null}});
      if(!changed.count)throw new BadRequestException();
      await this.mail.enqueue(tx,old.id,{to:old.email,subject:'Your Zaryab subscription is confirmed',text:`You subscribed to Zaryab updates. Unsubscribe: ${this.mail.link('/newsletter/unsubscribe',unsubscribe)}`});return {subscribed:true};
    });
  }
  async unsubscribe(token:string) {
    await this.db.newsletterSubscriber.updateMany({where:{tokenHash:tokenHash(token),status:'CONFIRMED'},data:{status:'UNSUBSCRIBED',tokenHash:null,expiresAt:null}});return {unsubscribed:true};
  }
}
