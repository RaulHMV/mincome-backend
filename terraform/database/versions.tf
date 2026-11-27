terraform {
  required_version = ">= 1.11.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.72.0"
    }

    random = {
      source  = "hashicorp/random"
      version = "~> 3.9.1"
    }
  }

  # bucket, key y region llegan con -backend-config (ver terraform/README.md).
  backend "s3" {
    use_lockfile = true
    encrypt      = true
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Service     = "mincome"
      Environment = var.environment
      Component   = "database"
      ManagedBy   = "terraform"
    }
  }
}
