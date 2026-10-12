import { Catch, ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';

interface Rfc7807Body {
  statusCode: number;
  timestamp: string;
  path: string;
  error: string;
  message: string;
  code: string;
}

@Catch()
export class Rfc7807ExceptionFilter extends BaseExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let error = 'InternalServerError';
    let code = 'INTERNAL_ERROR';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      const cause = exception.cause as Record<string, unknown> | undefined;
      if (typeof res === 'string') {
        message = res;
        error = exception.name;
        code = (cause?.code as string) ?? code;
      } else if (typeof res === 'object' && res !== null) {
        const body = res as Record<string, unknown>;
        message = (body.message as string) ?? exception.message;
        error = (body.error as string) ?? exception.name;
        code = (body.code as string) ?? (cause?.code as string) ?? code;
      } else {
        error = exception.name;
      }
    }

    const body: Rfc7807Body = {
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request?.url ?? '',
      error,
      message: Array.isArray(message) ? message.join(', ') : String(message),
      code,
    };

    response.status(status).json(body);
  }
}
