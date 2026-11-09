import { Body, Controller, HttpCode, Inject, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/auth.metadata.js';
import { ForgotPasswordDto, TokenDto } from '../auth/dto/recovery.dto.js';
import { NewsletterService } from './newsletter.service.js';
@Public() @ApiTags('Newsletter') @Controller('store/newsletter') @Throttle({default:{limit:5,ttl:900000}})
export class NewsletterController {
  constructor(@Inject(NewsletterService) private readonly service:NewsletterService) {}
  @Post('subscribe') @HttpCode(202) subscribe(@Body() dto:ForgotPasswordDto) {return this.service.subscribe(dto.email);}
  @Post('confirm') @HttpCode(200) confirm(@Body() dto:TokenDto) {return this.service.confirm(dto.token);}
  @Post('unsubscribe') @HttpCode(200) unsubscribe(@Body() dto:TokenDto) {return this.service.unsubscribe(dto.token);}
}
