# La app: la Lambda de NestJS detrás de API Gateway HTTP API, la Lambda que
# crea al usuario de la base, el proceso diario y las alarmas. Lo aplica
# mincome-backend-ci con cada despliegue.
#
# Terraform publica una versión nueva de la Lambda pero no mueve el alias
# live: el pipeline primero corre las migraciones con esa versión y solo
# entonces mueve el alias (docs/despliegue.md). API Gateway, Cognito y el
# Scheduler siempre apuntan al alias.

data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}
data "aws_region" "current" {}

data "aws_ssm_parameters_by_path" "infra" {
  for_each = toset(["network", "database", "auth"])

  path = "/mincome/${var.environment}/${each.key}"
}

data "aws_secretsmanager_secret_version" "idempotency_keys" {
  secret_id = "mincome/${var.environment}/backend/idempotency-keys"
}

locals {
  account   = data.aws_caller_identity.current.account_id
  region    = data.aws_region.current.region
  arn       = "arn:${data.aws_partition.current.partition}"
  artifacts = "${var.stack_name}-artifacts-${local.account}-${local.region}"

  # /mincome/production/database/proxy-endpoint -> database.proxy-endpoint
  infra = merge([
    for component, parameters in data.aws_ssm_parameters_by_path.infra : {
      for index, name in parameters.names :
      "${component}.${element(reverse(split("/", name)), 0)}" => parameters.values[index]
    }
  ]...)

  subnet_ids     = split(",", local.infra["network.private-subnet-ids"])
  client_ids     = split(",", local.infra["auth.client-ids"])
  user_pool_id   = local.infra["auth.user-pool-id"]
  proxy_db_user  = "${local.arn}:rds-db:${local.region}:${local.account}:dbuser:${local.infra["database.proxy-resource-id"]}"
  cognito_issuer = "https://cognito-idp.${split("_", local.user_pool_id)[0]}.amazonaws.com/${local.user_pool_id}"
  cors_origins   = compact([var.web_app_origin, "capacitor://localhost", "https://localhost"])
  boundary_arn   = "${local.arn}:iam::${local.account}:policy/mincome/mincome-workload-boundary"
  role_path      = "/mincome/workload/backend/"
  bootstrap_name = "${var.stack_name}-db-bootstrap"
  ssm_backend    = "/mincome/${var.environment}/backend"
  lambda_runtime = "nodejs24.x"
  lambda_handler = "lambda.handler"
  lambda_arch    = ["arm64"]

  # Lo que comparten las dos Lambdas; src/config/app-config.ts lo valida al arrancar.
  common_environment = {
    NODE_ENV                    = "production"
    NODE_OPTIONS                = "--enable-source-maps"
    AUTH_MODE                   = "api-gateway"
    DB_HOST                     = local.infra["database.proxy-endpoint"]
    DB_PORT                     = local.infra["database.port"]
    DB_NAME                     = local.infra["database.name"]
    DB_IAM_AUTH                 = "true"
    DB_SSL                      = "true"
    COGNITO_USER_POOL_ID        = local.user_pool_id
    COGNITO_CLIENT_IDS          = join(",", local.client_ids)
    CORS_ORIGINS                = join(",", local.cors_origins)
    INTERNAL_CALLER_ROLE_ARNS   = var.ai_wrapper_role_arn
    IDEMPOTENCY_ENCRYPTION_KEYS = data.aws_secretsmanager_secret_version.idempotency_keys.secret_string
  }
}

# ---------------------------------------------------------------- Roles

data "aws_iam_policy_document" "lambda_trust" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

# Logs, interfaces de red de la VPC y X-Ray; cada Lambda agrega su usuario de la base.
data "aws_iam_policy_document" "lambda_base" {
  for_each = {
    backend   = aws_cloudwatch_log_group.backend.arn
    bootstrap = aws_cloudwatch_log_group.bootstrap.arn
  }

  statement {
    sid       = "Logs"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${each.value}:*"]
  }

  statement {
    sid = "VpcNetworkInterfaces"
    actions = [
      "ec2:AssignPrivateIpAddresses",
      "ec2:CreateNetworkInterface",
      "ec2:DeleteNetworkInterface",
      "ec2:DescribeNetworkInterfaces",
      "ec2:UnassignPrivateIpAddresses",
    ]
    resources = ["*"]
  }

  statement {
    sid       = "Tracing"
    actions   = ["xray:PutTraceSegments", "xray:PutTelemetryRecords"]
    resources = ["*"]
  }

  # Token IAM para RDS Proxy: la Lambda no tiene contraseña de la base.
  statement {
    sid     = "ConnectToDatabase"
    actions = ["rds-db:connect"]
    resources = [
      each.key == "backend"
      ? "${local.proxy_db_user}/${local.infra["database.app-user"]}"
      : "${local.proxy_db_user}/${local.infra["database.master-user"]}"
    ]
  }
}

