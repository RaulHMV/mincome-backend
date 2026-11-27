# RDS PostgreSQL privado detrás de RDS Proxy.
#
# - Nadie conoce una contraseña: RDS guarda la del usuario maestro en Secrets
#   Manager y la rota; mincome_app entra con IAM de punta a punta (Lambda ->
#   proxy -> base).
# - El usuario maestro solo lo usa el job {"job": "bootstrap"}, por el proxy,
#   para crear mincome_app. GitHub no llega a la base privada, así que eso no
#   puede hacerlo Terraform.
# - Security groups encadenados: Lambda -> proxy -> base.

data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}
data "aws_region" "current" {}

data "aws_ssm_parameter" "vpc_id" {
  name = "/mincome/${var.environment}/network/vpc-id"
}

data "aws_ssm_parameter" "private_subnet_ids" {
  name = "/mincome/${var.environment}/network/private-subnet-ids"
}

locals {
  name         = "mincome-${var.environment}"
  identifier   = "${local.name}-postgresql"
  vpc_id       = data.aws_ssm_parameter.vpc_id.value
  subnet_ids   = split(",", data.aws_ssm_parameter.private_subnet_ids.value)
  account      = data.aws_caller_identity.current.account_id
  arn          = "arn:${data.aws_partition.current.partition}"
  ssm_prefix   = "/mincome/${var.environment}/database"
  boundary_arn = "${local.arn}:iam::${local.account}:policy/mincome/mincome-workload-boundary"
}

# ------------------------------------------------------------ Security groups

resource "aws_security_group" "backend_lambda" {
  name        = "${local.name}-backend-lambda"
  description = "Mincome backend Lambda: only reaches the RDS Proxy."
  vpc_id      = local.vpc_id

  tags = {
    Name = "${local.name}-backend-lambda"
  }
}

resource "aws_security_group" "database_proxy" {
  name        = "${local.name}-database-proxy"
  description = "RDS Proxy between the Mincome backend Lambda and PostgreSQL."
  vpc_id      = local.vpc_id

  tags = {
    Name = "${local.name}-database-proxy"
  }
}

# Sin regla de salida: los security groups son stateful y RDS no inicia conexiones.
resource "aws_security_group" "database" {
  name        = "${local.name}-database"
  description = "Private PostgreSQL for Mincome."
  vpc_id      = local.vpc_id

  tags = {
    Name = "${local.name}-database"
  }
}

resource "aws_vpc_security_group_egress_rule" "backend_lambda_to_proxy" {
  security_group_id            = aws_security_group.backend_lambda.id
  description                  = "PostgreSQL to the RDS Proxy"
  ip_protocol                  = "tcp"
  from_port                    = var.database_port
  to_port                      = var.database_port
  referenced_security_group_id = aws_security_group.database_proxy.id
}

resource "aws_vpc_security_group_ingress_rule" "proxy_from_backend_lambda" {
  security_group_id            = aws_security_group.database_proxy.id
  description                  = "PostgreSQL from the backend Lambda"
  ip_protocol                  = "tcp"
  from_port                    = var.database_port
  to_port                      = var.database_port
  referenced_security_group_id = aws_security_group.backend_lambda.id
}

resource "aws_vpc_security_group_egress_rule" "proxy_to_database" {
  security_group_id            = aws_security_group.database_proxy.id
  description                  = "PostgreSQL to the RDS instance"
  ip_protocol                  = "tcp"
  from_port                    = var.database_port
  to_port                      = var.database_port
  referenced_security_group_id = aws_security_group.database.id
}

resource "aws_vpc_security_group_ingress_rule" "database_from_proxy" {
  security_group_id            = aws_security_group.database.id
  description                  = "PostgreSQL from the RDS Proxy"
  ip_protocol                  = "tcp"
  from_port                    = var.database_port
  to_port                      = var.database_port
  referenced_security_group_id = aws_security_group.database_proxy.id
}

resource "aws_vpc_security_group_ingress_rule" "database_admin" {
  for_each = toset(var.admin_cidr_blocks)

  security_group_id = aws_security_group.database.id
  description       = "PostgreSQL from an approved admin network"
  ip_protocol       = "tcp"
  from_port         = var.database_port
  to_port           = var.database_port
  cidr_ipv4         = each.value
}

# ------------------------------------------------------------------------ RDS

resource "aws_db_subnet_group" "database" {
  name       = local.name
  subnet_ids = local.subnet_ids
}

resource "aws_cloudwatch_log_group" "database" {
  for_each = toset(["postgresql", "upgrade"])

  name              = "/aws/rds/instance/${local.identifier}/${each.value}"
  retention_in_days = var.log_retention_days
}

# Un nombre nuevo por instancia: un segundo destroy no choca con el snapshot
# final del primero.
resource "random_id" "final_snapshot" {
  byte_length = 4

  keepers = {
    identifier = local.identifier
  }
}

