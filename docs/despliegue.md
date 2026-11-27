# Despliegue en AWS

Todo se despliega con **Terraform** desde GitHub Actions, sin llaves de AWS en el repositorio (OIDC). El backend corre en una Lambda dentro de una VPC privada, detrás de API Gateway HTTP API, y llega a RDS PostgreSQL por RDS Proxy.

```text
Front ──JWT──▶ API Gateway ──▶ Lambda mincome-backend (alias live) ──IAM──▶ RDS Proxy ──IAM──▶ RDS
                 │  · /api/v1/* con autorizador JWT de Cognito            (VPC privada, sin NAT)
                 │  · /api/v1/internal/* con IAM (solo mincome-ai-wrapper)
                 │  · /api/v1/health sin autorización
Cognito ──Post confirmation──▶ Lambda
EventBridge Scheduler ──{"job":"daily"}──▶ Lambda
Pipeline ──{"job":"bootstrap"}──▶ Lambda mincome-backend-db-bootstrap (crea mincome_app)
Pipeline ──{"job":"migrate"}──▶ versión nueva, antes de moverle el tráfico
```

## Componentes

Cada componente es un directorio de [`terraform/`](../terraform/README.md) con su propio estado en S3. Se pasan datos entre sí con parámetros de SSM (`/mincome/production/<componente>/…`), así que nadie copia ids a mano.

| Componente | Qué crea | Rol que lo aplica |
|---|---|---|
| `bootstrap` | El bucket del estado, los roles de GitHub, el permissions boundary y el bucket de paquetes | El tuyo (`AWS_BOOTSTRAP_ROLE_ARN`) |
| `network` | VPC con dos subredes privadas, sin salida a internet, y flow logs | `mincome-backend-infra` |
| `database` | RDS, RDS Proxy y los security groups | `mincome-backend-infra` |
| `secrets` | La llave de `Idempotency-Key` | `mincome-backend-infra` |
| `auth` | El user pool de Cognito, sus grupos y los clientes web y móvil | `mincome-backend-infra` |
| `backend` | Las Lambdas, el HTTP API, el proceso diario y las alarmas | `mincome-backend-ci` |

## Pipelines

Todos se corren a mano desde **Actions** y piden una palabra de seguridad, escrita exactamente:

| Acción | Palabra |
|---|---|
| `plan` | ninguna: no cambia nada |
| `apply` (infra) o `deploy` (app) | `deploy` |
| `destroy` | `destroy` |
| `migrate` | `migrate` |
| `rollback` | `rollback` |

| Workflow | Para qué |
|---|---|
| **Bootstrap** | Lo primero, y casi nunca otra vez: los roles y buckets de los demás pipelines. |
| **Deploy all** | Todo de una vez: la infra, la app y otra vez `auth` para conectar el trigger de Cognito. `destroy` va al revés. |
| **Infra** | Un componente de infra o todos (`network`, `database`, `secrets`, `auth`), con `plan`, `apply` o `destroy`. |
| **Backend** | La app: `plan`, `deploy`, `migrate` (con la versión que atiende), `rollback` (a la versión que digas) o `destroy`. |

Además, **CI** corre en cada PR: lint, tipos, pruebas, el paquete de la Lambda, y `terraform fmt` y `validate` de todos los componentes.

### Cómo despliega la app

1. Construye el paquete (`npm run build:lambda`: un solo archivo de ~4 MB, ~2.2 MB en zip) y lo sube a `backend/<commit>.zip`.
2. `terraform apply` del componente `backend` publica una **versión nueva** de la Lambda. El alias `live`, al que apuntan API Gateway, Cognito y el Scheduler, se queda en la anterior: Terraform no lo mueve.
3. Invoca `mincome-backend-db-bootstrap` con `{"job": "bootstrap"}`: crea al usuario `mincome_app` si no existe. Repetirlo no hace nada.
4. Invoca **la versión nueva** con `{"job": "migrate"}` mientras el tráfico sigue en la anterior. Si falla, se detiene ahí y nadie la usa.
5. Mueve `live` a la versión nueva.
6. Prueba `GET /api/v1/health`. Si falla, regresa `live` a la versión anterior.

Como la versión anterior sigue atendiendo mientras corren las migraciones, cada migración debe ser compatible con el código anterior: agrega columnas o tablas en un despliegue y quita lo viejo en otro, después.

Para regresar a una versión sin desplegar: **Backend** → `rollback`, con el número de versión (las ves en la consola de Lambda o en el resumen de cada despliegue).

## Primera vez

