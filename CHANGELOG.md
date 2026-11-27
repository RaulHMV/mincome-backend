# Changelog

Todos los cambios importantes de este proyecto se anotan aquí, con el formato de [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y [versionado semántico](https://semver.org/lang/es/).

## [Sin publicar]

### Agregado

- Esquema completo en migraciones de TypeORM escritas a mano: el diccionario de datos más los cambios de requerimientos-backend.md §2 (cuentas, traspasos, datos de tarjetas, reglas de recurrencia, vigencia de presupuestos, zona horaria, términos, hora del movimiento, notificaciones leídas, integridad, índices y búsqueda sin acentos) y los catálogos de planes y categorías.
- Autenticación con Cognito: el usuario se crea en su primer `GET /me` o con el trigger *Post confirmation*, y el plan sale del grupo `normal` o `premium`.
- `GET` y `PATCH /me`, `GET /plans`, y `GET`, `POST` y `PATCH /categories`.
- Cuentas de efectivo, débito y crédito, con saldos calculados y patrimonio neto (D1, D2).
- Mis Tarjetas: alta, edición y baja (D16), crédito usado y disponible, fechas de corte y de pago, pago para no generar intereses y el pago de tarjeta como traspaso.
- Presupuestos por mes con vigencia, porcentaje truncado y alerta al cruzar el umbral (D4).
- Transacciones con `?dryRun=true`, validación de saldo disponible (D14) y sin fechas futuras.
- Recurrentes que se registran solas (D5), al crearlas y en el proceso diario.
- Apartados: abonos, retiros, liberación (D7) y tope de 10 activos.
- `GET /movements` con filtros, búsqueda sin acentos y totales.
- `GET /dashboard`, `GET /calendar` y `GET /balance-projections` con la fórmula corregida de §3.8.
- `GET` y `PATCH /alerts`, con las leídas guardadas en `notificaciones`.
- Historial de Piggy (`/conversations`, solo premium) y las rutas internas de turnos para mincome-ai-wrapper, con cuota por consultas y tokens.
- `Idempotency-Key` obligatoria en los POST que mueven dinero, con las respuestas guardadas en PostgreSQL y cifradas.
- Handler de Lambda para API Gateway, Cognito, el proceso diario y las migraciones, empaquetado con esbuild (~2 MB en zip).
- Plantilla de AWS SAM, RDS Proxy y usuaria de la app en Terraform, CI y despliegue con OIDC (docs/despliegue.md).
- Pruebas unitarias de los cálculos, e2e de cada endpoint y escenarios de falla cercanos a producción.

### Cambiado

- El esquema ya no vive en `terraform/tables.tf`: pasó a migraciones.
- Los planes se llaman `normal` y `premium`, igual que los grupos de Cognito.
- Un JSON mal formado responde `422 validation_error`, como cualquier body inválido.
