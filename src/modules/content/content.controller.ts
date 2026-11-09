import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { CurrentAuth, Permissions, Public } from '../auth/auth.metadata.js';
import type { AuthContext } from '../auth/auth.types.js';
import { CategoryDto, PageQueryDto, SlugParamDto } from '../catalog/catalog.dto.js';
import { ArticleDto, BannerDto, HomeDto, PageDto, UpdateArticleDto, UpdateBannerDto, UpdatePageDto } from './content.dto.js';
import { ContentService } from './content.service.js';
const uuid=new ParseUUIDPipe({version:'4'});
@ApiTags('Store content') @Public() @Controller()
export class StoreContentController {
  constructor(@Inject(ContentService) private readonly service:ContentService) {}
  @Get(['articles','store/articles']) articles(@Query() q:PageQueryDto) {return this.service.articles(q);}
  @Get(['articles/:slug','store/articles/:slug']) article(@Param() p:SlugParamDto) {return this.service.article(p.slug);}
  @Get('store/pages/:slug') page(@Param() p:SlugParamDto) {return this.service.page(p.slug);}
  @Get('store/banners') banners() {return this.service.banners();}
  @Get('store/home') home() {return this.service.home();}
  @Get('store/blog-categories') categories() {return this.service.categories();}
}
@ApiCookieAuth() @ApiTags('Content administration') @Permissions('cms.manage') @Controller('admin')
export class AdminContentController {
  constructor(@Inject(ContentService) private readonly service:ContentService) {}
  @Get('pages') pages(@Query() q:PageQueryDto) {return this.service.pages(q);}
  @Post('pages') page(@Body() d:PageDto,@CurrentAuth() a:AuthContext) {return this.service.pageSave(d,a.user.id);}
  @Patch('pages/:id') pageUpdate(@Param('id',uuid) id:string,@Body() d:UpdatePageDto,@CurrentAuth() a:AuthContext) {return this.service.pageSave(d,a.user.id,id);}
  @Get('articles') articles(@Query() q:PageQueryDto) {return this.service.adminArticles(q);}
  @Post('articles') article(@Body() d:ArticleDto,@CurrentAuth() a:AuthContext) {return this.service.articleSave(d,a.user.id);}
  @Patch('articles/:id') articleUpdate(@Param('id',uuid) id:string,@Body() d:UpdateArticleDto,@CurrentAuth() a:AuthContext) {return this.service.articleSave(d,a.user.id,id);}
  @Get('banners') banners(@Query() q:PageQueryDto) {return this.service.adminBanners(q);}
  @Post('banners') banner(@Body() d:BannerDto,@CurrentAuth() a:AuthContext) {return this.service.bannerSave(d,a.user.id);}
  @Patch('banners/:id') bannerUpdate(@Param('id',uuid) id:string,@Body() d:UpdateBannerDto,@CurrentAuth() a:AuthContext) {return this.service.bannerSave(d,a.user.id,id);}
  @Post('blog-categories') category(@Body() d:CategoryDto,@CurrentAuth() a:AuthContext) {return this.service.category(d,a.user.id);}
  @Get('home') home() {return this.service.home();}
  @Put('home') homeSave(@Body() d:HomeDto,@CurrentAuth() a:AuthContext) {return this.service.homeSave(d,a.user.id);}
}
