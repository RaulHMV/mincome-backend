# Despliegue en AWS

El backend corre en **una Lambda** detrás de **API Gateway HTTP API**, dentro de la VPC, y llega a **RDS PostgreSQL** por **RDS Proxy**. La misma Lambda atiende el trigger *Post confirmation* de Cognito y el proceso diario de EventBridge Scheduler.

```text
Front ──JWT──▶ API Gateway ──▶ Lambda mincome-backend (alias live) ──IAM──▶ RDS Proxy ──▶ RDS
                 │  · /api/v1/* con autorizador JWT de Cognito           (VPC, sin NAT)
                 │  · /api/v1/internal/* con IAM (solo mincome-ai-wrapper)
                 │  · /api/v1/health sin autorización
Cognito ──Post confirmation──▶ Lambda
EventBridge Scheduler ──{"job":"daily"}──▶ Lambda
CodeDeploy (hook PreTraffic) ──{"job":"migrate"}──▶ versión nueva, antes de recibir tráfico
```

| Pieza | Dónde vive |
|---|---|
| RDS, RDS Proxy, usuaria `mincome_app`, security groups | [`terraform/`](../terraform/README.md) |
| Lambda, API Gateway, Scheduler, alarmas, hook de migraciones | [`template.yaml`](../template.yaml) (AWS SAM) |
| Despliegue | [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml), con OIDC |
| Pruebas, incluido el paquete de la Lambda | [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) |

## El paquete de la Lambda

`sam build` corre el [`Makefile`](../Makefile): `nest build` y después [`scripts/bundle-lambda.mjs`](../scripts/bundle-lambda.mjs) (esbuild). A AWS solo sube:

| Archivo | Tamaño aprox. |
|---|---|
| `lambda.js`: el código de la app y solo lo que usa de sus dependencias, minificado | 4.3 MB |
| `lambda.js.map`: para que los errores en CloudWatch digan archivo y línea del código fuente | 4.6 MB |
| `lambda.js.LEGAL.txt`: las licencias de las dependencias | 7 KB |

Unos **2.2 MB en zip**. No sube `node_modules` (289 MB con las devDependencies), `src/`, `test/` ni los `.ts`. Se empaqueta la salida de `nest build` y no los `.ts` porque esbuild no emite la metadata de los decoradores que la inyección de dependencias de Nest necesita.

`npm run test:lambda-bundle` corre las e2e de la Lambda contra ese archivo, copiado a una carpeta sin `node_modules` como `/var/task` en AWS. Así, si al paquete le falta algo, falla en CI y no en producción. CI lo corre en cada PR.

## Primera vez

1. **Terraform** (`terraform/README.md`): RDS, la usuaria de la app y RDS Proxy. Anota sus salidas.
2. **Llave de idempotencia** en Secrets Manager. Cifra las respuestas guardadas por `Idempotency-Key`, que traen datos financieros:

   ```bash
   aws secretsmanager create-secret --name mincome/backend/idempotency-keys \
     --secret-string "$(openssl rand -base64 48)"
   ```

   Para rotarla, pon la nueva primero y la anterior después, separadas por coma. Cuando pasen 24 horas (lo que dura una llave), quita la anterior.
3. **Rol de despliegue para GitHub (OIDC).** Necesitas el proveedor OIDC `token.actions.githubusercontent.com` en la cuenta (uno por cuenta) y un rol que solo pueda asumir este repo desde el ambiente `production`:

   ```json
   {
     "Effect": "Allow",
     "Principal": { "Federated": "arn:aws:iam::<cuenta>:oidc-provider/token.actions.githubusercontent.com" },
     "Action": "sts:AssumeRoleWithWebIdentity",
     "Condition": {
       "StringEquals": {
         "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
         "token.actions.githubusercontent.com:sub": "repo:RaulHMV/mincome-backend:environment:production"
       }
     }
   }
   ```

   Sus permisos son los que necesita `sam deploy` sobre este stack: CloudFormation, el bucket de SAM en S3, Lambda, API Gateway, IAM (crear los roles del stack), Logs, Scheduler, SQS, SNS, CloudWatch y CodeDeploy. Además, `secretsmanager:GetSecretValue` sobre la llave de idempotencia y `lambda:InvokeFunction` sobre la función, para las migraciones del primer despliegue. Limítalos a los recursos `mincome-backend*` donde se pueda.
