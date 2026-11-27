variable "aws_region" {
  description = "AWS region where the Mincome database service is deployed."
  type        = string
  default     = "us-east-1"
}

variable "vpc_id" {
  description = "VPC hosting the private database subnets."
  type        = string
}

variable "private_subnet_ids" {
  description = "At least two private subnet IDs in different Availability Zones."
  type        = list(string)

  validation {
    condition     = length(var.private_subnet_ids) >= 2
    error_message = "Provide at least two private subnet IDs."
  }
}

variable "database_allowed_cidr_blocks" {
  description = "Admin networks (where Terraform or a VPN runs) allowed to reach PostgreSQL directly. The backend Lambda goes through the RDS Proxy instead."
  type        = list(string)
}

variable "database_name" {
  description = "Logical PostgreSQL database name."
  type        = string
  default     = "mincome"
}

variable "database_host" {
  description = "PostgreSQL endpoint used by the PostgreSQL provider to create the database."
  type        = string
}

variable "database_port" {
  description = "PostgreSQL port."
  type        = number
  default     = 5432
}

variable "database_admin_username" {
  description = "RDS master username."
  type        = string
  sensitive   = true
}

variable "database_admin_password" {
  description = "RDS master password."
  type        = string
  sensitive   = true
}

variable "database_instance_class" {
  description = "RDS instance class."
  type        = string
  default     = "db.t4g.micro"
}

variable "database_storage_gb" {
  description = "Allocated RDS storage in GiB."
  type        = number
  default     = 20
}

variable "database_app_username" {
  description = "PostgreSQL user the backend connects as (through the RDS Proxy). It owns the database, without rds_superuser."
  type        = string
  default     = "mincome_app"
}

variable "database_multi_az" {
  description = "Standby replica in a second Availability Zone. Recommended in production; it doubles the instance cost."
  type        = bool
  default     = false
}

variable "database_deletion_protection" {
  description = "Block deleting the RDS instance. Set to false only for throwaway environments."
  type        = bool
  default     = true
}

variable "database_skip_final_snapshot" {
  description = "Skip the final snapshot when the instance is deleted. Set to true only for throwaway environments."
  type        = bool
  default     = false
}

variable "log_retention_days" {
  description = "Days to keep the RDS logs in CloudWatch."
  type        = number
  default     = 30
}
