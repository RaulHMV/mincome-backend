# La llave con que el backend cifra las respuestas guardadas por
# Idempotency-Key (traen datos financieros).
#
# El valor se genera con un recurso efímero y se escribe con un argumento
# write-only: nunca queda en el estado de Terraform. secret_string_wo_version
# se queda en 1, así Terraform no lo vuelve a escribir y una rotación hecha a
# mano (terraform/README.md) no se pierde en el siguiente apply.

ephemeral "random_password" "idempotency_key" {
  length  = 64
  special = false
}

resource "aws_secretsmanager_secret" "idempotency_keys" {
  name                    = "mincome/${var.environment}/backend/idempotency-keys"
  description             = "IDEMPOTENCY_ENCRYPTION_KEYS of mincome-backend: one or more keys, newest first, comma separated."
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret_version" "idempotency_keys" {
  secret_id                = aws_secretsmanager_secret.idempotency_keys.id
  secret_string_wo         = ephemeral.random_password.idempotency_key.result
  secret_string_wo_version = 1
}
