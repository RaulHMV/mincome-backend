import { Injectable, PipeTransform } from '@nestjs/common';
import { NotFoundError } from '../errors/api-error';
import { UUID_PATTERN } from './schemas';

// Un id de ruta con formato inválido no puede existir: responde 404 igual que
// uno que no existe o es de otro usuario.

@Injectable()
export class ParseUuidPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!UUID_PATTERN.test(value)) {
      throw new NotFoundError();
    }
    return value.toLowerCase();
  }
}

@Injectable()
export class ParseIntIdPipe implements PipeTransform<string, number> {
  transform(value: string): number {
    const id = Number(value);
    if (!/^[1-9]\d{0,9}$/.test(value) || id > 2_147_483_647) {
      throw new NotFoundError();
    }
    return id;
  }
}

/** Ids de mensajes (BIGINT), que la API expone como texto. */
@Injectable()
export class ParseBigIntIdPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (
      !/^[1-9]\d{0,18}$/.test(value) ||
      BigInt(value) > 9_223_372_036_854_775_807n
    ) {
      throw new NotFoundError();
    }
    return value;
  }
}
