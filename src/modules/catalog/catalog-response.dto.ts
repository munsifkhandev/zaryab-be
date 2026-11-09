import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ProductSummaryResponseDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String }) slug!: string;
  @ApiProperty({ enum: ['DRAFT', 'PUBLISHED', 'ARCHIVED'] }) status!: string;
}

export class ColorResponseDto {
  @ApiProperty({ type: String }) name!: string;
  @ApiProperty({ type: String, example: '#282828' }) value!: string;
}

export class StoreVariantResponseDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String }) sku!: string;
  @ApiProperty({ type: Number }) price!: number;
  @ApiProperty({ type: Number }) originalPrice!: number;
  @ApiProperty({ enum: ['USD'] }) currency!: string;
  @ApiProperty({ type: Number, minimum: 0, maximum: 99 }) stock!: number;
  @ApiProperty({ type: String }) size!: string;
  @ApiProperty({ type: ColorResponseDto }) color!: ColorResponseDto;
}

export class StoreProductResponseDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String }) slug!: string;
  @ApiProperty({ type: String }) name!: string;
  @ApiProperty({ type: String }) description!: string;
  @ApiProperty({ type: Number }) price!: number;
  @ApiProperty({ type: Number }) originalPrice!: number;
  @ApiProperty({ enum: ['USD'] }) currency!: string;
  @ApiProperty({ type: [String] }) images!: string[];
  @ApiProperty({ type: String }) category!: string;
  @ApiProperty({ type: [String] }) collections!: string[];
  @ApiProperty({ enum: ['In Stock', 'Limited Pieces', 'Out of Stock'] }) availability!: string;
  @ApiProperty({ type: Number, minimum: 0, maximum: 99 }) stock!: number;
  @ApiProperty({ type: [ColorResponseDto] }) colors!: ColorResponseDto[];
  @ApiProperty({ type: [String] }) sizes!: string[];
  @ApiPropertyOptional({ type: String }) badge?: string;
  @ApiProperty({ type: String }) material!: string;
  @ApiProperty({ type: String }) care!: string;
  @ApiProperty({ type: [StoreVariantResponseDto] }) variants!: StoreVariantResponseDto[];
}

export class StoreProductListResponseDto {
  @ApiProperty({ type: [StoreProductResponseDto] }) items!: StoreProductResponseDto[];
  @ApiProperty({ type: Number }) total!: number;
}

export class StoreCollectionResponseDto {
  @ApiProperty({ type: String }) slug!: string;
  @ApiProperty({ type: String }) name!: string;
  @ApiProperty({ type: String }) title!: string;
  @ApiProperty({ type: String }) description!: string;
}
