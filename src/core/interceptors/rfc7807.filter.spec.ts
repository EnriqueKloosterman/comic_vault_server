import { ArgumentsHost, ForbiddenException, HttpException, HttpStatus } from '@nestjs/common';
import { Rfc7807ExceptionFilter } from './rfc7807.filter';

function mockHost() {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const response = { status };
  const request = { url: '/api/comics/123/pages/0' };
  const host = {
    switchToHttp: () => ({ getResponse: () => response, getRequest: () => request }),
  } as unknown as ArgumentsHost;
  return { host, json, status };
}

describe('Rfc7807ExceptionFilter', () => {
  it('preserva error y code de la respuesta HttpException', () => {
    const { host, json, status } = mockHost();
    const filter = new Rfc7807ExceptionFilter();
    filter.catch(
      new ForbiddenException({ message: 'Otro dueño', error: 'Forbidden', code: 'COMIC_ACCESS_DENIED' }),
      host,
    );
    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 403,
        path: '/api/comics/123/pages/0',
        error: 'Forbidden',
        message: 'Otro dueño',
        code: 'COMIC_ACCESS_DENIED',
      }),
    );
  });

  it('usa cause.code cuando la respuesta es string', () => {
    const { host, json } = mockHost();
    const filter = new Rfc7807ExceptionFilter();
    filter.catch(
      new HttpException('Fallo Drive', HttpStatus.UNAUTHORIZED, { cause: { code: 'GOOGLE_TOKEN_EXPIRED' } }),
      host,
    );
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 401, code: 'GOOGLE_TOKEN_EXPIRED' }),
    );
  });

  it('errores no-HTTP devuelven forma RFC7807 500', () => {
    const { host, json, status } = mockHost();
    const filter = new Rfc7807ExceptionFilter();
    filter.catch(new Error('boom'), host);
    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 500, code: 'INTERNAL_ERROR' }),
    );
  });
});
