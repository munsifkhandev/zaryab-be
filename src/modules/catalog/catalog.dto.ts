import { Transform, Type, type TransformFnParams } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsBoolean, IsIn, IsInt,
  IsOptional, IsString, IsUrl, IsUUID, Length, Matches, Max, Min, ValidateIf, ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';

const trim = ({ value }: TransformFnParams): unknown => typeof value === 'string' ? value.trim() : value;

export class SlugParamDto {
  @ApiProperty({ type: String, maxLength: 200 })
  @IsString() @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/) @Length(1, 200)
  slug!: string;
}

export class PageQueryDto {
  @ApiPropertyOptional({ type: Number, default: 1, maximum: 10000 })
  @Type(() => Number) @IsInt() @Min(1) @Max(10000)
  page = 1;

  @ApiPropertyOptional({ type: Number, default: 20, maximum: 120 })
  @Type(() => Number) @IsInt() @Min(1) @Max(120)
  limit = 20;
}

export class ProductQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ type: String, maxLength: 100 })
  @IsOptional() @Transform(trim) @IsString() @Length(0, 100)
  search?: string;

  @ApiPropertyOptional({ type: String, description: 'Category name or slug.' })
  @IsOptional() @Transform(trim) @IsString() @Length(1, 200)
  category?: string;

  @ApiPropertyOptional({ type: String })
  @IsOptional() @IsString() @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/) @Length(1, 200)
  collection?: string;

  @ApiPropertyOptional({ enum: ['In Stock', 'Limited Pieces', 'Out of Stock'] })
  @IsOptional() @IsIn(['In Stock', 'Limited Pieces', 'Out of Stock'])
  availability?: string;

  @ApiPropertyOptional({ type: Number, description: 'USD cents.' })
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(1000000000)
  minPrice?: number;

  @ApiPropertyOptional({ type: Number, description: 'USD cents.' })
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(1000000000)
  maxPrice?: number;

  @ApiPropertyOptional({ enum: ['newest', 'price-asc', 'price-desc'] })
  @IsOptional() @IsIn(['newest', 'price-asc', 'price-desc'])
  sort?: string;
}

export class AdminProductQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: ['DRAFT', 'PUBLISHED', 'ARCHIVED'] })
  @IsOptional() @IsIn(['DRAFT', 'PUBLISHED', 'ARCHIVED'])
  status?: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
}

export class ProductImageDto {
  @ApiProperty({ type: String, format: 'uri', maxLength: 2048 })
  @IsUrl({ protocols: ['https'], require_protocol: true, disallow_auth: true }) @Length(1, 2048)
  url!: string;

  @ApiPropertyOptional({ type: String, maxLength: 255 })
  @IsOptional() @IsString() @Length(0, 255)
  altText?: string;
}

export class VariantPriceDto {
  @ApiProperty({ type: Number, description: 'Integer USD cents.' })
  @IsInt() @Min(0) @Max(1000000000)
  price!: number;

  @ApiPropertyOptional({ type: Number, nullable: true })
  @IsOptional() @IsInt() @Min(0) @Max(1000000000)
  compareAtPrice?: number | null;
}

export class CreateVariantDto extends VariantPriceDto {
  @ApiProperty({ type: String, maxLength: 100 })
  @Transform(({ value }: TransformFnParams) => typeof value === 'string' ? value.trim().toUpperCase() : value)
  @IsString() @Length(1, 100)
  sku!: string;

  @ApiProperty({ type: String, maxLength: 30 })
  @Transform(({ value }: TransformFnParams) => typeof value === 'string' ? value.trim().toUpperCase() : value)
  @IsString() @Length(1, 30)
  size!: string;

  @ApiProperty({ type: String, maxLength: 100 })
  @Transform(trim) @IsString() @Length(1, 100)
  colorName!: string;

  @ApiProperty({ type: String, example: '#282828' })
  @Matches(/^#[0-9a-fA-F]{6}$/)
  colorHex!: string;
}

export class ProductFieldsDto {
  @ApiPropertyOptional({type:String,description:'Configured tax class; defaults to STANDARD.'})
  @ValidateIf((_o,v:unknown)=>v!==undefined) @Matches(/^[A-Z][A-Z0-9_]{0,29}$/)
  taxClass?: string;
  @ApiProperty({ type: String, maxLength: 200 })
  @Transform(trim) @IsString() @Length(1, 200)
  name!: string;

  @ApiProperty({ type: String, maxLength: 200 })
  @IsString() @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/) @Length(1, 200)
  slug!: string;

  @ApiProperty({ type: String, maxLength: 20000 })
  @IsString() @Length(0, 20000)
  description!: string;

  @ApiProperty({ type: String, maxLength: 500 })
  @IsString() @Length(0, 500)
  material!: string;

  @ApiProperty({ type: String, maxLength: 1000 })
  @IsString() @Length(0, 1000)
  care!: string;

  @ApiProperty({ type: [String], format: 'uuid', minItems: 1, maxItems: 10 })
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(10) @ArrayUnique() @IsUUID('4', { each: true })
  categoryIds!: string[];

  @ApiProperty({ type: [String], format: 'uuid', maxItems: 20 })
  @IsArray() @ArrayMaxSize(20) @ArrayUnique() @IsUUID('4', { each: true })
  collectionIds!: string[];

  @ApiProperty({ type: [ProductImageDto], minItems: 1, maxItems: 12 })
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(12) @ValidateNested({ each: true }) @Type(() => ProductImageDto)
  images!: ProductImageDto[];
}

export class CreateProductDto extends ProductFieldsDto {
  @ApiProperty({ type: [CreateVariantDto], minItems: 1, maxItems: 60 })
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(60) @ArrayUnique((variant: CreateVariantDto | null | undefined) => variant?.sku)
  @ValidateNested({ each: true }) @Type(() => CreateVariantDto)
  variants!: CreateVariantDto[];
}

export class UpdateProductDto extends PartialType(ProductFieldsDto, { skipNullProperties: false }) {}

export class CategoryDto {
  @ApiProperty({ type: String, maxLength: 100 })
  @Transform(trim) @IsString() @Length(1, 100)
  name!: string;

  @ApiProperty({ type: String, maxLength: 200 })
  @IsString() @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/) @Length(1, 200)
  slug!: string;
}

export class CollectionDto extends CategoryDto {
  @ApiProperty({ type: String, maxLength: 200 })
  @Transform(trim) @IsString() @Length(1, 200)
  title!: string;

  @ApiProperty({ type: String, maxLength: 20000 })
  @IsString() @Length(0, 20000)
  description!: string;
}

export class CollectionPublicationDto {
  @ApiProperty({ type: Boolean }) @IsBoolean()
  isPublished!: boolean;
}
