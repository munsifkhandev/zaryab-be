import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsBoolean, IsDateString, IsInt, IsOptional, IsString, IsUrl, IsUUID, Length, Matches, Max, Min, ValidateIf, ValidateNested } from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';

export class PageDto {
  @ApiProperty({type:String}) @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/) @Length(1,200) slug!:string;
  @ApiProperty({type:String}) @IsString() @Length(1,200) title!:string;
  @ApiProperty({type:[String]}) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @IsString({each:true}) @Length(1,10000,{each:true}) paragraphs!:string[];
  @ApiProperty({type:Boolean}) @IsBoolean() isPublished!:boolean;
}
export class UpdatePageDto extends PartialType(PageDto,{skipNullProperties:false}) {}
export class BannerDto {
  @ApiProperty({type:String}) @IsString() @Length(1,200) title!:string;
  @ApiProperty({type:String}) @IsUrl({protocols:['https'],require_protocol:true,disallow_auth:true}) @Length(1,2048) image!:string;
  @ApiProperty({type:String,description:'Local storefront path.'}) @Matches(/^\/(?!\/)[a-zA-Z0-9/_?=&%#.-]*$/) @Length(1,2048) href!:string;
  @ApiProperty({type:Number}) @IsInt() @Min(0) @Max(10000) position!:number;
  @ApiProperty({type:Boolean}) @IsBoolean() isPublished!:boolean;
  @ApiPropertyOptional({type:String,nullable:true}) @IsOptional() @IsDateString() startsAt?:string|null;
  @ApiPropertyOptional({type:String,nullable:true}) @IsOptional() @IsDateString() endsAt?:string|null;
}
export class UpdateBannerDto extends PartialType(BannerDto,{skipNullProperties:false}) {}
export class ArticleDto {
  @ApiProperty({type:String}) @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/) @Length(1,200) slug!:string;
  @ApiProperty({type:String}) @IsString() @Length(1,200) title!:string;
  @ApiProperty({type:String}) @IsString() @Length(1,1000) excerpt!:string;
  @ApiProperty({type:String}) @IsUrl({protocols:['https'],require_protocol:true,disallow_auth:true}) @Length(1,2048) image!:string;
  @ApiProperty({type:[String]}) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @IsString({each:true}) @Length(1,10000,{each:true}) paragraphs!:string[];
  @ApiPropertyOptional({type:String,nullable:true}) @IsOptional() @IsUUID('4') categoryId?:string|null;
  @ApiPropertyOptional({type:String,nullable:true,description:'Null means draft; future dates schedule publication.'}) @IsOptional() @IsDateString() publishedAt?:string|null;
}
export class UpdateArticleDto extends PartialType(ArticleDto,{skipNullProperties:false}) {}
export class HomeSectionDto {
  @ApiProperty({enum:['COLLECTION','NEW_ARRIVALS','FEATURED','TRENDING','BESTSELLERS']}) @Matches(/^(COLLECTION|NEW_ARRIVALS|FEATURED|TRENDING|BESTSELLERS)$/) kind!:'COLLECTION'|'NEW_ARRIVALS'|'FEATURED'|'TRENDING'|'BESTSELLERS';
  @ApiProperty({type:String}) @IsString() @Length(1,200) title!:string;
  @ApiPropertyOptional({type:String}) @ValidateIf((o:HomeSectionDto)=>o.kind==='COLLECTION'||o.collectionId!==undefined) @IsUUID('4') collectionId?:string;
  @ApiPropertyOptional({type:[String]}) @ValidateIf((o:HomeSectionDto)=>['FEATURED','TRENDING','BESTSELLERS'].includes(o.kind)||o.productIds!==undefined) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @ArrayUnique() @IsUUID('4',{each:true}) productIds?:string[];
}
export class ContentLinkDto {
  @ApiProperty({type:String}) @IsString() @Length(1,200) label!:string;
  @ApiProperty({type:String}) @Matches(/^\/(?!\/)[a-zA-Z0-9/_?=&%#.-]*$/) @Length(1,2048) href!:string;
}
export class CampaignDto extends ContentLinkDto {
  @ApiProperty({type:String}) @IsDateString() startsAt!:string;
  @ApiProperty({type:String}) @IsDateString() endsAt!:string;
}
export class HomeDto {
  @ApiProperty({type:[HomeSectionDto]}) @IsArray() @ArrayMaxSize(12) @ValidateNested({each:true}) @Type(()=>HomeSectionDto) sections!:HomeSectionDto[];
  @ApiPropertyOptional({type:ContentLinkDto,nullable:true}) @IsOptional() @ValidateNested() @Type(()=>ContentLinkDto) announcement?:ContentLinkDto|null;
  @ApiPropertyOptional({type:[ContentLinkDto]}) @ValidateIf((_o,v:unknown)=>v!==undefined) @IsArray() @ArrayMaxSize(30) @ValidateNested({each:true}) @Type(()=>ContentLinkDto) footerLinks?:ContentLinkDto[];
  @ApiPropertyOptional({type:String}) @ValidateIf((_o,v:unknown)=>v!==undefined) @IsString() @Length(0,300) copyrightText?:string;
  @ApiPropertyOptional({type:[String]}) @ValidateIf((_o,v:unknown)=>v!==undefined) @IsArray() @ArrayMaxSize(8) @ArrayUnique() @IsUUID('4',{each:true}) heroBannerIds?:string[];
  @ApiPropertyOptional({type:CampaignDto,nullable:true}) @IsOptional() @ValidateNested() @Type(()=>CampaignDto) countdown?:CampaignDto|null;
}
