import { CreateBaseSchema1795089600000 } from './1795089600000-CreateBaseSchema';
import { AddCuentasAndTraspasos1795089601000 } from './1795089601000-AddCuentasAndTraspasos';
import { AddCardDetailsToTarjetas1795089602000 } from './1795089602000-AddCardDetailsToTarjetas';
import { AddRecurrenceRulesToTransaccionesRecurrentes1795089603000 } from './1795089603000-AddRecurrenceRulesToTransaccionesRecurrentes';
import { AddVigenteDesdeToPresupuestos1795089604000 } from './1795089604000-AddVigenteDesdeToPresupuestos';
import { AddZonaHorariaAndTerminosToUsuarios1795089605000 } from './1795089605000-AddZonaHorariaAndTerminosToUsuarios';
import { AddHoraToTransacciones1795089606000 } from './1795089606000-AddHoraToTransacciones';
import { CreateNotificaciones1795089607000 } from './1795089607000-CreateNotificaciones';
import { UpdateCategoriasCatalog1795089608000 } from './1795089608000-UpdateCategoriasCatalog';
import { AddIntegrityRules1795089609000 } from './1795089609000-AddIntegrityRules';
import { AddHerramientasUsadasToMensajesChat1795089610000 } from './1795089610000-AddHerramientasUsadasToMensajesChat';
import { CreateLlavesIdempotencia1795089611000 } from './1795089611000-CreateLlavesIdempotencia';
import { SeedCatalogs1795089612000 } from './1795089612000-SeedCatalogs';

/**
 * Todas las migraciones, en orden. Una lista explícita funciona igual con tsx,
 * desde dist/ y en Jest. Al crear una migración con `npm run migration:create`,
 * agrégala aquí; una prueba revisa que no falte ninguna.
 */
export const MIGRATIONS = [
  CreateBaseSchema1795089600000,
  AddCuentasAndTraspasos1795089601000,
  AddCardDetailsToTarjetas1795089602000,
  AddRecurrenceRulesToTransaccionesRecurrentes1795089603000,
  AddVigenteDesdeToPresupuestos1795089604000,
  AddZonaHorariaAndTerminosToUsuarios1795089605000,
  AddHoraToTransacciones1795089606000,
  CreateNotificaciones1795089607000,
  UpdateCategoriasCatalog1795089608000,
  AddIntegrityRules1795089609000,
  AddHerramientasUsadasToMensajesChat1795089610000,
  CreateLlavesIdempotencia1795089611000,
  SeedCatalogs1795089612000,
];
