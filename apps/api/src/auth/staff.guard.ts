import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Phase 1 staff authentication: the client sends `x-staff-id` identifying an
 * active staff member. This is intentionally minimal — signed staff tokens and
 * the full permission matrix are Phase 2. It is enough to attribute audit
 * entries and gate staff-only actions.
 */
@Injectable()
export class StaffGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const staffId = req.headers['x-staff-id'] as string | undefined;
    if (!staffId) throw new UnauthorizedException('missing x-staff-id');

    const staff = await this.prisma.staff.findFirst({
      where: { id: staffId, active: true },
    });
    if (!staff) throw new UnauthorizedException('unknown or inactive staff');

    req.staff = staff;
    return true;
  }
}
