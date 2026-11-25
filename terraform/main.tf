# Las reglas van en recursos aparte (proxy.tf y aquí): mezclar reglas inline
# con aws_vpc_security_group_*_rule hace que se borren entre sí en cada apply.
# Sin regla de salida: los security groups son stateful y RDS no inicia
# conexiones.
resource "aws_security_group" "database" {
  name        = "mincome-database"
  description = "Private PostgreSQL access for Mincome."
  vpc_id      = var.vpc_id

  tags = {
    Name    = "mincome-database"
    Service = "mincome"
  }
}

# Administración: desde donde corre Terraform (el provider de PostgreSQL) o
# una VPN. La Lambda no entra por aquí, sino por el RDS Proxy.
resource "aws_vpc_security_group_ingress_rule" "database_admin" {
  for_each = toset(var.database_allowed_cidr_blocks)

  security_group_id = aws_security_group.database.id
  description       = "PostgreSQL from an approved admin network"
  ip_protocol       = "tcp"
  from_port         = var.database_port
  to_port           = var.database_port
  cidr_ipv4         = each.value
}

resource "aws_db_subnet_group" "database" {
  name       = "mincome-database"
  subnet_ids = var.private_subnet_ids

  tags = {
    Name    = "mincome-database"
    Service = "mincome"
  }
}

resource "aws_db_instance" "database" {
  identifier              = "mincome-postgresql"
  engine                  = "postgres"
  engine_version          = "16"
  instance_class          = var.database_instance_class
  allocated_storage       = var.database_storage_gb
  max_allocated_storage   = var.database_storage_gb * 2
  storage_type            = "gp3"
  db_name                 = null
  username                = var.database_admin_username
  password                = var.database_admin_password
  port                    = var.database_port
  db_subnet_group_name    = aws_db_subnet_group.database.name
  vpc_security_group_ids  = [aws_security_group.database.id]
  publicly_accessible     = false
  storage_encrypted       = true
  backup_retention_period = 7
  copy_tags_to_snapshot   = true
  multi_az                = var.database_multi_az

  auto_minor_version_upgrade = true
  # Los logs van a un grupo con retención (abajo), no a uno que crece sin fin.
  enabled_cloudwatch_logs_exports = ["postgresql", "upgrade"]

  # En dev se pueden apagar con variables; en producción, protegida y con
  # snapshot final al borrarla.
  deletion_protection       = var.database_deletion_protection
  skip_final_snapshot       = var.database_skip_final_snapshot
  final_snapshot_identifier = var.database_skip_final_snapshot ? null : "mincome-postgresql-final"

  tags = {
    Name    = "mincome-postgresql"
    Service = "mincome"
  }

  depends_on = [aws_cloudwatch_log_group.database]
}

resource "aws_cloudwatch_log_group" "database" {
  for_each = toset(["postgresql", "upgrade"])

  name              = "/aws/rds/instance/mincome-postgresql/${each.value}"
  retention_in_days = var.log_retention_days

  tags = {
    Service = "mincome"
  }
}

# La dueña es la usuaria de la app, no la maestra: así las migraciones crean
# tablas y extensiones confiables (pg_trgm, unaccent) sin rds_superuser.
resource "postgresql_database" "mincome" {
  name              = var.database_name
  owner             = postgresql_role.app.name
  template          = "template0"
  encoding          = "UTF8"
  lc_collate        = "C"
  lc_ctype          = "C"
  connection_limit  = -1
  allow_connections = true

  depends_on = [aws_db_instance.database]
}

resource "postgresql_extension" "pgcrypto" {
  name     = "pgcrypto"
  database = postgresql_database.mincome.name
}
