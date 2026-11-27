output "database_endpoint" {
  description = "Private RDS endpoint for the PostgreSQL provider and application service."
  value       = aws_db_instance.database.address
}

output "database_name" {
  description = "Logical PostgreSQL database that the TypeORM migrations populate."
  value       = postgresql_database.mincome.name
}

output "database_security_group_id" {
  description = "Security group attached to the RDS database service."
  value       = aws_security_group.database.id
}

output "database_proxy_endpoint" {
  description = "RDS Proxy endpoint: the backend Lambda's DB_HOST (SAM parameter DatabaseProxyEndpoint)."
  value       = aws_db_proxy.database.endpoint
}

output "database_proxy_resource_id" {
  description = "RDS Proxy resource id (prx-...), used in the Lambda's rds-db:connect permission (SAM parameter DatabaseProxyResourceId)."
  value       = element(split(":", aws_db_proxy.database.arn), 6)
}

output "database_app_username" {
  description = "PostgreSQL user of the backend (SAM parameter DatabaseUser)."
  value       = postgresql_role.app.name
}

output "backend_lambda_security_group_id" {
  description = "Security group for the backend Lambda (SAM parameter LambdaSecurityGroupId)."
  value       = aws_security_group.backend_lambda.id
}

output "private_subnet_ids" {
  description = "Private subnets for the backend Lambda (SAM parameter PrivateSubnetIds)."
  value       = var.private_subnet_ids
}
