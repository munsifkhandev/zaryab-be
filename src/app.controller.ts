import { Controller, Get, Inject } from '@nestjs/common';
import { AppService } from './app.service.js';
import { Public } from './modules/auth/auth.metadata.js';

@Public()
@Controller()
export class AppController {
  constructor(@Inject(AppService) private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }
}
