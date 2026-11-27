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

variable "vpc_cidr" {
  description = "CIDR of the VPC. Each private subnet takes a /20 of it."
  type        = string
  default     = "10.40.0.0/16"
}

variable "flow_logs_retention_days" {
  description = "Days to keep the rejected-traffic flow logs."
  type        = number
  default     = 14
}
