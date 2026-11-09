import { ValidationPipe } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ArticleDto, BannerDto, HomeDto, UpdateBannerDto } from './content.dto.js';
import { ContentService } from './content.service.js';
import type { PrismaService } from '../../database/prisma.service.js';
describe('published content contracts',()=>{
  const pipe=new ValidationPipe({transform:true,whitelist:true,forbidNonWhitelisted:true,errorHttpStatusCode:422});
  it('rejects external/script banner targets and unrestricted markup fields',async()=>{
    for(const href of ['javascript:alert(1)','//evil.example/path','https://evil.example','/\\evil.example'])await expect(pipe.transform({title:'Banner',image:'https://example.com/banner.webp',href,position:0,isPublished:true},{type:'body',metatype:BannerDto})).rejects.toThrow();
    await expect(pipe.transform({sections:[],html:'<script>alert(1)</script>'},{type:'body',metatype:HomeDto})).rejects.toThrow();
  });
  it('requires concrete IDs for curated sections and preserves their order',async()=>{
    await expect(pipe.transform({sections:[{kind:'FEATURED',title:'Featured'}]},{type:'body',metatype:HomeDto})).rejects.toThrow();
    const ids=[randomUUID(),randomUUID()];const result=await pipe.transform({sections:[{kind:'FEATURED',title:'Featured',productIds:ids},{kind:'NEW_ARRIVALS',title:'New'}]},{type:'body',metatype:HomeDto});expect(result.sections[0].productIds).toEqual(ids);
  });
});

describe('content persistence field mapping',()=>{
  it('preserves article fields and dates while excluding unrelated class properties',async()=>{
    const dto=Object.assign(new ArticleDto(),{slug:'article',title:'Article',excerpt:'Excerpt',image:'https://example.com/cover.webp',paragraphs:['Text'],categoryId:null,publishedAt:'2026-11-01T00:00:00.000Z',internalFlag:true});
    const tx={blogPost:{create:vi.fn().mockResolvedValue({id:'article-id'})},auditLog:{create:vi.fn()}};
    const service=new ContentService({$transaction:(work:(client:typeof tx)=>Promise<unknown>)=>work(tx)} as unknown as PrismaService);
    await service.articleSave(dto,'actor');
    expect(tx.blogPost.create).toHaveBeenCalledWith({data:{slug:'article',title:'Article',excerpt:'Excerpt',image:'https://example.com/cover.webp',paragraphs:['Text'],categoryId:null,publishedAt:new Date(dto.publishedAt!)}});
  });
  it('preserves falsy banner updates, clears nullable dates and leaves omitted fields untouched',async()=>{
    const old={startsAt:new Date('2026-11-01T00:00:00Z'),endsAt:new Date('2026-12-01T00:00:00Z')};
    const tx={$queryRaw:vi.fn(),banner:{findUnique:vi.fn().mockResolvedValue(old),update:vi.fn().mockResolvedValue({id:'banner-id'})},auditLog:{create:vi.fn()}};
    const service=new ContentService({$transaction:(work:(client:typeof tx)=>Promise<unknown>)=>work(tx)} as unknown as PrismaService);
    await service.bannerSave(Object.assign(new UpdateBannerDto(),{position:0,isPublished:false,startsAt:null}),'actor','banner-id');
    expect(tx.banner.update).toHaveBeenCalledWith({where:{id:'banner-id'},data:{title:undefined,image:undefined,href:undefined,position:0,isPublished:false,startsAt:null,endsAt:old.endsAt}});
  });
});
