import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AlertType, type AlertDto } from './alert.calculator';

/** `notificaciones.tipo`, en español como el resto de la BD. */
const TYPE_DB: Record<AlertType, string> = {
  [AlertType.BUDGET]: 'presupuesto',
  [AlertType.CARD_PAYMENT]: 'pago_tarjeta',
  [AlertType.POCKET_GOAL]: 'meta_apartado',
};

export interface AlertRead {
  readAt: Date | null;
  /** readSignature() de la alerta cuando se leyó. */
  signature: string | null;
}

/** Solo guarda cuáles leyó el usuario; las alertas se calculan al vuelo (§2.9). */
@Injectable()
export class AlertsRepository {
  constructor(private readonly dataSource: DataSource) {}

  async findReads(
    userId: string,
    keys: string[],
  ): Promise<Map<string, AlertRead>> {
    if (keys.length === 0) {
      return new Map();
    }
    const rows: (AlertRead & { key: string })[] = await this.dataSource.query(
      `SELECT clave AS key, leida_en AS "readAt", datos->>'firma' AS signature
       FROM notificaciones
       WHERE usuario_id = $1 AND clave = ANY($2::text[])`,
      [userId, keys],
    );
    return new Map(rows.map((row) => [row.key, row]));
  }

  async saveRead(
    userId: string,
    alert: AlertDto,
    signature: string,
    isRead: boolean,
  ): Promise<void> {
    const { isRead: _ignored, ...snapshot } = alert;
    await this.dataSource.query(
      `INSERT INTO notificaciones (usuario_id, tipo, datos, clave, leida_en)
       VALUES ($1, $2, $3::jsonb, $4, CASE WHEN $5::boolean THEN now() END)
       ON CONFLICT (usuario_id, clave)
       DO UPDATE SET datos = EXCLUDED.datos, leida_en = EXCLUDED.leida_en`,
      [
        userId,
        TYPE_DB[alert.type],
        JSON.stringify({ firma: signature, ...snapshot }),
        alert.id,
        isRead,
      ],
    );
  }
}
