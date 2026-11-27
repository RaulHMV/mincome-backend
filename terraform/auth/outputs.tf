output "user_pool_id" {
  description = "VITE_COGNITO_USER_POOL_ID in the front."
  value       = aws_cognito_user_pool.main.id
}

output "web_client_id" {
  description = "App client of the web front."
  value       = aws_cognito_user_pool_client.app["web"].id
}

output "mobile_client_id" {
  description = "App client of the Capacitor app."
  value       = aws_cognito_user_pool_client.app["mobile"].id
}

output "post_confirmation_trigger" {
  description = "Empty until the backend exists; the next apply wires it."
  value       = var.post_confirmation_lambda_arn
}
