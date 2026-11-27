# Mincome · Backend

API de Mincome en NestJS 12 y PostgreSQL 16. Implementa el contrato de la API y las reglas de negocio que están en `docs/` de **mincome-frontend**: `contrato-api.md`, `requerimientos-backend.md` y `requerimientos-ia.md`. En AWS corre en una Lambda detrás de API Gateway; local, como servidor HTTP normal.

## Requisitos

- **Node.js 24** (`.nvmrc`): Jest 30 y el paquete de Lambda lo necesitan. Con nvm: `nvm use`.
- **PostgreSQL 16** con las extensiones `pgcrypto`, `pg_trgm` y `unaccent` (vienen en la imagen oficial `postgres:16`).

## Puesta en marcha

```bash
nvm use
npm ci
cp .env.example .env        # llena DB_PASSWORD, COGNITO_USER_POOL_ID y COGNITO_CLIENT_IDS
createdb mincome            # o la base que pongas en DB_NAME
npm run migration:run
npm run start:dev           # http://localhost:3000/api/v1/health
```

Todas las rutas van bajo `/api/v1` y piden `Authorization: Bearer <token de Cognito>`, salvo `GET /health`. Para pruebas manuales, los tokens salen del user pool de desarrollo.

## Variables de entorno

Las de la base, Cognito, CORS, rutas internas e idempotencia están comentadas en [`.env.example`](.env.example). En Lambda, la plantilla de SAM las pone (ver [docs/despliegue.md](docs/despliegue.md)). La app valida su configuración al arrancar y no levanta si falta algo obligatorio.

## Migraciones

El esquema vive en [`src/database/migrations`](src/database/migrations), en migraciones **escritas a mano**. No se usa `synchronize` ni `migration:generate`, para que los nombres de restricciones e índices sigan la guía de contribución (`pk_`, `fk_`, `uq_`, `ck_`, `idx_`).

```bash
npm run migration:create -- src/database/migrations/AgregaAlgo   # crea el archivo vacío
npm run migration:run                         # aplica las pendientes (usa .env)
npm run migration:revert                      # revierte la última
npm run migration:show                        # cuáles faltan
```

- Cada migración nueva se agrega a `MIGRATIONS` en [`src/database/migrations/index.ts`](src/database/migrations/index.ts). Una prueba revisa que estén todas y en orden.
- Prueba `up` y `down` antes de subirla, y que sea compatible con el código anterior: en AWS la versión vieja sigue atendiendo mientras corre la migración.
- En AWS las corre el despliegue, no una persona (ver [docs/despliegue.md](docs/despliegue.md)).

## Pruebas

| Comando | Qué corre |
|---|---|
| `npm test` | Unitarias: toda la aritmética (saldos, presupuestos, tarjetas, recurrencia, calendario, alertas). |
| `npm run test:e2e` | e2e contra PostgreSQL de verdad, por endpoint, más [`failure-scenarios`](test/failure-scenarios.e2e-spec.ts): carreras, fallas a media transacción, failover, tokens falsificados y entradas hostiles. |
| `npm run test:lambda-bundle` | Las e2e de la Lambda contra el paquete que se sube a AWS. |

Las e2e usan `TEST_DB_HOST`, `TEST_DB_PORT`, `TEST_DB_NAME` (`mincome_test` por omisión), `TEST_DB_USER` y `TEST_DB_PASSWORD` del entorno. **Borran y vuelven a crear el esquema en cada archivo**: nunca las apuntes a una base con datos que quieras conservar.

```bash
TEST_DB_PORT=5432 TEST_DB_PASSWORD=postgres npm run test:e2e
```

## Scripts

| Script | Para qué |
|---|---|
| `start:dev` | Servidor local con recarga |
| `build` | Compila a `dist/` |
| `build:lambda` | `build` y empaqueta la Lambda en `dist-lambda/` (solo el código que usa) |
| `lint`, `format` | oxlint y Prettier |
| `job:daily` | El proceso diario a mano, después de `build` |

## Arquitectura

