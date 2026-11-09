import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CartMergeResultDto } from '../../cart/cart-response.dto.js';

export class UserProfileResponseDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String }) firstName!: string;
  @ApiProperty({ type: String }) lastName!: string;
  @ApiProperty({ type: String, format: 'email' }) email!: string;
  @ApiProperty({ type: String, nullable: true }) phone!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) emailVerifiedAt!: string | null;
  @ApiProperty({ type: [String], example: ['CUSTOMER'] }) roles!: string[];
  @ApiProperty({ type: [String] }) permissions!: string[];
}

export class SessionResponseDto {
  @ApiProperty({ type: String }) csrfToken!: string;
  @ApiProperty({ type: String, format: 'date-time' }) expiresAt!: string;
}

export class AuthResponseDto extends SessionResponseDto {
  @ApiProperty({ type: UserProfileResponseDto }) user!: UserProfileResponseDto;
  @ApiPropertyOptional({ type: CartMergeResultDto }) cartMerge?: CartMergeResultDto;
}