resource "aws_db_instance" "database" {
  identifier            = local.identifier
  engine                = "postgres"
  engine_version        = "16"
  instance_class        = var.database_instance_class
  allocated_storage     = var.database_storage_gb
  max_allocated_storage = var.database_storage_gb * 2
  storage_type          = "gp3"
  storage_encrypted     = true

  # RDS crea la base; las tablas las crean las migraciones.
  db_name                             = var.database_name
  username                            = var.database_master_username
  manage_master_user_password         = true
  iam_database_authentication_enabled = true

  port                   = var.database_port
  db_subnet_group_name   = aws_db_subnet_group.database.name
  vpc_security_group_ids = [aws_security_group.database.id]
  publicly_accessible    = false
  ca_cert_identifier     = "rds-ca-rsa2048-g1"

  multi_az                   = var.database_multi_az
  backup_retention_period    = 7
  copy_tags_to_snapshot      = true
  auto_minor_version_upgrade = true

  enabled_cloudwatch_logs_exports = ["postgresql", "upgrade"]

  deletion_protection       = var.deletion_protection
  skip_final_snapshot       = var.skip_final_snapshot
  final_snapshot_identifier = var.skip_final_snapshot ? null : "${local.identifier}-final-${random_id.final_snapshot.hex}"

  depends_on = [aws_cloudwatch_log_group.database]
}

# ------------------------------------------------------------------ RDS Proxy

data "aws_iam_policy_document" "proxy_trust" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["rds.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [local.account]
    }
  }
}

resource "aws_iam_role" "proxy" {
  name                 = "${local.name}-rds-proxy"
  path                 = "/mincome/workload/infra/"
  assume_role_policy   = data.aws_iam_policy_document.proxy_trust.json
  permissions_boundary = local.boundary_arn
}

data "aws_iam_policy_document" "proxy" {
  # mincome_app: el proxy entra a la base con IAM, sin secreto.
  statement {
    sid       = "ConnectAsAppUserWithIam"
    actions   = ["rds-db:connect"]
    resources = ["${local.arn}:rds-db:${data.aws_region.current.region}:${local.account}:dbuser:${aws_db_instance.database.resource_id}/${var.database_app_username}"]
  }

  # El usuario maestro, solo para el bootstrap: su secreto lo administra RDS.
  statement {
    sid       = "ReadMasterSecret"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [aws_db_instance.database.master_user_secret[0].secret_arn]
  }
}

resource "aws_iam_role_policy" "proxy" {
  name   = "connect-to-database"
  role   = aws_iam_role.proxy.id
  policy = data.aws_iam_policy_document.proxy.json
}

resource "aws_db_proxy" "database" {
  name                   = local.name
  engine_family          = "POSTGRESQL"
  role_arn               = aws_iam_role.proxy.arn
  vpc_subnet_ids         = local.subnet_ids
  vpc_security_group_ids = [aws_security_group.database_proxy.id]
  require_tls            = true
  idle_client_timeout    = 1800
  debug_logging          = false

  # IAM de punta a punta para todo usuario sin secreto registrado (mincome_app).
  default_auth_scheme = "IAM_AUTH"

  auth {
    description               = "Master user, only for the bootstrap job"
    auth_scheme               = "SECRETS"
    iam_auth                  = "REQUIRED"
    client_password_auth_type = "POSTGRES_SCRAM_SHA_256"
    secret_arn                = aws_db_instance.database.master_user_secret[0].secret_arn
  }

  depends_on = [aws_iam_role_policy.proxy]
}

resource "aws_db_proxy_default_target_group" "database" {
  db_proxy_name = aws_db_proxy.database.name

  connection_pool_config {
    # Deja conexiones libres para entrar a la base sin pasar por el proxy.
    max_connections_percent      = 90
    max_idle_connections_percent = 50
    connection_borrow_timeout    = 120
  }
}

resource "aws_db_proxy_target" "database" {
  db_proxy_name          = aws_db_proxy.database.name
  target_group_name      = aws_db_proxy_default_target_group.database.name
  db_instance_identifier = aws_db_instance.database.identifier
}

# ---------------------------------------------------- Lo que lee el backend

locals {
  parameters = {
    "proxy-endpoint"           = aws_db_proxy.database.endpoint
    "proxy-resource-id"        = element(split(":", aws_db_proxy.database.arn), 6)
    "lambda-security-group-id" = aws_security_group.backend_lambda.id
    "name"                     = var.database_name
    "port"                     = tostring(var.database_port)
    "app-user"                 = var.database_app_username
    "master-user"              = var.database_master_username
  }
}

resource "aws_ssm_parameter" "database" {
  for_each = local.parameters

  name  = "${local.ssm_prefix}/${each.key}"
  type  = "String"
  value = each.value
}
