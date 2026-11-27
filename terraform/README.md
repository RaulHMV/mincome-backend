# Mincome database Terraform

This directory defines the data layer the backend Lambda uses:

- The private PostgreSQL RDS instance, the `mincome` database and its
  `pgcrypto` extension.
- `mincome_app`, the PostgreSQL user the backend connects as. It owns the
  database (so the migrations can create tables and trusted extensions such as
  `pg_trgm` and `unaccent`) but is not `rds_superuser`.
- An RDS Proxy in front of the instance. The Lambda connects to it with an IAM
  token (`rds-db:connect`), so no database password reaches the Lambda; the
  proxy reads `mincome_app`'s password from Secrets Manager.
- Security groups chained by reference: backend Lambda → proxy → database.
  `database_allowed_cidr_blocks` only opens the database to admin networks.

The tables are not managed here. The `cyrilgdn/postgresql` provider has no
`postgresql_table` resource (only a `postgresql_tables` data source), so the
schema lives in the TypeORM migrations under `src/database/migrations`. In AWS
the deploy runs them by invoking the Lambda with `{"job": "migrate"}` (see
[docs/despliegue.md](../docs/despliegue.md)); locally, `npm run migration:run`.

## Apply

The PostgreSQL provider needs the RDS endpoint before it can create the user
and the logical database, and it must reach the instance from an address in
`database_allowed_cidr_blocks`. Apply the RDS service first, then the rest with
the endpoint returned by Terraform:

```powershell
terraform init
terraform apply -target=aws_db_instance.database
$endpoint = terraform output -raw database_endpoint
terraform apply -var="database_host=$endpoint"
```

Copy `terraform.tfvars.example` to `terraform.tfvars` (ignored by Git) or pass
the variables through the environment. Do not store credentials in the
repository.

The outputs `database_proxy_endpoint`, `database_proxy_resource_id`,
`database_app_username`, `backend_lambda_security_group_id` and
`private_subnet_ids` are the parameters of the SAM stack in `template.yaml`.

## Defaults worth knowing

| Variable | Default | Why |
|---|---|---|
| `database_deletion_protection` | `true` | Set `false` only for throwaway environments. |
| `database_skip_final_snapshot` | `false` | A final snapshot is taken when the instance is deleted. |
| `database_multi_az` | `false` | Turn on in production: a standby in a second AZ, at twice the instance cost. |
| `log_retention_days` | `30` | RDS logs go to CloudWatch log groups with retention instead of growing forever. |

## Pending, outside this directory

- **Remote state.** The state holds the master and app passwords. Keep it in an
  encrypted S3 bucket with locking (`use_lockfile = true`) rather than on a
  laptop.
- **Master password.** It comes from a variable. Moving it to
  `manage_master_user_password` (Secrets Manager with rotation) needs the
  PostgreSQL provider to read it from that secret.
