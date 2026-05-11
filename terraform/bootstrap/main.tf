# One-time: creates the S3 bucket for remote Terraform state (used only after you enable ../backend-s3.tf).
# This module uses the default local backend so `terraform init` always works.
#
# Order: (1) terraform apply here in bootstrap/  (2) rename ../backend-s3.tf.off → backend-s3.tf
# (3) terraform init -migrate-state in ../

terraform {
  required_version = ">= 1.6.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.50"
    }
  }
}

variable "aws_region" {
  type        = string
  description = "Region for the state bucket (must match main backend region)."
  default     = "ca-central-1"
}

variable "state_bucket_name" {
  type        = string
  description = "Must match bucket in parent module backend block."
  default     = "cinvoice-celsin-ca-tf-state-ca-central-1"
}

provider "aws" {
  region = var.aws_region
}

resource "aws_s3_bucket" "tf_state" {
  bucket = var.state_bucket_name
  tags = {
    Purpose = "terraform-remote-state"
  }
}

resource "aws_s3_bucket_versioning" "tf_state" {
  bucket = aws_s3_bucket.tf_state.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "tf_state" {
  bucket = aws_s3_bucket.tf_state.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "tf_state" {
  bucket                  = aws_s3_bucket.tf_state.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

output "state_bucket" {
  value       = aws_s3_bucket.tf_state.id
  description = "Use this bucket name in the parent terraform backend block."
}
