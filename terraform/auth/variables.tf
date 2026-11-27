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

variable "post_confirmation_lambda_arn" {
  description = "Alias ARN of the backend Lambda for the Post confirmation trigger. Empty until the backend exists: the pipeline fills it in once it does (GET /me creates users meanwhile)."
  type        = string
  default     = ""
}

variable "deletion_protection" {
  description = "Block deleting the user pool (and every account in it). Same GitHub variable as the database: DELETION_PROTECTION."
  type        = bool
  default     = true
}
