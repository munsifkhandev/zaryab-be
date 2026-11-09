import { Controller, Get, Inject, Param, Query } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/auth.metadata.js';
import { CatalogService } from './catalog.service.js';
import { ProductQueryDto, SlugParamDto } from './catalog.dto.js';
import { StoreCollectionResponseDto, StoreProductListResponseDto, StoreProductResponseDto } from './catalog-response.dto.js';

@Public()
@ApiTags('Store catalog')
@Controller()
export class StoreCatalogController {
  constructor(@Inject(CatalogService) private readonly catalog: CatalogService) {}

  @Get(['products', 'store/products', 'store/search'])
  @ApiOkResponse({ type: StoreProductListResponseDto })
  list(@Query() query: ProductQueryDto) { return this.catalog.list(query); }

  @Get(['products/:slug', 'store/products/:slug'])
  @ApiOkResponse({ type: StoreProductResponseDto })
  product(@Param() params: SlugParamDto) { return this.catalog.bySlug(params.slug); }

  @Get(['categories', 'store/categories'])
  @ApiOkResponse({ type: String, isArray: true })
  categories() { return this.catalog.categories(); }

  @Get(['collections', 'store/collections'])
  @ApiOkResponse({ type: StoreCollectionResponseDto, isArray: true })
  collections() { return this.catalog.collections(); }

  @Get(['collections/:slug', 'store/collections/:slug'])
  @ApiOkResponse({ type: StoreCollectionResponseDto })
  collection(@Param() params: SlugParamDto) { return this.catalog.collection(params.slug); }
}
