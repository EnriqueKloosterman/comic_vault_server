import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { SessionUser } from './jwt-auth.guard';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): SessionUser => {
    return ctx.switchToHttp().getRequest().user;
  },
);
