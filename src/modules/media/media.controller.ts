import { Controller, Get, Inject, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentAuth, Permissions } from '../auth/auth.metadata.js';
import type { AuthContext } from '../auth/auth.types.js';
import { PageQueryDto } from '../catalog/catalog.dto.js';
import { MediaService, type UploadedImage } from './media.service.js';
@ApiTags('Media') @ApiCookieAuth() @Permissions('products.update') @Controller('admin/media')
export class MediaController {
  constructor(@Inject(MediaService) private readonly service:MediaService) {}
  @Get() list(@Query() q:PageQueryDto) {return this.service.list(q);}
  @Post() @Throttle({default:{limit:10,ttl:60000}}) @UseInterceptors(FileInterceptor('file',{limits:{fileSize:5242880,files:1,fields:0,parts:1}}))
  @ApiConsumes('multipart/form-data') @ApiBody({schema:{type:'object',required:['file'],properties:{file:{type:'string',format:'binary'}}}})
  upload(@UploadedFile() file:UploadedImage,@CurrentAuth() a:AuthContext) {return this.service.upload(file,a.user.id);}
  @Post('cleanup-pending') cleanup(@CurrentAuth() a:AuthContext) {return this.service.cleanupPending(a.user.id);}
}