1. **Tu rol de bootstrap.** Un rol de IAM que GitHub pueda asumir por OIDC desde este repo y el environment `bootstrap`, con permisos para crear roles y políticas de IAM, buckets de S3 y leer el proveedor OIDC. Si la cuenta todavía no tiene el proveedor `token.actions.githubusercontent.com`, créalo junto con el rol. Su confianza:

   ```json
   {
     "Effect": "Allow",
     "Principal": { "Federated": "arn:aws:iam::<cuenta>:oidc-provider/token.actions.githubusercontent.com" },
     "Action": "sts:AssumeRoleWithWebIdentity",
     "Condition": {
       "StringEquals": {
         "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
         "token.actions.githubusercontent.com:sub": "repo:RaulHMV/mincome-backend:environment:bootstrap"
       }
     }
   }
   ```

2. **GitHub environments** (Settings → Environments):
   - `bootstrap`: variables `AWS_BOOTSTRAP_ROLE_ARN` y `AWS_REGION`, con revisores obligatorios.
   - `production`: revisores obligatorios y las variables de abajo.
3. **Bootstrap** → `apply`, palabra `deploy`. Su resumen trae los dos ARN para el environment `production`.
4. Variables del environment `production` (no son secretos):

   | Variable | Valor |
   |---|---|
   | `AWS_REGION` | La misma del bootstrap (`us-east-1` por omisión) |
   | `AWS_INFRA_ROLE_ARN`, `AWS_CI_ROLE_ARN` | Del resumen del bootstrap |
   | `WEB_APP_ORIGIN` | Origen del front, por ejemplo `https://app.mincome.mx` (opcional) |
   | `AI_WRAPPER_ROLE_ARN` | Rol de la Lambda de mincome-ai-wrapper; vacío deja cerradas `/internal/*` |
   | `ALARM_EMAIL` | Quién recibe las alarmas (opcional) |
   | `DELETION_PROTECTION` | `true`; solo `false` para poder destruir RDS y Cognito |

5. **Deploy all** → `deploy`, palabra `deploy`.
6. El front toma `user_pool_id`, `web_client_id` y `mobile_client_id` de las salidas de `auth`, y la URL del API de las salidas de `backend` (o de `/mincome/production/backend/api-url` en SSM).

## Mínimo privilegio

- **Dos roles para GitHub**, que solo puede asumir este repo desde el environment `production`:
  - `mincome-backend-infra`: su estado (`production/{network,database,secrets,auth}.tfstate`); la VPC, RDS y el proxy de Mincome (borrar o cambiar la red pide la etiqueta `Service=mincome`; la instancia y su grupo de subredes, el nombre `mincome-*`); los secretos `mincome/production/*` y los `rds!*` que crea RDS; Cognito; sus parámetros de SSM y sus grupos de logs.
  - `mincome-backend-ci`: su estado (`production/backend.tfstate`), los paquetes `backend/*`, y solo las Lambdas, colas, temas, alarmas, horarios y grupos de logs `mincome-backend*`. No toca la red, la base ni Cognito.
- **Rutas de IAM separadas**: cada rol solo crea y cambia roles en su ruta (`/mincome/workload/infra/` o `/mincome/workload/backend/`) y ninguno toca `/mincome/pipeline/`, donde viven ellos.
- **Permissions boundary obligatorio** (`mincome-workload-boundary`): todo rol que crean los pipelines lo lleva, y no pueden quitarlo. Aunque alguien escriba una política con `*`, el rol no pasa de logs, X-Ray, interfaces de red, `rds-db:connect`, leer sus secretos e invocar al backend.
- **Las Lambdas**: el backend solo puede conectarse a la base como `mincome_app`; la de bootstrap, como el usuario maestro. Ninguna tiene contraseña de la base.
- Las acciones de todas las políticas se revisaron con un linter de IAM (parliament); las que no aceptan un recurso concreto (crear una VPC, `Describe*`) se limitan a la región.

## Buenas prácticas por servicio

### Lambda

| Práctica | Cómo |
|---|---|
| Paquete mínimo | esbuild con tree-shaking y minificado: ~2.2 MB en zip, sin `node_modules` |
| Graviton | `arm64`: más barato por milisegundo que x86 |
| Arranque en frío una vez | La app de Nest y el pool se arman fuera del handler y se reutilizan (`src/lambda.ts`) |
| Pool chico | 2 conexiones por instancia, sin mínimo: RDS Proxy reparte. Las e2e pasan con 1 |
| Sin contraseñas | IAM de punta a punta con RDS Proxy (`DB_IAM_AUTH`) |
| Versiones y alias | API Gateway, Cognito y el Scheduler apuntan a `live`; regresar es mover el alias |
| Despliegue seguro | Migraciones con la versión nueva antes de moverle el tráfico; smoke test con regreso automático |
| Logs | Una línea JSON por log (Nest), grupo con retención de 30 días |
| Trazas | X-Ray activo; source maps con `NODE_OPTIONS=--enable-source-maps` |
| Concurrencia | `reserved_concurrency` pone un tope para proteger la base (por omisión no reserva) |
| Sin URL pública propia | Sin Function URL: solo se entra por API Gateway |

