# Lambda del backend -> RDS Proxy -> RDS.
#
# - Security groups encadenados (no bloques CIDR): solo la Lambda llega al
#   proxy y solo el proxy a la base.
# - La Lambda entra al proxy con un token IAM (rds-db:connect), sin
#   contraseña. El proxy entra a la base con el secreto de la usuaria de la app.
# - El proxy reutiliza las conexiones entre invocaciones de Lambda para no
#   agotar las de la base.

resource "aws_security_group" "backend_lambda" {
  name        = "mincome-backend-lambda"
  description = "Mincome backend Lambda: only reaches the RDS Proxy."
  vpc_id      = var.vpc_id

  tags = {
    Name    = "mincome-backend-lambda"
    Service = "mincome"
  }
}

resource "aws_security_group" "database_proxy" {
  name        = "mincome-database-proxy"
  description = "RDS Proxy between the Mincome backend Lambda and PostgreSQL."
  vpc_id      = var.vpc_id

  tags = {
    Name    = "mincome-database-proxy"
    Service = "mincome"
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

# Usuaria de la app: dueña de la base, sin superuser ni createrole.
resource "random_password" "app_database" {
  length = 40
  # Sin símbolos para no pelear con escapes en cadenas de conexión.
  special = false
}

resource "postgresql_role" "app" {
  name     = var.database_app_username
  login    = true
  password = random_password.app_database.result
}

# Lo lee solo el RDS Proxy; la Lambda no.
resource "aws_secretsmanager_secret" "app_database" {
  name                    = "mincome/database/${var.database_app_username}"
  description             = "Credentials RDS Proxy uses to connect to PostgreSQL as the Mincome app user."
  recovery_window_in_days = 7

  tags = {
    Service = "mincome"
  }
}

resource "aws_secretsmanager_secret_version" "app_database" {
  secret_id = aws_secretsmanager_secret.app_database.id
  secret_string = jsonencode({
    username = postgresql_role.app.name
    password = random_password.app_database.result
  })
}

data "aws_iam_policy_document" "database_proxy_assume" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["rds.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "database_proxy" {
  name               = "mincome-database-proxy"
  assume_role_policy = data.aws_iam_policy_document.database_proxy_assume.json

  tags = {
    Service = "mincome"
  }
}

data "aws_iam_policy_document" "database_proxy_secret" {
  statement {
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [aws_secretsmanager_secret.app_database.arn]
  }
}

resource "aws_iam_role_policy" "database_proxy_secret" {
  name   = "read-app-database-secret"
  role   = aws_iam_role.database_proxy.id
  policy = data.aws_iam_policy_document.database_proxy_secret.json
}

resource "aws_db_proxy" "database" {
  name                   = "mincome-database"
  engine_family          = "POSTGRESQL"
  role_arn               = aws_iam_role.database_proxy.arn
  vpc_subnet_ids         = var.private_subnet_ids
  vpc_security_group_ids = [aws_security_group.database_proxy.id]
  require_tls            = true
  idle_client_timeout    = 1800
  debug_logging          = false

  auth {
    description               = "Mincome app user"
    auth_scheme               = "SECRETS"
    iam_auth                  = "REQUIRED"
    client_password_auth_type = "POSTGRES_SCRAM_SHA_256"
    secret_arn                = aws_secretsmanager_secret.app_database.arn
  }

  tags = {
    Name    = "mincome-database"
    Service = "mincome"
  }

  depends_on = [
    aws_secretsmanager_secret_version.app_database,
    aws_iam_role_policy.database_proxy_secret,
  ]
}

resource "aws_db_proxy_default_target_group" "database" {
  db_proxy_name = aws_db_proxy.database.name

  connection_pool_config {
    # Deja conexiones libres para administrar la base sin pasar por el proxy.
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
