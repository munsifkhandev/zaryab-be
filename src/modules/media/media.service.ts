import { BadRequestException, Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service.js';
import { transaction } from '../../common/database/transaction.js';
import type { PageQueryDto } from '../catalog/catalog.dto.js';
import type { S3Client } from '@aws-sdk/client-s3';
export type UploadedImage={buffer:Buffer;mimetype:string;size:number};
export async function verifyImage(file:UploadedImage) {
  const formats:Record<string,string>={'image/jpeg':'jpeg','image/png':'png','image/webp':'webp'};
  if(!formats[file.mimetype]||!file.buffer?.length||file.buffer.length>5242880)throw new BadRequestException();
  const {default:sharp}=await import('sharp');
  try {
    const image=sharp(file.buffer,{limitInputPixels:20000000,failOn:'warning',animated:false});
    const metadata=await image.metadata();
    if(metadata.format!==formats[file.mimetype]||(metadata.pages??1)>1||!metadata.width||!metadata.height)throw new Error();
    const {data,info}=await image.rotate().resize({width:2500,height:2500,fit:'inside',withoutEnlargement:true}).webp({quality:85}).toBuffer({resolveWithObject:true});
    if(data.length>5242880)throw new Error();return {data,width:info.width,height:info.height};
  } catch {throw new BadRequestException();}
}
@Injectable()
export class MediaService {
  private client?:S3Client;
  constructor(@Inject(PrismaService) private readonly db:PrismaService,@Inject(ConfigService) private readonly config:ConfigService) {}
  private requireEnabled() {if(this.config.get<string>('STORAGE_PROVIDER')!=='s3')throw new ServiceUnavailableException();}
  private async storage() {
    this.requireEnabled();if(!this.client) {const {S3Client}=await import('@aws-sdk/client-s3');this.client=new S3Client({region:this.config.getOrThrow<string>('S3_REGION'),endpoint:this.config.get<string>('S3_ENDPOINT')||undefined,forcePathStyle:this.config.get<boolean>('S3_FORCE_PATH_STYLE')??false,credentials:{accessKeyId:this.config.getOrThrow<string>('S3_ACCESS_KEY_ID'),secretAccessKey:this.config.getOrThrow<string>('S3_SECRET_ACCESS_KEY')},maxAttempts:2});}return this.client;
  }
  list(q:PageQueryDto) {return this.db.mediaAsset.findMany({where:{status:'READY'},orderBy:[{createdAt:'desc'},{id:'asc'}],take:q.limit,skip:(q.page-1)*q.limit});}
  async upload(file:UploadedImage,actorId:string) {
    this.requireEnabled();if(!file)throw new BadRequestException();const image=await verifyImage(file);const objectKey=`images/${randomUUID()}.webp`;
    const url=`${this.config.getOrThrow<string>('MEDIA_PUBLIC_URL')}/${objectKey}`;
    const asset=await this.db.mediaAsset.create({data:{objectKey,url,width:image.width,height:image.height,bytes:image.data.length}});
    try {
      const {PutObjectCommand}=await import('@aws-sdk/client-s3');
      await (await this.storage()).send(new PutObjectCommand({Bucket:this.config.getOrThrow<string>('S3_BUCKET'),Key:objectKey,Body:image.data,ContentType:'image/webp',CacheControl:'public, max-age=31536000, immutable'}),{abortSignal:AbortSignal.timeout(15000)});
      return await transaction(this.db,async tx=>{
        const ready=await tx.mediaAsset.update({where:{id:asset.id},data:{status:'READY'}});
        await tx.auditLog.create({data:{actorId,action:'media.upload',entityType:'media_asset',entityId:asset.id}});return ready;
      });
    } catch {throw new ServiceUnavailableException();}
  }
  async cleanupPending(actorId:string) {
    this.requireEnabled();const assets=await this.db.mediaAsset.findMany({where:{status:'PENDING',createdAt:{lt:new Date(Date.now()-3600000)}},take:100,orderBy:{createdAt:'asc'}});
    const {DeleteObjectCommand}=await import('@aws-sdk/client-s3');let removed=0;
    for(const asset of assets) {
      try {await (await this.storage()).send(new DeleteObjectCommand({Bucket:this.config.getOrThrow<string>('S3_BUCKET'),Key:asset.objectKey}),{abortSignal:AbortSignal.timeout(10000)});}
      catch {throw new ServiceUnavailableException();}
      await transaction(this.db,async tx=>{await tx.mediaAsset.update({where:{id:asset.id},data:{status:'ARCHIVED'}});await tx.auditLog.create({data:{actorId,action:'media.cleanup',entityType:'media_asset',entityId:asset.id}});});removed++;
    }return {removed};
  }
  onModuleDestroy() {this.client?.destroy();}
}
