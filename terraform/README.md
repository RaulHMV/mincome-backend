# Mincome database Terraform

This directory defines the private PostgreSQL RDS service, the `mincome`
database and its `pgcrypto` extension.

The tables are not managed here. The `cyrilgdn/postgresql` provider has no
`postgresql_table` resource (only a `postgresql_tables` data source), so the
schema lives in the TypeORM migrations under `src/database/migrations` and is
applied with `npm run migration:run` (see the root README).

The PostgreSQL provider needs the RDS endpoint before it can create the logical
database. Apply the RDS service first, then apply the database with the
endpoint returned by Terraform:

```powershell
terraform init
terraform apply -target=aws_db_instance.database
$endpoint = terraform output -raw database_endpoint
terraform apply -var="database_host=$endpoint"
```

Pass the required VPC, subnet, credentials, and allowed CIDR variables through a
non-committed `.tfvars` file or environment variables. Do not store credentials
in the repository.
