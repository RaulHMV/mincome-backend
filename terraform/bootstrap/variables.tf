variable "aws_region" {
  description = "AWS region of the Mincome backend."
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Environment name, also the GitHub environment the CI roles trust."
  type        = string
  default     = "production"

  validation {
    condition     = can(regex("^[a-z]+$", var.environment))
    error_message = "Use lowercase letters only, like production."
  }
}

variable "github_repository" {
  description = "owner/name of the repository whose workflows can assume the CI roles."
  type        = string
  default     = "RaulHMV/mincome-backend"
}

variable "state_bucket" {
  description = "S3 bucket that holds the Terraform state (the bootstrap workflow creates it)."
  type        = string
}

variable "stack_name" {
  description = "Prefix of the backend resources (Lambda, API, schedule, alarms) and of the CI roles."
  type        = string
  default     = "mincome-backend"
}
