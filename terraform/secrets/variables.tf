variable "aws_region" {
  description = "AWS region of the Mincome backend."
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Environment name; prefixes the secret names."
  type        = string
  default     = "production"

  validation {
    condition     = can(regex("^[a-z]+$", var.environment))
    error_message = "Use lowercase letters only, like production."
  }
}
