import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, Min, NotEquals } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PageQueryDto } from '../catalog/catalog.dto.js';

export class InventoryQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ type: String, format: 'uuid' }) @IsOptional() @IsUUID('4')
  variantId?: string;
  @ApiPropertyOptional({ type: String, format: 'uuid' }) @IsOptional() @IsUUID('4')
  locationId?: string;
}

export class AdjustmentDto {
  @ApiProperty({ type: String, format: 'uuid' }) @IsUUID('4') variantId!: string;
  @ApiProperty({ type: String, format: 'uuid' }) @IsUUID('4') locationId!: string;
  @ApiProperty({ type: Number, minimum: -1000000000, maximum: 1000000000 })
  @IsInt() @Min(-1000000000) @Max(1000000000) @NotEquals(0) delta!: number;
  @ApiProperty({ type: String, maxLength: 500 })
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  @IsString() @Length(5, 500) reason!: string;
  @ApiPropertyOptional({ enum: ['ADJUSTMENT', 'RETURN'], default: 'ADJUSTMENT' })
  @IsIn(['ADJUSTMENT', 'RETURN']) type: 'ADJUSTMENT' | 'RETURN' = 'ADJUSTMENT';
}

export class ReservationDto {
  @ApiProperty({ type: String, format: 'uuid' }) @IsUUID('4') variantId!: string;
  @ApiProperty({ type: String, format: 'uuid' }) @IsUUID('4') locationId!: string;
  @ApiProperty({ type: Number, maximum: 10000 }) @IsInt() @Min(1) @Max(10000) quantity!: number;
  @ApiPropertyOptional({ type: Number, default: 900, minimum: 60, maximum: 3600 })
  @IsInt() @Min(60) @Max(3600) ttlSeconds = 900;
  @ApiProperty({ type: String, maxLength: 500 })
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  @IsString() @Length(5, 500) reason!: string;
}

export class ThresholdDto {
  @ApiProperty({ type: Number }) @IsInt() @Min(0) @Max(1000000000) lowStockThreshold!: number;
}

export class InventoryLocationDto {
  @ApiProperty({ type: String, maxLength: 50 }) @IsString() @Matches(/^[A-Z0-9][A-Z0-9_-]{0,49}$/) code!: string;
  @ApiProperty({ type: String, maxLength: 100 })
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  @IsString() @Length(1, 100) name!: string;
}

export class ExpiryBatchDto {
  @ApiPropertyOptional({ type: Number, default: 100, maximum: 100 })
  @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 100;
}

export class LocationStatusDto {
  @ApiProperty({ type: Boolean }) @IsBoolean() isActive!: boolean;
}

export class ReservationQueryDto extends InventoryQueryDto {
  @ApiPropertyOptional({ enum: ['ACTIVE', 'COMMITTED', 'RELEASED', 'EXPIRED'] })
  @IsOptional() @IsIn(['ACTIVE', 'COMMITTED', 'RELEASED', 'EXPIRED'])
  status?: 'ACTIVE' | 'COMMITTED' | 'RELEASED' | 'EXPIRED';
}
