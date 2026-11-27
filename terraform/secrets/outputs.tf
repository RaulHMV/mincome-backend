output "idempotency_keys_secret_arn" {
  value = aws_secretsmanager_secret.idempotency_keys.arn
}
