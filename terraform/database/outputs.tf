output "proxy_endpoint" {
  value = aws_db_proxy.database.endpoint
}

output "instance_endpoint" {
  description = "Direct endpoint, only reachable from admin_cidr_blocks."
  value       = aws_db_instance.database.address
}

output "master_user_secret_arn" {
  description = "Secrets Manager secret with the master password, managed and rotated by RDS."
  value       = aws_db_instance.database.master_user_secret[0].secret_arn
}
