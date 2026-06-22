import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { StaffRole, Staff } from '@prisma/client';
import { ROLES_KEY } from './roles.decorator';

/** Enforces @Roles(...). Must run after StaffGuard (which sets req.staff). */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<StaffRole[]>(ROLES_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const req = ctx.switchToHttp().getRequest();
    const staff = req.staff;
    if (!staff) throw new ForbiddenException('no staff context');
    // ADMIN is a superuser for Phase 1.
    if (staff.role === StaffRole.ADMIN) return true;
    if (!required.includes(staff.role)) {
      throw new ForbiddenException(`requires role: ${required.join(' or ')}`);
    }
    return true;
  }
}