```text
src/
├── lambda.ts             La Lambda: API Gateway, trigger de Cognito y jobs
├── main.ts               Servidor HTTP local
├── common/               Dinero en centavos, fechas en la zona del usuario, errores, validación
├── auth/                 Cognito (JWT local o claims de API Gateway), premium y rutas internas
├── balances/             Saldos y patrimonio: la única fórmula (§3.1)
├── accounts/ cards/      Cuentas, tarjetas y pago de tarjeta
├── transactions/ recurring-transactions/ budgets/ pockets/
├── movements/            GET /movements
├── dashboard/ calendar/ alerts/
├── conversations/        Historial de Piggy y turnos internos
├── idempotency/          Idempotency-Key sobre PostgreSQL
└── database/             Configuración y migraciones
```

- **Cada regla existe una vez.** El Dashboard, Mis Tarjetas, el calendario y Piggy leen de los mismos servicios, así que no pueden decir números distintos.
- **Dinero en centavos.** Se suma con enteros y se guarda como `NUMERIC`; la API lo entrega como número con dos decimales.
- **Fechas.** "Hoy" y "este mes" son los de la zona horaria del usuario (`usuarios.zona_horaria`), no los del servidor.
- **AWS**: Lambda en la VPC, API Gateway HTTP API, RDS Proxy, EventBridge Scheduler y CodeDeploy. Cómo se despliega y por qué, en [docs/despliegue.md](docs/despliegue.md).

## Convenciones de la API

- **Errores** siempre con `{ "error": { "code", "message", "fields" } }` (contrato §1). Además de los del contrato: `409 idempotency_key_in_use`, `422 idempotency_key_reused`, `403 forbidden` (rutas internas) y `500 internal_error`. Un 500 nunca trae detalles internos.
- **`Idempotency-Key`** (un UUID por intento del usuario) es obligatoria en `POST /transactions`, `POST /cards/:cardId/payments` y `POST /pockets/:pocketId/movements`. Un reintento con la misma llave regresa la misma respuesta con `Idempotent-Replayed: true` y no mueve dinero otra vez. Con `?dryRun=true` no hace falta.
- **Recursos de otro usuario** responden 404, no 403.

## Decisiones adoptadas

Se tomó la propuesta de cada decisión abierta de requerimientos-backend.md §6:

| | Decisión |
|---|---|
| D1 | Cuentas y traspasos completos |
| D2 | El patrimonio resta la deuda de las tarjetas |
| D3 | Ingreso: recurrente o variable; gasto: fijo o variable; las recurrentes nunca son variables |
| D4 | Solo el gasto que cruza un umbral guarda `nivel_alerta` |
| D5 | Las recurrentes se registran solas |
| D6, D15 | Un abono sale de la cuenta que elige el usuario y no pasa de su saldo |
| D7 | Liberar un apartado regresa todo a una cuenta y lo cierra |
| D9 | El pago de tarjeta se avisa 10 días antes |
| D10 | Los movimientos llevan hora opcional |
| D14 | Un gasto mayor a lo disponible responde `409 insufficient_funds` |
| D16 | Una tarjeta con movimientos se desactiva; sin movimientos, se borra |
| D17 | La API pide monto objetivo en los apartados |

Otras reglas que no estaban escritas:

- Cada usuario nace con una cuenta **Efectivo** en 0.
- No hay transacciones con fecha futura: lo que viene va como recurrente.
- Las recurrentes generadas no revisan saldo (ya pasaron); desactivar una cuenta o tarjeta pausa sus recurrentes.
- Traspasos y movimientos de apartados no pueden ser anteriores al saldo inicial de su cuenta.
- La proyección cuenta todos los pagos del calendario, también los recurrentes con tarjeta de crédito, igual que el simulador del front.

## Pendiente

- Los límites del plan premium (100 consultas, 200,000 tokens, $79) son los del ejemplo del contrato: hay que confirmarlos.
- La rama no tiene clave de Jira (`SCRUM-XX`); se puede renombrar al abrir el PR.
- Lo que falta en AWS está al final de [docs/despliegue.md](docs/despliegue.md).