4. **Ambiente `production` en GitHub** (Settings → Environments), con revisores obligatorios y estas variables (no son secretos):

   | Variable | De dónde sale |
   |---|---|
   | `AWS_REGION`, `AWS_DEPLOY_ROLE_ARN` | La cuenta y el rol del paso 3 |
   | `PRIVATE_SUBNET_IDS` | `terraform output private_subnet_ids`, separadas por coma |
   | `LAMBDA_SECURITY_GROUP_ID` | `terraform output backend_lambda_security_group_id` |
   | `DATABASE_PROXY_ENDPOINT` | `terraform output database_proxy_endpoint` |
   | `DATABASE_PROXY_RESOURCE_ID` | `terraform output database_proxy_resource_id` |
   | `COGNITO_USER_POOL_ID`, `COGNITO_CLIENT_IDS` | El user pool y los app clients del front (web y móvil) |
   | `WEB_APP_ORIGIN` | Origen del front, por ejemplo `https://app.mincome.mx` |
   | `AI_WRAPPER_ROLE_ARN` | Rol de la Lambda de `mincome-ai-wrapper`; vacío deja cerradas `/internal/*` |
   | `IDEMPOTENCY_KEYS_SECRET_ARN` | El secreto del paso 2 |
   | `ALARM_EMAIL` | Quién recibe las alarmas (opcional) |

5. **Desplegar**: Actions → Deploy → Run workflow.
6. **Trigger de Cognito**: en el user pool, pon como *Post confirmation* la salida `BackendFunctionAliasArn`. Hazlo desde la consola o desde la infraestructura que maneja el pool. Con `aws cognito-idp update-user-pool`, todo lo que no mandes vuelve a su valor por omisión.
7. **mincome-ai-wrapper** agrega su ruta `POST /chat` al mismo API con el export `mincome-backend-HttpApiId`.

## Cada despliegue

1. `sam build` arma el paquete y `sam deploy` publica una versión nueva de la Lambda.
2. CodeDeploy corre el hook *PreTraffic* (`MigrationsHookFunction`). El hook invoca **la versión nueva** con `{"job": "migrate"}` mientras el tráfico sigue en la anterior.
3. Si las migraciones pasan, el alias `live` se mueve a la versión nueva. Si fallan, o si `BackendErrorsAlarm` o `Api5xxAlarm` suenan durante el despliegue, CodeDeploy deja el alias donde estaba.
4. El workflow vuelve a pedir las migraciones (no hace nada si ya están; el primer despliegue no pasa por CodeDeploy) y prueba `GET /api/v1/health`.

Como la versión anterior sigue atendiendo mientras corren las migraciones, cada migración debe ser compatible con el código anterior. Agrega columnas o tablas en un despliegue y quita lo viejo en otro, después.

Para regresar a la versión anterior sin desplegar: `aws lambda update-alias --function-name <BackendFunctionName> --name live --function-version <versión>`.

## Buenas prácticas por servicio

### Lambda

| Práctica | Cómo |
|---|---|
| Paquete mínimo | esbuild con tree-shaking y minificado: ~2.2 MB en zip (arriba) |
| Graviton | `arm64`: más barato por milisegundo que x86 |
| Arranque en frío una vez | La app de Nest y el pool se arman fuera del handler y se reutilizan entre invocaciones (`src/lambda.ts`) |
| Pool chico | 2 conexiones por instancia, sin mínimo: cada instancia atiende una petición a la vez y RDS Proxy reparte. Las e2e pasan con 1 |
| Sin contraseñas | Token IAM para RDS Proxy (`DB_IAM_AUTH`); el rol solo tiene `rds-db:connect` sobre la usuaria de la app |
| Versiones y alias | `AutoPublishAlias: live`: API Gateway, Cognito y Scheduler apuntan al alias, y regresar es mover el alias |
| Despliegue seguro | CodeDeploy con hook de migraciones y rollback automático por alarmas |
| Logs | Una línea JSON por log (Nest), grupo con retención de 30 días. Formato `Text`: el filtro por nivel del formato `JSON` de Lambda no entiende los niveles de Nest |
| Trazas | X-Ray activo; source maps con `NODE_OPTIONS=--enable-source-maps` |
| Concurrencia | `ReservedConcurrency` (parámetro) pone un tope para proteger la base. Por omisión no reserva, porque las cuentas nuevas solo tienen 10 en total |
| Sin URL pública propia | Sin Function URL: solo se entra por API Gateway |