resource "aws_iam_role" "backend" {
  name                 = var.stack_name
  path                 = local.role_path
  assume_role_policy   = data.aws_iam_policy_document.lambda_trust.json
  permissions_boundary = local.boundary_arn
}

resource "aws_iam_role_policy" "backend" {
  name   = "backend"
  role   = aws_iam_role.backend.id
  policy = data.aws_iam_policy_document.lambda_base["backend"].json
}

# Entra como el usuario maestro: es la única que puede crear a mincome_app.
resource "aws_iam_role" "bootstrap" {
  name                 = local.bootstrap_name
  path                 = local.role_path
  assume_role_policy   = data.aws_iam_policy_document.lambda_trust.json
  permissions_boundary = local.boundary_arn
}

resource "aws_iam_role_policy" "bootstrap" {
  name   = "db-bootstrap"
  role   = aws_iam_role.bootstrap.id
  policy = data.aws_iam_policy_document.lambda_base["bootstrap"].json
}

# ------------------------------------------------------------- Lambdas

resource "aws_cloudwatch_log_group" "backend" {
  name              = "/aws/lambda/${var.stack_name}"
  retention_in_days = var.log_retention_days
}

resource "aws_cloudwatch_log_group" "bootstrap" {
  name              = "/aws/lambda/${local.bootstrap_name}"
  retention_in_days = var.log_retention_days
}

resource "aws_lambda_function" "backend" {
  function_name = var.stack_name
  description   = "mincome-backend: API, Cognito trigger and jobs"
  role          = aws_iam_role.backend.arn
  runtime       = local.lambda_runtime
  handler       = local.lambda_handler
  architectures = local.lambda_arch
  memory_size   = var.memory_mb
  # API Gateway corta a los 30 s; el margen es para {"job": "daily"} y las migraciones.
  timeout = 60

  # Solo lambda.js, su source map y las licencias (scripts/bundle-lambda.mjs).
  s3_bucket        = local.artifacts
  s3_key           = var.package_s3_key
  source_code_hash = var.package_sha256
  publish          = true

  reserved_concurrent_executions = var.reserved_concurrency

  vpc_config {
    subnet_ids         = local.subnet_ids
    security_group_ids = [local.infra["database.lambda-security-group-id"]]
  }

  tracing_config {
    mode = "Active"
  }

  # Texto: la app ya escribe una línea JSON por log, y el filtro por nivel del
  # formato JSON de Lambda no entiende los niveles de Nest.
  logging_config {
    log_format = "Text"
    log_group  = aws_cloudwatch_log_group.backend.name
  }

  environment {
    variables = merge(local.common_environment, {
      DB_USER = local.infra["database.app-user"]
    })
  }

  depends_on = [aws_iam_role_policy.backend]
}

# El pipeline mueve el alias después de las migraciones; Terraform solo lo crea.
resource "aws_lambda_alias" "live" {
  name             = "live"
  function_name    = aws_lambda_function.backend.function_name
  function_version = aws_lambda_function.backend.version

  lifecycle {
    ignore_changes = [function_version]
  }
}

# {"job": "bootstrap"}: crea a mincome_app, le da rds_iam y la hace dueña de la
# base. Idempotente; el pipeline la corre en cada despliegue.
resource "aws_lambda_function" "bootstrap" {
  function_name = local.bootstrap_name
  description   = "Creates the mincome_app database user (idempotent)"
  role          = aws_iam_role.bootstrap.arn
  runtime       = local.lambda_runtime
  handler       = local.lambda_handler
  architectures = local.lambda_arch
  memory_size   = 512
  timeout       = 60

  s3_bucket        = local.artifacts
  s3_key           = var.package_s3_key
  source_code_hash = var.package_sha256

  vpc_config {
    subnet_ids         = local.subnet_ids
    security_group_ids = [local.infra["database.lambda-security-group-id"]]
  }

  logging_config {
    log_format = "Text"
    log_group  = aws_cloudwatch_log_group.bootstrap.name
  }

  environment {
    variables = merge(local.common_environment, {
      DB_USER              = local.infra["database.master-user"]
      DB_APP_USER          = local.infra["database.app-user"]
      DB_BOOTSTRAP_ENABLED = "true"
    })
  }

  depends_on = [aws_iam_role_policy.bootstrap]
}

