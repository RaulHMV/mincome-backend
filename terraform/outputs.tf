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