### API Gateway (HTTP API)

| Práctica | Cómo |
|---|---|
| Autenticación en la orilla | Autorizador JWT de Cognito por omisión (issuer y audiencias = app clients) |
| Rutas internas | `/api/v1/internal/*` con IAM; la Lambda además revisa que quien firma sea `AiWrapperRoleArn` |
| CORS sin invocar la Lambda | Un método por ruta (no `ANY`), así API Gateway contesta el preflight `OPTIONS` sin pasar por el autorizador. Orígenes, headers y `MaxAge` explícitos |
| Throttling | 50 req/s sostenidas y ráfagas de 100 (parámetros) |
| Access logs | JSON con id, ruta, estado y latencias; sin correo ni claims |

### RDS y RDS Proxy (`terraform/`)

| Práctica | Cómo |
|---|---|
| Red privada | Sin acceso público. Security groups encadenados: Lambda → proxy → base; los CIDR solo para administrar |
| TLS | El proxy exige TLS y la app verifica el certificado (los de RDS Proxy son de ACM, que Node ya reconoce) |
| Mínimo privilegio | `mincome_app` es dueña de la base, no `rds_superuser`. El proxy lee su contraseña de Secrets Manager; nadie más |
| Protección | `deletion_protection` y snapshot final por omisión; backups de 7 días; almacenamiento cifrado |
| Logs | Exportados a CloudWatch con retención, en vez de grupos que crecen sin fin |
| Alta disponibilidad | `database_multi_az` (apagado por costo; recomendado en producción) |

### Cognito

| Práctica | Cómo |
|---|---|
| Verificar el token una vez | Lo hace API Gateway. La Lambda vuelve a revisar, sin criptografía, issuer, app client y vencimiento (`src/auth/cognito-claims.ts`); sin autorizador responde 401 |
| Trigger acotado | El permiso de invocación solo vale para este user pool (`SourceArn` y `SourceAccount`) |
| No bloquear el alta | Si el trigger falla, lo registra y deja confirmar; `GET /me` crea al usuario después |

### EventBridge Scheduler

| Práctica | Cómo |
|---|---|
| Zona horaria explícita | `cron(15 0 * * ? *)` en `America/Mexico_City` |
| Reintentos y DLQ | 2 reintentos en una hora; si fallan, el evento queda en SQS y suena `DailyJobFailedAlarm` |
| Idempotente | Repetir el proceso no duplica movimientos (índice único por plantilla y fecha) |

### Secretos, IAM y CI/CD

| Práctica | Cómo |
|---|---|
| Sin llaves de AWS en GitHub | OIDC con un rol que solo asume este repo desde `production` |
| Acciones fijadas | Por commit, no por etiqueta (una etiqueta se puede mover) |
| Sin inyección en el shell | Las variables de GitHub pasan por `env:`, no dentro de `run:` |
| Secretos | La llave de idempotencia viene de Secrets Manager. Se resuelve al desplegar y queda cifrada con KMS en la configuración de la Lambda |
| Alarmas | Errores y throttles de la Lambda, 5xx del API y DLQ del proceso diario, a un tema SNS cifrado |

## Pendiente o a decidir

- **Secretos en tiempo de ejecución.** Leer la llave de idempotencia desde Secrets Manager al arrancar, en vez de ponerla en la configuración, necesita un VPC endpoint de Secrets Manager (unos US$7 al mes por zona).
- **NestJS Observe** no puede reportar desde la VPC sin salida a internet. Está apagado mientras no haya `OBSERVE_APP_KEY` y `OBSERVE_APP_SECRET`.
- **Dominio propio** para el API (`api.mincome.mx`) con un certificado de ACM. Después se puede apagar el endpoint `execute-api`.
- **Estado de Terraform** en S3 cifrado con bloqueo (ver `terraform/README.md`).
- **Despliegue gradual** (`Canary10Percent5Minutes`) en vez de `AllAtOnce` cuando haya tráfico real.
