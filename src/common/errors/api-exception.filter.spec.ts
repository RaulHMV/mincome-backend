import {
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { InsufficientFundsError, ValidationError } from './api-error';
import { ApiExceptionFilter } from './api-exception.filter';

function capture(exception: unknown) {
  const response = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  const host = {
    switchToHttp: () => ({ getResponse: () => response }),
  } as unknown as ArgumentsHost;
  new ApiExceptionFilter().catch(exception, host);
  return {
    status: response.status.mock.calls[0][0],
    body: response.json.mock.calls[0][0],
  };
}

describe('ApiExceptionFilter', () => {
  beforeAll(() =>
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined),
  );

  it('deja pasar los errores de la API tal cual', () => {
    expect(capture(new InsufficientFundsError('Saldo insuficiente.'))).toEqual({
      status: 409,
      body: {
        error: {
          code: 'insufficient_funds',
          message: 'Saldo insuficiente.',
          fields: null,
        },
      },
    });
  });

  it('deja pasar un error repetido por @nestjs/idempotency, que llega como HttpException', () => {
    const original = ValidationError.forField('amount', 'Debe ser mayor a 0');
    const replayed = new HttpException(
      original.getResponse(),
      original.getStatus(),
    );
    expect(capture(replayed)).toEqual({
      status: 422,
      body: {
        error: {
          code: 'validation_error',
          message: 'Revisa los campos marcados.',
          fields: { amount: 'Debe ser mayor a 0' },
        },
      },
    });
  });

  it('traduce los rechazos de @nestjs/idempotency', () => {
    const inUse = new HttpException(
      {
        statusCode: 409,
        error: 'Conflict',
        code: 'IDEMPOTENCY_KEY_IN_USE',
        message: 'still running',
      },
      409,
    );
    expect(capture(inUse).body.error.code).toBe('idempotency_key_in_use');

    const required = new HttpException(
      { statusCode: 400, code: 'IDEMPOTENCY_KEY_REQUIRED' },
      400,
    );
    expect(capture(required)).toMatchObject({
      status: 422,
      body: { error: { code: 'validation_error' } },
    });
  });

  it('usa la forma del contrato para las excepciones de Nest', () => {
    expect(
      capture(new HttpException('Cannot GET /x', HttpStatus.NOT_FOUND)),
    ).toEqual({
      status: 404,
      body: {
        error: {
          code: 'not_found',
          message: 'No encontramos lo que buscas.',
          fields: null,
        },
      },
    });
  });

  it('convierte una violación de UNIQUE de PostgreSQL en 409 conflict', () => {
    const error = new QueryFailedError(
      'INSERT ...',
      [],
      Object.assign(new Error('dup'), { code: '23505' }),
    );
    expect(capture(error)).toMatchObject({
      status: 409,
      body: { error: { code: 'conflict' } },
    });
  });

  it('no filtra detalles de un error inesperado', () => {
    expect(capture(new Error('connection refused at 10.0.0.5'))).toEqual({
      status: 500,
      body: {
        error: {
          code: 'internal_error',
          message: 'Ocurrió un error inesperado.',
          fields: null,
        },
      },
    });
  });
});