### API Gateway (HTTP API)

| Práctica | Cómo |
|---|---|
| Autenticación en la orilla | Autorizador JWT de Cognito (issuer y audiencias = los app clients) |
| Rutas internas | `/api/v1/internal/*` con IAM; la Lambda además revisa que quien firma sea `AI_WRAPPER_ROLE_ARN` |
| CORS sin invocar la Lambda | Un método por ruta (no `ANY`): API Gateway contesta el preflight sin pasar por el autorizador |
| Throttling | 50 req/s sostenidas y ráfagas de 100 |
| Access logs | JSON con id, ruta, estado y latencias; sin correo ni claims |

### Red (VPC)

| Práctica | Cómo |
|---|---|
| Sin salida a internet | Solo subredes privadas y la ruta local; sin NAT Gateway (sin costo fijo) |
| Dos zonas | Las subredes en dos AZ: RDS lo pide y la Lambda aguanta que se caiga una |
| SG por omisión cerrado | Sin reglas, para que nadie lo use por descuido |
| Security groups encadenados | Lambda → proxy → base, por referencia y no por rangos de IP |
| Flow logs | Solo el tráfico rechazado, 14 días |

### RDS y RDS Proxy

| Práctica | Cómo |
|---|---|
| Sin contraseñas que manejar | RDS guarda y rota la del usuario maestro en Secrets Manager; `mincome_app` entra con IAM de punta a punta |
| Mínimo privilegio | `mincome_app` es dueña de la base, no `rds_superuser`; el maestro solo lo usa el bootstrap |
| TLS | El proxy lo exige y la app verifica el certificado |
| Protección | `deletion_protection`, snapshot final, backups de 7 días y almacenamiento cifrado |
| Logs | Exportados a CloudWatch con retención |
| Alta disponibilidad | `database_multi_az` (apagado por costo; recomendado con usuarios reales) |

### Cognito

| Práctica | Cómo |
|---|---|
| Correo verificado (D12) | Código por correo; un cambio de correo no vale hasta verificarlo |
| Contraseñas | La misma política que el front (8+, mayúscula, minúscula, número y símbolo) |
| Clientes públicos | Sin secreto, solo SRP y refresh; `prevent_user_existence_errors` y revocación de tokens |
| Protección | `deletion_protection` del pool |
| Trigger acotado | El permiso de invocación solo vale para este pool |

### Secretos, IAM y CI/CD

| Práctica | Cómo |
|---|---|
| Sin llaves de AWS en GitHub | OIDC con roles que solo asume este repo desde su environment |
| Estado de Terraform | S3 cifrado, versionado, solo TLS, sin acceso público y con lock (`use_lockfile`) |
| Llave de idempotencia | Se genera con un valor efímero y se escribe write-only: no queda en el estado de `secrets` |
| Acciones fijadas | Por commit, no por etiqueta |
| Sin inyección en el shell | Las variables de GitHub pasan por `env:`, no dentro de `run:` |
| Alarmas | Errores y throttles de la Lambda, 5xx del API y la DLQ del proceso diario, a un tema SNS cifrado |

## Operación

- **Rotar la llave de idempotencia**: `aws secretsmanager put-secret-value --secret-id mincome/production/backend/idempotency-keys --secret-string "<nueva>,<anterior>"` y **Backend** → `deploy`. Pasadas 24 horas, quita la anterior igual. Terraform no la vuelve a escribir.
- **Destruir RDS o Cognito**: pon `DELETION_PROTECTION=false`, corre **Infra** → `apply` y luego `destroy`. Con la protección prendida, `destroy` falla a propósito.
- **Entrar a la base en una emergencia**: agrega tu red a `admin_cidr_blocks` del componente `database` (necesitas una VPN a la VPC) y usa la contraseña del secreto `rds!…`.

## Pendiente o a decidir

- **La llave de idempotencia queda en el estado de `backend`** (la Lambda la recibe como variable de entorno). Leerla en tiempo de ejecución necesita un VPC endpoint de Secrets Manager (unos US$7 al mes por zona).
- **NestJS Observe** no puede reportar desde la VPC sin salida a internet.
- **Correo de Cognito**: el remitente por omisión manda hasta 50 correos al día; con usuarios reales, SES.
- **Dominio propio** para el API con un certificado de ACM.
- **Proveedores de Terraform en otras plataformas**: los `.terraform.lock.hcl` traen los hashes de Linux. En Windows o macOS, `terraform providers lock -platform=…` antes de commitear.
