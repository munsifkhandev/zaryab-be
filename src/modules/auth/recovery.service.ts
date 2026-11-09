import { BadRequestException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { argon2id, hash, verify } from 'argon2';
import { PrismaService } from '../../database/prisma.service.js';
import { transaction } from '../../common/database/transaction.js';
import { EmailService } from '../../infrastructure/email.service.js';
import { newSessionToken, tokenHash } from './auth.tokens.js';
import type { ChangePasswordDto, ResetPasswordDto } from './dto/recovery.dto.js';
const options={type:argon2id,memoryCost:65536,timeCost:3,parallelism:1} as const;
@Injectable()
export class RecoveryService {
  constructor(@Inject(PrismaService) private readonly db:PrismaService,@Inject(EmailService) private readonly mail:EmailService) {}
  request(email:string) {
    this.mail.requireEnabled();return transaction(this.db,async tx=>{
      const user=await tx.user.findUnique({where:{email},select:{id:true,status:true}});
      if(!user||user.status!=='ACTIVE')return {accepted:true};
      await tx.$queryRaw`SELECT id FROM users WHERE id=${user.id}::uuid FOR UPDATE`;
      const now=new Date();
      if(await tx.passwordResetToken.count({where:{userId:user.id,createdAt:{gt:new Date(now.getTime()-60000)}}}))return {accepted:true};
      const token=newSessionToken();
      await tx.passwordResetToken.updateMany({where:{userId:user.id,usedAt:null},data:{usedAt:now}});
      await tx.passwordResetToken.create({data:{userId:user.id,tokenHash:tokenHash(token),expiresAt:new Date(now.getTime()+1800000)}});
      await this.mail.enqueue(tx,user.id,{to:email,subject:'Reset your Zaryab password',text:`Reset your password within 30 minutes: ${this.mail.link('/reset-password',token)}`});
      return {accepted:true};
    });
  }
  async reset(dto:ResetPasswordDto) {
    const passwordHash=await hash(dto.password,options);
    return transaction(this.db,async tx=>{
      const record=await tx.passwordResetToken.findUnique({where:{tokenHash:tokenHash(dto.token)}});
      if(!record)throw new BadRequestException();
      await tx.$queryRaw`SELECT id FROM users WHERE id=${record.userId}::uuid FOR UPDATE`;
      const user=await tx.user.findUnique({where:{id:record.userId},select:{status:true}});
      const now=new Date();
      if(user?.status!=='ACTIVE'||!(await tx.passwordResetToken.updateMany({where:{id:record.id,usedAt:null,expiresAt:{gt:now}},data:{usedAt:now}})).count)throw new BadRequestException();
      await tx.user.update({where:{id:record.userId},data:{passwordHash}});
      await tx.session.updateMany({where:{userId:record.userId,revokedAt:null},data:{revokedAt:now}});
      await tx.passwordResetToken.updateMany({where:{userId:record.userId,usedAt:null},data:{usedAt:now}});
      await tx.auditLog.create({data:{actorId:record.userId,action:'auth.password_reset',entityType:'user',entityId:record.userId}});return {changed:true};
    });
  }
  async change(userId:string,dto:ChangePasswordDto) {
    const user=await this.db.user.findUnique({where:{id:userId},select:{passwordHash:true,status:true}});
    if(!user||user.status!=='ACTIVE'||!await verify(user.passwordHash,dto.currentPassword).catch(()=>false))throw new UnauthorizedException();
    const passwordHash=await hash(dto.password,options);
    return transaction(this.db,async tx=>{
      await tx.$queryRaw`SELECT id FROM users WHERE id=${userId}::uuid FOR UPDATE`;
      if(!(await tx.user.updateMany({where:{id:userId,status:'ACTIVE',passwordHash:user.passwordHash},data:{passwordHash}})).count)throw new UnauthorizedException();
      const now=new Date();await tx.session.updateMany({where:{userId,revokedAt:null},data:{revokedAt:now}});
      await tx.passwordResetToken.updateMany({where:{userId,usedAt:null},data:{usedAt:now}});
      await tx.auditLog.create({data:{actorId:userId,action:'auth.password_change',entityType:'user',entityId:userId}});return {changed:true,requiresLogin:true};
    });
  }
  verification(userId:string) {
    this.mail.requireEnabled();return transaction(this.db,async tx=>{
      await tx.$queryRaw`SELECT id FROM users WHERE id=${userId}::uuid FOR UPDATE`;
      const user=await tx.user.findUniqueOrThrow({where:{id:userId}});const now=new Date();
      if(user.status!=='ACTIVE')throw new UnauthorizedException();
      if(user.emailVerifiedAt||await tx.emailVerificationToken.count({where:{userId,createdAt:{gt:new Date(now.getTime()-60000)}}}))return {accepted:true};
      await tx.emailVerificationToken.updateMany({where:{userId,usedAt:null},data:{usedAt:now}});const token=newSessionToken();
      await tx.emailVerificationToken.create({data:{userId,tokenHash:tokenHash(token),expiresAt:new Date(now.getTime()+86400000)}});
      await this.mail.enqueue(tx,userId,{to:user.email,subject:'Verify your Zaryab email',text:`Verify your email within 24 hours: ${this.mail.link('/verify-email',token)}`});return {accepted:true};
    });
  }
  verify(token:string) {return transaction(this.db,async tx=>{
    const record=await tx.emailVerificationToken.findUnique({where:{tokenHash:tokenHash(token)}});if(!record)throw new BadRequestException();
    await tx.$queryRaw`SELECT id FROM users WHERE id=${record.userId}::uuid FOR UPDATE`;
    const now=new Date();const user=await tx.user.findUnique({where:{id:record.userId},select:{status:true}});
    if(user?.status!=='ACTIVE'||!(await tx.emailVerificationToken.updateMany({where:{id:record.id,usedAt:null,expiresAt:{gt:now}},data:{usedAt:now}})).count)throw new BadRequestException();
    await tx.user.update({where:{id:record.userId},data:{emailVerifiedAt:now}});
    await tx.emailVerificationToken.updateMany({where:{userId:record.userId,usedAt:null},data:{usedAt:now}});return {verified:true};
  });}
}
