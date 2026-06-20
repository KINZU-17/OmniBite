import { SetMetadata } from '@nestjs/common';
import { StaffRole } from '@prisma/client';

export const ROLES_KEY = 'roles';

/** Restricts an endpoint to the given staff roles. Used with RolesGuard. */
export const Roles = (...roles: StaffRole[]) => SetMetadata(ROLES_KEY, roles);
