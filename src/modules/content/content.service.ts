import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { transaction } from '../../common/database/transaction.js';
import type { PageQueryDto, CategoryDto } from '../catalog/catalog.dto.js';
import type { ArticleDto, BannerDto, HomeDto, PageDto, UpdateArticleDto, UpdateBannerDto, UpdatePageDto } from './content.dto.js';
import { ProductQueryDto } from '../catalog/catalog.dto.js';
import { publicProductSql } from '../catalog/catalog.policy.js';

const articleSelect={slug:true,title:true,excerpt:true,image:true,paragraphs:true,publishedAt:true} satisfies Prisma.BlogPostSelect;
export function articleResponse(p:Prisma.BlogPostGetPayload<{select:typeof articleSelect}>) {return {slug:p.slug,title:p.title,excerpt:p.excerpt,image:p.image,paragraphs:p.paragraphs,date:p.publishedAt!.toISOString().slice(0,10)};}

@Injectable()
export class ContentService {
  constructor(@Inject(PrismaService) private readonly db:PrismaService) {}
  private audit(tx:Prisma.TransactionClient,actorId:string,action:string,id:string) {return tx.auditLog.create({data:{actorId,action,entityType:'content',entityId:id}});}
  async articles(q:PageQueryDto) {return (await this.db.blogPost.findMany({where:{publishedAt:{lte:new Date()}},select:articleSelect,orderBy:[{publishedAt:'desc'},{id:'asc'}],take:q.limit,skip:(q.page-1)*q.limit})).map(articleResponse);}
  async article(slug:string) {const p=await this.db.blogPost.findFirst({where:{slug,publishedAt:{lte:new Date()}},select:articleSelect});if(!p)throw new NotFoundException();return articleResponse(p);}
  async page(slug:string) {const p=await this.db.page.findFirst({where:{slug,isPublished:true},select:{slug:true,title:true,paragraphs:true,updatedAt:true}});if(!p)throw new NotFoundException();return p;}
  banners() {const now=new Date();return this.db.banner.findMany({where:{isPublished:true,AND:[{OR:[{startsAt:null},{startsAt:{lte:now}}]},{OR:[{endsAt:null},{endsAt:{gt:now}}]}]},select:{id:true,title:true,image:true,href:true,position:true},orderBy:[{position:'asc'},{id:'asc'}],take:30});}
  async home() {return (await this.db.storeContent.findUnique({where:{key:'home'}}))?.value??{sections:[]};}
  pages(q:PageQueryDto) {return this.db.page.findMany({orderBy:{id:'asc'},take:q.limit,skip:(q.page-1)*q.limit});}
  adminArticles(q:PageQueryDto) {return this.db.blogPost.findMany({orderBy:[{createdAt:'desc'},{id:'asc'}],take:q.limit,skip:(q.page-1)*q.limit});}
  adminBanners(q:PageQueryDto) {return this.db.banner.findMany({orderBy:[{position:'asc'},{id:'asc'}],take:q.limit,skip:(q.page-1)*q.limit});}
  categories() {return this.db.blogCategory.findMany({orderBy:{name:'asc'},take:120});}
  category(dto:CategoryDto,actorId:string) {return transaction(this.db,async tx=>{const value=await tx.blogCategory.create({data:dto});await this.audit(tx,actorId,'blog.category_create',value.id);return value;});}
  pageSave(dto:PageDto|UpdatePageDto,actorId:string,id?:string) {return transaction(this.db,async tx=>{
    const value=id?await tx.page.update({where:{id},data:dto}):await tx.page.create({data:dto as PageDto});
    await this.audit(tx,actorId,'page.save',value.id);return value;
  });}
  articleSave(dto:ArticleDto|UpdateArticleDto,actorId:string,id?:string) {return transaction(this.db,async tx=>{
    const data={slug:dto.slug,title:dto.title,excerpt:dto.excerpt,image:dto.image,paragraphs:dto.paragraphs,categoryId:dto.categoryId,publishedAt:dto.publishedAt===undefined?undefined:dto.publishedAt?new Date(dto.publishedAt):null};
    const create=dto as ArticleDto;
    const value=id?await tx.blogPost.update({where:{id},data}):await tx.blogPost.create({data:{slug:create.slug,title:create.title,excerpt:create.excerpt,image:create.image,paragraphs:create.paragraphs,categoryId:create.categoryId,publishedAt:data.publishedAt}});
    await this.audit(tx,actorId,'article.save',value.id);return value;
  });}
  bannerSave(dto:BannerDto|UpdateBannerDto,actorId:string,id?:string) {return transaction(this.db,async tx=>{
    if(id)await tx.$queryRaw`SELECT id FROM banners WHERE id=${id}::uuid FOR UPDATE`;
    const prior=id?await tx.banner.findUnique({where:{id}}):null;if(id&&!prior)throw new NotFoundException();
    const startsAt=dto.startsAt===undefined?prior?.startsAt??null:dto.startsAt?new Date(dto.startsAt):null;
    const endsAt=dto.endsAt===undefined?prior?.endsAt??null:dto.endsAt?new Date(dto.endsAt):null;
    if(startsAt&&endsAt&&startsAt>=endsAt)throw new BadRequestException();
    const data={title:dto.title,image:dto.image,href:dto.href,position:dto.position,isPublished:dto.isPublished,startsAt,endsAt};
    const create=dto as BannerDto;
    const value=id?await tx.banner.update({where:{id},data}):await tx.banner.create({data:{title:create.title,image:create.image,href:create.href,position:create.position,isPublished:create.isPublished,startsAt,endsAt}});
    await this.audit(tx,actorId,'banner.save',value.id);return value;
  });}
  homeSave(dto:HomeDto,actorId:string) {return transaction(this.db,async tx=>{
    const ids=dto.sections.flatMap(s=>s.kind==='COLLECTION'&&s.collectionId?[s.collectionId]:[]);
    if(await tx.collection.count({where:{id:{in:[...new Set(ids)]},isPublished:true}})!==new Set(ids).size)throw new BadRequestException();
    const productIds=[...new Set(dto.sections.flatMap(s=>s.productIds??[]))];
    if(productIds.length) {
      const found=await tx.$queryRaw<{id:string}[]>`SELECT id FROM (${publicProductSql(new ProductQueryDto())}) q WHERE id IN (${Prisma.join(productIds.map(id=>Prisma.sql`${id}::uuid`))})`;
      if(found.length!==productIds.length)throw new BadRequestException();
    }
    if(dto.heroBannerIds?.length&&await tx.banner.count({where:{id:{in:dto.heroBannerIds},isPublished:true}})!==dto.heroBannerIds.length)throw new BadRequestException();
    if(dto.countdown&&new Date(dto.countdown.startsAt)>=new Date(dto.countdown.endsAt))throw new BadRequestException();
    const value=await tx.storeContent.upsert({where:{key:'home'},create:{key:'home',value:JSON.parse(JSON.stringify(dto)) as Prisma.InputJsonValue},update:{value:JSON.parse(JSON.stringify(dto)) as Prisma.InputJsonValue}});
    await this.audit(tx,actorId,'home.save','home');return value.value;
  });}
}
