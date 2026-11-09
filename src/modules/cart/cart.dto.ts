import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsUUID, Max, Min } from 'class-validator';

export class CartQuantityDto {
  @ApiProperty({ type: Number, minimum: 1, maximum: 99 })
  @IsInt() @Min(1) @Max(99) quantity!: number;
}

export class AddCartItemDto extends CartQuantityDto {
  @ApiProperty({ type: String, format: 'uuid' }) @IsUUID('4') variantId!: string;
}
