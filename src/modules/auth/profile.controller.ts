import { Body, Controller, Get, Inject, Patch } from '@nestjs/common';
import { ApiCookieAuth, ApiHeader, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service.js';
import { CurrentAuth } from './auth.metadata.js';
import type { AuthContext } from './auth.types.js';
import { UpdateProfileDto } from './dto/auth.dto.js';
import { UserProfileResponseDto } from './dto/auth-response.dto.js';

@ApiTags('Customer profile')
@ApiCookieAuth()
@Controller('customer/profile')
export class ProfileController {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  @Get()
  @ApiOkResponse({ type: UserProfileResponseDto })
  get(@CurrentAuth() auth: AuthContext) { return auth.user; }

  @Patch()
  @ApiHeader({ name: 'Origin', required: true })
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiOkResponse({ type: UserProfileResponseDto })
  update(@CurrentAuth() auth: AuthContext, @Body() dto: UpdateProfileDto) {
    return this.authService.updateProfile(auth.user.id, dto);
  }
}
