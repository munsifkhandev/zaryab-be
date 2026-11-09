import { Body, Controller, Header, HttpCode, Inject, Post, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentAuth, Public } from './auth.metadata.js';
import type { AuthContext } from './auth.types.js';
import { AuthService } from './auth.service.js';
import { RecoveryService } from './recovery.service.js';
import { ChangePasswordDto, ForgotPasswordDto, ResetPasswordDto, TokenDto } from './dto/recovery.dto.js';
@ApiTags('Account recovery') @Controller('auth') @Throttle({default:{limit:5,ttl:900000}})
export class RecoveryController {
  constructor(@Inject(RecoveryService) private readonly recovery:RecoveryService,@Inject(AuthService) private readonly auth:AuthService) {}
  @Public() @Post('forgot-password') @HttpCode(202) @Header('Cache-Control','no-store') request(@Body() dto:ForgotPasswordDto) {return this.recovery.request(dto.email);}
  @Public() @Post('reset-password') @HttpCode(200) reset(@Body() dto:ResetPasswordDto) {return this.recovery.reset(dto);}
  @Post('change-password') @HttpCode(200) async change(@CurrentAuth() a:AuthContext,@Body() dto:ChangePasswordDto,@Res({passthrough:true}) res:Response) {const result=await this.recovery.change(a.user.id,dto);this.auth.clearCookie(res);return result;}
  @Post('verification-email') @HttpCode(202) verification(@CurrentAuth() a:AuthContext) {return this.recovery.verification(a.user.id);}
  @Public() @Post('verify-email') @HttpCode(200) verify(@Body() dto:TokenDto) {return this.recovery.verify(dto.token);}
}
