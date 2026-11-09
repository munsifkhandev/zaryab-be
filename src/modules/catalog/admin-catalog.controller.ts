import { Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiCreatedResponse, ApiHeader, ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CurrentAuth, Permissions } from '../auth/auth.metadata.js';
import type { AuthContext } from '../auth/auth.types.js';
import { CatalogService } from './catalog.service.js';
import { AdminProductQueryDto, CategoryDto, CollectionDto, CollectionPublicationDto, CreateProductDto, CreateVariantDto, PageQueryDto, UpdateProductDto, VariantPriceDto } from './catalog.dto.js';
import { ProductSummaryResponseDto } from './catalog-response.dto.js';

const uuid = new ParseUUIDPipe({ version: '4' });

@ApiCookieAuth()
@ApiTags('Admin products')
@Controller('admin/products')
export class AdminProductsController {
  constructor(@Inject(CatalogService) private readonly catalog: CatalogService) {}

  @Get() @Permissions('products.read')
  @ApiOkResponse({ description: 'Paginated product summaries: { items, total }.' })
  list(@Query() query: AdminProductQueryDto) { return this.catalog.adminList(query); }

  @Get(':id') @Permissions('products.read')
  @ApiOkResponse({ description: 'Stored product including images, category/collection links, variants, options and available stock summaries.' })
  detail(@Param('id', uuid) id: string) { return this.catalog.adminProduct(id); }

  @Post() @Permissions('products.create')
  @ApiHeader({ name: 'Origin', required: true }) @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiCreatedResponse({ type: ProductSummaryResponseDto })
  create(@Body() dto: CreateProductDto, @CurrentAuth() auth: AuthContext) { return this.catalog.createProduct(dto, auth.user.id); }

  @Patch(':id') @Permissions('products.update')
  @ApiHeader({ name: 'Origin', required: true }) @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiOkResponse({ type: ProductSummaryResponseDto })
  update(@Param('id', uuid) id: string, @Body() dto: UpdateProductDto, @CurrentAuth() auth: AuthContext) { return this.catalog.updateProduct(id, dto, auth.user.id); }

  @Post(':id/publish') @HttpCode(200) @Permissions('products.update')
  @ApiHeader({ name: 'Origin', required: true }) @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiOkResponse({ type: ProductSummaryResponseDto })
  publish(@Param('id', uuid) id: string, @CurrentAuth() auth: AuthContext) { return this.catalog.publish(id, auth.user.id); }

  @Post(':id/unpublish') @HttpCode(200) @Permissions('products.update')
  @ApiHeader({ name: 'Origin', required: true }) @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiOkResponse({ type: ProductSummaryResponseDto })
  unpublish(@Param('id', uuid) id: string, @CurrentAuth() auth: AuthContext) { return this.catalog.unpublish(id, auth.user.id); }

  @Delete(':id') @HttpCode(204) @Permissions('products.delete')
  @ApiHeader({ name: 'Origin', required: true }) @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiNoContentResponse({ description: 'Archives the product and retains its records.' })
  async archive(@Param('id', uuid) id: string, @CurrentAuth() auth: AuthContext) { await this.catalog.archive(id, auth.user.id); }

  @Post(':id/variants') @Permissions('products.update')
  @ApiHeader({ name: 'Origin', required: true }) @ApiHeader({ name: 'X-CSRF-Token', required: true })
  createVariant(@Param('id', uuid) id: string, @Body() dto: CreateVariantDto, @CurrentAuth() auth: AuthContext) { return this.catalog.createVariant(id, dto, auth.user.id); }

  @Patch(':id/variants/:variantId') @Permissions('products.update')
  @ApiHeader({ name: 'Origin', required: true }) @ApiHeader({ name: 'X-CSRF-Token', required: true })
  price(@Param('id', uuid) id: string, @Param('variantId', uuid) variantId: string, @Body() dto: VariantPriceDto, @CurrentAuth() auth: AuthContext) { return this.catalog.priceVariant(id, variantId, dto, auth.user.id); }

  @Delete(':id/variants/:variantId') @HttpCode(204) @Permissions('products.update')
  @ApiHeader({ name: 'Origin', required: true }) @ApiHeader({ name: 'X-CSRF-Token', required: true })
  async archiveVariant(@Param('id', uuid) id: string, @Param('variantId', uuid) variantId: string, @CurrentAuth() auth: AuthContext) { await this.catalog.archiveVariant(id, variantId, auth.user.id); }
}

@ApiCookieAuth()
@ApiTags('Admin categories and collections')
@Controller('admin')
export class AdminTaxonomyController {
  constructor(@Inject(CatalogService) private readonly catalog: CatalogService) {}

  @Get('categories') @Permissions('products.read')
  categories(@Query() query: PageQueryDto) { return this.catalog.adminCategories(query); }

  @Post('categories') @Permissions('products.create')
  @ApiHeader({ name: 'Origin', required: true }) @ApiHeader({ name: 'X-CSRF-Token', required: true })
  createCategory(@Body() dto: CategoryDto, @CurrentAuth() auth: AuthContext) { return this.catalog.createCategory(dto, auth.user.id); }

  @Get('collections') @Permissions('products.read')
  collections(@Query() query: PageQueryDto) { return this.catalog.adminCollections(query); }

  @Post('collections') @Permissions('products.create')
  @ApiHeader({ name: 'Origin', required: true }) @ApiHeader({ name: 'X-CSRF-Token', required: true })
  createCollection(@Body() dto: CollectionDto, @CurrentAuth() auth: AuthContext) { return this.catalog.createCollection(dto, auth.user.id); }

  @Patch('collections/:id/publication') @Permissions('products.update')
  @ApiHeader({ name: 'Origin', required: true }) @ApiHeader({ name: 'X-CSRF-Token', required: true })
  publication(@Param('id', uuid) id: string, @Body() dto: CollectionPublicationDto, @CurrentAuth() auth: AuthContext) { return this.catalog.publishCollection(id, dto.isPublished, auth.user.id); }
}