# --------------------------------------------------------- API Gateway

resource "aws_apigatewayv2_api" "http" {
  name          = var.stack_name
  description   = "Mincome API"
  protocol_type = "HTTP"

  # API Gateway contesta el preflight: por eso las rutas van por método y no ANY.
  cors_configuration {
    allow_origins  = local.cors_origins
    allow_methods  = ["GET", "POST", "PUT", "PATCH", "DELETE"]
    allow_headers  = ["authorization", "content-type", "idempotency-key"]
    expose_headers = ["idempotent-replayed", "retry-after"]
    max_age        = 600
  }
}

resource "aws_apigatewayv2_authorizer" "cognito" {
  api_id           = aws_apigatewayv2_api.http.id
  name             = "cognito"
  authorizer_type  = "JWT"
  identity_sources = ["$request.header.Authorization"]

  jwt_configuration {
    issuer   = local.cognito_issuer
    audience = local.client_ids
  }
}

resource "aws_apigatewayv2_integration" "backend" {
  api_id                 = aws_apigatewayv2_api.http.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_alias.live.invoke_arn
  integration_method     = "POST"
  payload_format_version = "2.0"
  timeout_milliseconds   = 29000
}

locals {
  # Un método por ruta: con ANY, el preflight OPTIONS chocaría con el autorizador.
  routes = merge(
    { for method in ["GET", "POST", "PUT", "PATCH", "DELETE"] : "${method} /api/v1/{proxy+}" => "JWT" },
    { "GET /api/v1/health" = "NONE" },
    # Solo mincome-ai-wrapper, firmando con IAM (contrato §3.8).
    { for method in ["POST", "PATCH"] : "${method} /api/v1/internal/{proxy+}" => "AWS_IAM" },
  )
}

resource "aws_apigatewayv2_route" "backend" {
  for_each = local.routes

  api_id             = aws_apigatewayv2_api.http.id
  route_key          = each.key
  target             = "integrations/${aws_apigatewayv2_integration.backend.id}"
  authorization_type = each.value
  authorizer_id      = each.value == "JWT" ? aws_apigatewayv2_authorizer.cognito.id : null
}

resource "aws_cloudwatch_log_group" "api_access" {
  name              = "/aws/apigateway/${var.stack_name}-access"
  retention_in_days = var.log_retention_days
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.http.id
  name        = "$default"
  auto_deploy = true

  default_route_settings {
    throttling_rate_limit  = var.api_throttling_rate_limit
    throttling_burst_limit = var.api_throttling_burst_limit
  }

  # Sin datos personales: ni correo ni claims.
  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.api_access.arn
    format = jsonencode({
      requestId            = "$context.requestId"
      ip                   = "$context.identity.sourceIp"
      time                 = "$context.requestTime"
      routeKey             = "$context.routeKey"
      status               = "$context.status"
      latencyMs            = "$context.responseLatency"
      integrationLatencyMs = "$context.integrationLatency"
      responseLength       = "$context.responseLength"
      authorizerError      = "$context.authorizer.error"
      integrationError     = "$context.integrationErrorMessage"
    })
  }
}

