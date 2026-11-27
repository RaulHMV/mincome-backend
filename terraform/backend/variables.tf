variable "aws_region" {
  description = "AWS region of the Mincome backend."
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Environment name; prefixes the SSM parameters it reads."
  type        = string
  default     = "production"

  validation {
    condition     = can(regex("^[a-z]+$", var.environment))
    error_message = "Use lowercase letters only, like production."
  }
}

variable "stack_name" {
  description = "Name of the Lambda and prefix of the API, schedule, queue, topic and alarms."
  type        = string
  default     = "mincome-backend"
}

variable "package_s3_key" {
  description = "Key of the Lambda package in the artifacts bucket (backend/<commit>.zip). The pipeline uploads it."
  type        = string

  validation {
    condition     = can(regex("^backend/[0-9a-f]{7,40}\\.zip$", var.package_s3_key))
    error_message = "Use backend/<commit sha>.zip."
  }
}

variable "package_sha256" {
  description = "Base64 SHA-256 of the package; a new value publishes a new version."
  type        = string
}

variable "web_app_origin" {
  description = "Origin of the web app, e.g. https://app.mincome.mx. The Capacitor origins are always allowed."
  type        = string
  default     = ""

  validation {
    condition     = var.web_app_origin == "" || can(regex("^https://[^/]+$", var.web_app_origin))
    error_message = "Use https://host, without a path."
  }
}

variable "ai_wrapper_role_arn" {
  description = "IAM role of the mincome-ai-wrapper Lambda, the only caller allowed on /internal/*. Empty keeps them closed."
  type        = string
  default     = ""
}

variable "alarm_email" {
  description = "Address that receives the alarms. Empty creates the alarms without notifications."
  type        = string
  default     = ""
}

variable "memory_mb" {
  description = "Lambda memory; CPU grows with it."
  type        = number
  default     = 1024
}

variable "reserved_concurrency" {
  description = "Cap on concurrent instances to protect the database. -1 reserves nothing (new accounts only have 10 in total)."
  type        = number
  default     = -1
}

variable "api_throttling_rate_limit" {
  description = "Steady requests per second across the API."
  type        = number
  default     = 50
}

variable "api_throttling_burst_limit" {
  type    = number
  default = 100
}

variable "log_retention_days" {
  type    = number
  default = 30
}
