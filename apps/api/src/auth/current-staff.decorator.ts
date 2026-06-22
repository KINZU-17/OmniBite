import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Staff } from '@prisma/client';

/** Injects the authenticated staff member resolved by StaffGuard. */
export const CurrentStaff = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): Staff => {
    const req = ctx.switchToHttp().getRequest<{ staff: Staff }>();
    return req.staff;
  },
);
