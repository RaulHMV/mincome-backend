variable "aws_region" {
  description = "AWS region of the Mincome backend."
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Environment name; prefixes the names and the SSM parameters."
  type        = string
  default     = "production"

  validation {
    condition     = can(regex("^[a-z]+$", var.environment))
    error_message = "Use lowercase letters only, like production."
  }
}

variable "database_name" {
  description = "Logical PostgreSQL database that RDS creates and the migrations populate."
  type        = string
  default     = "mincome"
}

variable "database_port" {
  description = "PostgreSQL port."
  type        = number
  default     = 5432
}

variable "database_master_username" {
  description = "RDS master user. Its password lives in Secrets Manager, managed and rotated by RDS; only the bootstrap job uses it, through the proxy."
  type        = string
  default     = "mincome_admin"
}

variable "database_app_username" {
  description = "PostgreSQL user of the backend. It connects with IAM end to end (no password) and owns the database."
  type        = string
  default     = "mincome_app"
}

variable "database_instance_class" {
  description = "RDS instance class."
  type        = string
  default     = "db.t4g.micro"
}

variable "database_storage_gb" {
  description = "Allocated RDS storage in GiB; it can grow up to twice this."
  type        = number
  default     = 20
}

variable "database_multi_az" {
  description = "Standby replica in a second Availability Zone. Recommended in production; it doubles the instance cost."
  type        = bool
  default     = false
}

variable "deletion_protection" {
  description = "Block deleting the RDS instance. The destroy pipeline only works after an apply with this set to false (GitHub variable DELETION_PROTECTION)."
  type        = bool
  default     = true
}

variable "skip_final_snapshot" {
  description = "Skip the final snapshot when the instance is deleted. Leave false in production."
  type        = bool
  default     = false
}

variable "admin_cidr_blocks" {
  description = "Networks allowed to reach PostgreSQL directly (a VPN, for emergencies). Empty: only the RDS Proxy reaches it."
  type        = list(string)
  default     = []
}

variable "log_retention_days" {
  description = "Days to keep the RDS logs in CloudWatch."
  type        = number
  default     = 30
}
