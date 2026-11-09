import { createParamDecorator, SetMetadata, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import type { AuthRequest } from './auth.types.js';
import type { RoleName } from '../../generated/prisma/enums.js';

export const PUBLIC_ROUTE = 'auth:public';
export const OPTIONAL_AUTH_ROUTE = 'auth:optional';
export const REQUIRED_ROLES = 'auth:roles';
export const REQUIRED_PERMISSIONS = 'auth:permissions';

export const Public = () => SetMetadata(PUBLIC_ROUTE, true);
export const GuestAllowed = () => SetMetadata(OPTIONAL_AUTH_ROUTE, true);
export const Roles = (...roles: RoleName[]) => SetMetadata(REQUIRED_ROLES, roles);
export const Permissions = (...permissions: string[]) => SetMetadata(REQUIRED_PERMISSIONS, permissions);
export const CurrentAuth = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  const auth = context.switchToHttp().getRequest<AuthRequest>().auth;
  if (!auth) throw new UnauthorizedException();
  return auth;
});
