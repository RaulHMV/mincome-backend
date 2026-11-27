# Terraform de Mincome backend

Toda la infraestructura del backend, en seis componentes independientes. Cada uno tiene su propio estado (`production/<componente>.tfstate` en el bucket `mincome-tfstate-<cuenta>-<región>`) y se puede planear, aplicar o destruir solo. Los pipelines están en [docs/despliegue.md](../docs/despliegue.md).

| Componente | Depende de | Publica en SSM (`/mincome/production/…`) |
|---|---|---|
| [`bootstrap`](bootstrap) | — | — |
| [`network`](network) | — | `network/vpc-id`, `network/private-subnet-ids` |
| [`database`](database) | `network` | `database/proxy-endpoint`, `proxy-resource-id`, `lambda-security-group-id`, `name`, `port`, `app-user`, `master-user` |
| [`secrets`](secrets) | — | — (el secreto `mincome/production/backend/idempotency-keys`) |
| [`auth`](auth) | — (el trigger, de `backend`) | `auth/user-pool-id`, `user-pool-arn`, `client-ids` |
| [`backend`](backend) | `network`, `database`, `secrets`, `auth` | `backend/api-url`, `backend/package` |

Orden para crear: `bootstrap` → `network` → `database` → `secrets` → `auth` → `backend` → `auth` otra vez (para conectar el trigger de Cognito a la Lambda). Para destruir, al revés.

## Correrlo a mano

Lo normal es el pipeline. Para revisar algo desde tu máquina, con credenciales que puedan asumir el rol del componente:

```bash
cd terraform/network
terraform init \
  -backend-config="bucket=mincome-tfstate-<cuenta>-us-east-1" \
  -backend-config="key=production/network.tfstate" \
  -backend-config="region=us-east-1"
terraform plan
```

`backend` además pide `-var package_s3_key=backend/<commit>.zip -var package_sha256=<base64>`: es más fácil desde el pipeline.

## Decisiones

- **Sin el provider de PostgreSQL.** GitHub no llega a la base privada. RDS crea la base (`db_name`) y el job `{"job": "bootstrap"}` de la Lambda, que sí está en la VPC, crea a `mincome_app`.
- **Sin contraseñas.** La del usuario maestro la administra RDS en Secrets Manager (`manage_master_user_password`). `mincome_app` entra con IAM de punta a punta: RDS Proxy con `default_auth_scheme = "IAM_AUTH"`.
- **El estado no guarda la llave de idempotencia** en `secrets` (recurso efímero y `secret_string_wo`). Sí queda en el de `backend`, porque la Lambda la recibe como variable de entorno.
- **Protección contra borrado** de RDS y del user pool, controlada con la variable `deletion_protection` (en el pipeline, `DELETION_PROTECTION` del environment).
- **Etiquetas por omisión** (`Service`, `Environment`, `Component`, `ManagedBy`) en todo: el rol de infra solo puede borrar red con `Service=mincome`.
- **Versiones fijas**: Terraform `>= 1.11` (en el pipeline, 1.17.2) y el provider de AWS `~> 6.72.0`, con su `.terraform.lock.hcl` en cada componente.