resource "aws_lambda_permission" "api" {
  statement_id  = "AllowHttpApi"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.backend.function_name
  qualifier     = aws_lambda_alias.live.name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.http.execution_arn}/*/*"
}

# El trigger se conecta en el componente auth; esto solo deja a ese pool invocarla.
resource "aws_lambda_permission" "cognito" {
  statement_id   = "AllowCognitoPostConfirmation"
  action         = "lambda:InvokeFunction"
  function_name  = aws_lambda_function.backend.function_name
  qualifier      = aws_lambda_alias.live.name
  principal      = "cognito-idp.amazonaws.com"
  source_arn     = local.infra["auth.user-pool-arn"]
  source_account = local.account
}

# ------------------------------------------------------- Proceso diario

resource "aws_sqs_queue" "daily_job_dlq" {
  name                      = "${var.stack_name}-daily-job-dlq"
  sqs_managed_sse_enabled   = true
  message_retention_seconds = 1209600
}

data "aws_iam_policy_document" "scheduler_trust" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["scheduler.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [local.account]
    }
  }
}

resource "aws_iam_role" "scheduler" {
  name                 = "${var.stack_name}-scheduler"
  path                 = local.role_path
  assume_role_policy   = data.aws_iam_policy_document.scheduler_trust.json
  permissions_boundary = local.boundary_arn
}

data "aws_iam_policy_document" "scheduler" {
  statement {
    actions   = ["lambda:InvokeFunction"]
    resources = [aws_lambda_alias.live.arn]
  }

  statement {
    actions   = ["sqs:SendMessage"]
    resources = [aws_sqs_queue.daily_job_dlq.arn]
  }
}

resource "aws_iam_role_policy" "scheduler" {
  name   = "invoke-daily-job"
  role   = aws_iam_role.scheduler.id
  policy = data.aws_iam_policy_document.scheduler.json
}

# Recurrentes y limpieza de llaves de idempotencia (§3.7), poco después de
# medianoche en la zona por omisión de los usuarios.
resource "aws_scheduler_schedule" "daily" {
  name                         = "${var.stack_name}-daily-job"
  description                  = "mincome-backend daily job"
  schedule_expression          = "cron(15 0 * * ? *)"
  schedule_expression_timezone = "America/Mexico_City"

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = aws_lambda_alias.live.arn
    role_arn = aws_iam_role.scheduler.arn
    input    = jsonencode({ job = "daily" })

    retry_policy {
      maximum_retry_attempts       = 2
      maximum_event_age_in_seconds = 3600
    }

    # Si los reintentos fallan, el evento queda aquí y suena la alarma.
    dead_letter_config {
      arn = aws_sqs_queue.daily_job_dlq.arn
    }
  }

  depends_on = [aws_iam_role_policy.scheduler]
}

# ------------------------------------------------------------- Alarmas

resource "aws_sns_topic" "alarms" {
  name              = "${var.stack_name}-alarms"
  kms_master_key_id = "alias/aws/sns"
}

resource "aws_sns_topic_subscription" "email" {
  count = var.alarm_email == "" ? 0 : 1

  topic_arn = aws_sns_topic.alarms.arn
  protocol  = "email"
  endpoint  = var.alarm_email
}

locals {
  alarms = {
    errors = {
      description = "The backend Lambda threw errors (unhandled, timeouts or out of memory)."
      namespace   = "AWS/Lambda"
      metric      = "Errors"
      dimensions  = { FunctionName = aws_lambda_function.backend.function_name }
      statistic   = "Sum"
      threshold   = 1
    }
    throttles = {
      description = "The backend Lambda ran out of concurrency."
      namespace   = "AWS/Lambda"
      metric      = "Throttles"
      dimensions  = { FunctionName = aws_lambda_function.backend.function_name }
      statistic   = "Sum"
      threshold   = 1
    }
    api-5xx = {
      description = "The API answered 5xx (internal_error, Lambda failures or timeouts)."
      namespace   = "AWS/ApiGateway"
      metric      = "5xx"
      dimensions  = { ApiId = aws_apigatewayv2_api.http.id }
      statistic   = "Sum"
      threshold   = 5
    }
    daily-job-failed = {
      description = "The daily job failed after its retries; its event is in the dead-letter queue."
      namespace   = "AWS/SQS"
      metric      = "ApproximateNumberOfMessagesVisible"
      dimensions  = { QueueName = aws_sqs_queue.daily_job_dlq.name }
      statistic   = "Maximum"
      threshold   = 1
    }
  }
}

resource "aws_cloudwatch_metric_alarm" "backend" {
  for_each = local.alarms

  alarm_name          = "${var.stack_name}-${each.key}"
  alarm_description   = each.value.description
  namespace           = each.value.namespace
  metric_name         = each.value.metric
  dimensions          = each.value.dimensions
  statistic           = each.value.statistic
  period              = 300
  evaluation_periods  = 1
  threshold           = each.value.threshold
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alarms.arn]
}

# ----------------------------------------------- Lo que leen los demás

resource "aws_ssm_parameter" "api_url" {
  name  = "${local.ssm_backend}/api-url"
  type  = "String"
  value = "${aws_apigatewayv2_api.http.api_endpoint}/api/v1"
}

# El paquete desplegado: el pipeline lo usa para un plan o un destroy sin volver a construir.
resource "aws_ssm_parameter" "package" {
  name  = "${local.ssm_backend}/package"
  type  = "String"
  value = jsonencode({ key = var.package_s3_key, sha256 = var.package_sha256 })
}
