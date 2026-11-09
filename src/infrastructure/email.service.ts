import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { Prisma } from '../generated/prisma/client.js';
export type EmailMessage={to:string;subject:string;text:string};
export function sealEmail(message:EmailMessage,key:string):string {
  const nonce=randomBytes(12);const cipher=createCipheriv('aes-256-gcm',Buffer.from(key,'hex'),nonce);
  const encrypted=Buffer.concat([cipher.update(JSON.stringify(message),'utf8'),cipher.final()]);
  return Buffer.concat([nonce,cipher.getAuthTag(),encrypted]).toString('base64');
}
export function openEmail(value:string,key:string):EmailMessage {
  const bytes=Buffer.from(value,'base64');const decipher=createDecipheriv('aes-256-gcm',Buffer.from(key,'hex'),bytes.subarray(0,12));
  decipher.setAuthTag(bytes.subarray(12,28));
  const message:unknown=JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)),decipher.final()]).toString('utf8'));
  if(!message||typeof message!=='object'||!('to' in message)||typeof message.to!=='string'||!('subject' in message)||typeof message.subject!=='string'||!('text' in message)||typeof message.text!=='string')throw new Error('Invalid stored email.');
  return {to:message.to,subject:message.subject,text:message.text};
}
@Injectable()
export class EmailService {
  constructor(@Inject(ConfigService) private readonly config:ConfigService) {}
  get enabled() {return this.config.get<string>('EMAIL_PROVIDER')==='resend';}
  requireEnabled() {if(!this.enabled)throw new ServiceUnavailableException();}
  link(path:string,token:string) {return `${this.config.getOrThrow<string>('STOREFRONT_URL')}${path}#token=${encodeURIComponent(token)}`;}
  enqueue(tx:Prisma.TransactionClient,aggregateId:string,message:EmailMessage) {
    this.requireEnabled();return tx.outboxEvent.create({data:{eventType:'mail.send',aggregateId,payload:{ciphertext:sealEmail(message,this.config.getOrThrow<string>('EMAIL_ENCRYPTION_KEY'))}}});
  }
  async deliver(message:EmailMessage,eventId:string) {
    this.requireEnabled();
    try {
      const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${this.config.getOrThrow<string>('RESEND_API_KEY')}`,'Content-Type':'application/json','Idempotency-Key':`outbox-${eventId}`},body:JSON.stringify({from:this.config.getOrThrow<string>('EMAIL_FROM'),to:[message.to],subject:message.subject,text:message.text}),signal:AbortSignal.timeout(10000),redirect:'error'});
      if(!response.ok) {await response.body?.cancel();throw new Error();}
      const value:unknown=await response.json();
      if(!value||typeof value!=='object'||!('id' in value)||typeof value.id!=='string'||!value.id)throw new Error();
    } catch {throw new Error('Email delivery did not return a confirmed provider response.');}
  }
  decrypt(value:string) {return openEmail(value,this.config.getOrThrow<string>('EMAIL_ENCRYPTION_KEY'));}
}
