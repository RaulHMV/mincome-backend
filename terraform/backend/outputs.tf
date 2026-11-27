output "api_url" {
  description = "Base URL of the API (VITE_API_URL in the front)."
  value       = "${aws_apigatewayv2_api.http.api_endpoint}/api/v1"
}

output "function_name" {
  value = aws_lambda_function.backend.function_name
}

output "published_version" {
  description = "The version this apply published; the pipeline runs the migrations with it and then moves live to it."
  value       = aws_lambda_function.backend.version
}

output "live_alias_arn" {
  description = "Post confirmation trigger of the user pool (the auth component reads it)."
  value       = aws_lambda_alias.live.arn
}

output "bootstrap_function_name" {
  value = aws_lambda_function.bootstrap.function_name
}

output "alarm_topic_arn" {
  value = aws_sns_topic.alarms.arn
}
