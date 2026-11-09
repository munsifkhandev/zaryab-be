import type { Request } from 'express';
import type { RoleName } from '../../generated/prisma/enums.js';

export interface UserProfile {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  emailVerifiedAt: Date | null;
  roles: RoleName[];
  permissions: string[];
}

export interface AuthContext {
  sessionId: string;
  expiresAt: Date;
  csrfToken: string;
  user: UserProfile;
}

export type AuthRequest = Request & { auth?: AuthContext };
