# El user pool de Cognito (requerimientos-backend.md §5): registro con correo
# verificado por código (D12), la política de contraseñas del front, los grupos
# normal y premium, y un app client para la web y otro para el móvil.

locals {
  name       = "mincome-${var.environment}"
  ssm_prefix = "/mincome/${var.environment}/auth"
  clients    = ["web", "mobile"]
}

resource "aws_cognito_user_pool" "main" {
  name                = local.name
  deletion_protection = var.deletion_protection ? "ACTIVE" : "INACTIVE"

  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]

  username_configuration {
    case_sensitive = false
  }

  # Lo mismo que passwordRulesSchema del front (las secuencias y contraseñas
  # comunes las revisa el front).
  password_policy {
    minimum_length                   = 8
    require_lowercase                = true
    require_uppercase                = true
    require_numbers                  = true
    require_symbols                  = true
    temporary_password_validity_days = 3
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  admin_create_user_config {
    allow_admin_create_user_only = false
  }

  # Un cambio de correo no vale hasta que se verifica.
  user_attribute_update_settings {
    attributes_require_verification_before_update = ["email"]
  }

  verification_message_template {
    default_email_option = "CONFIRM_WITH_CODE"
    email_subject        = "Tu código de Mincome"
    email_message        = "Tu código de verificación es {####}"
  }

  # El correo de Cognito manda hasta 50 al día; con más usuarios, SES.
  email_configuration {
    email_sending_account = "COGNITO_DEFAULT"
  }

  mfa_configuration = "OFF"

  schema {
    name                = "email"
    attribute_data_type = "String"
    required            = true
    mutable             = true

    string_attribute_constraints {
      min_length = 5
      max_length = 254
    }
  }

  schema {
    name                = "name"
    attribute_data_type = "String"
    required            = true
    mutable             = true

    string_attribute_constraints {
      min_length = 1
      max_length = 100
    }
  }

  # custom:terminos_version (requerimientos-backend.md §2.7).
  schema {
    name                = "terminos_version"
    attribute_data_type = "String"
    required            = false
    mutable             = true

    string_attribute_constraints {
      min_length = 1
      max_length = 20
    }
  }

  dynamic "lambda_config" {
    for_each = var.post_confirmation_lambda_arn == "" ? [] : [var.post_confirmation_lambda_arn]

    content {
      post_confirmation = lambda_config.value
    }
  }
}

# El grupo decide el plan (requerimientos-backend.md §5); sin grupo es normal.
resource "aws_cognito_user_group" "plan" {
  for_each = {
    premium = { precedence = 1, description = "Plan premium: usa a Piggy" }
    normal  = { precedence = 2, description = "Plan normal" }
  }

  user_pool_id = aws_cognito_user_pool.main.id
  name         = each.key
  precedence   = each.value.precedence
  description  = each.value.description
}

# Clientes públicos (sin secreto): el front usa SRP y nunca manda la contraseña.
resource "aws_cognito_user_pool_client" "app" {
  for_each = toset(local.clients)

  name         = "${local.name}-${each.key}"
  user_pool_id = aws_cognito_user_pool.main.id

  generate_secret               = false
  explicit_auth_flows           = ["ALLOW_USER_SRP_AUTH", "ALLOW_REFRESH_TOKEN_AUTH"]
  prevent_user_existence_errors = "ENABLED"
  enable_token_revocation       = true
  supported_identity_providers  = ["COGNITO"]
  auth_session_validity         = 3

  access_token_validity  = 60
  id_token_validity      = 60
  refresh_token_validity = 30

  token_validity_units {
    access_token  = "minutes"
    id_token      = "minutes"
    refresh_token = "days"
  }

  read_attributes  = ["email", "email_verified", "name", "custom:terminos_version"]
  write_attributes = ["email", "name", "custom:terminos_version"]
}

# Lo que lee el backend.
resource "aws_ssm_parameter" "user_pool_id" {
  name  = "${local.ssm_prefix}/user-pool-id"
  type  = "String"
  value = aws_cognito_user_pool.main.id
}

resource "aws_ssm_parameter" "user_pool_arn" {
  name  = "${local.ssm_prefix}/user-pool-arn"
  type  = "String"
  value = aws_cognito_user_pool.main.arn
}

resource "aws_ssm_parameter" "client_ids" {
  name  = "${local.ssm_prefix}/client-ids"
  type  = "StringList"
  value = join(",", [for client in local.clients : aws_cognito_user_pool_client.app[client].id])
}
