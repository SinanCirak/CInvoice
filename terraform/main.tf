terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.50"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.5"
    }
  }

  backend "s3" {
    bucket         = "cinvoice-celsin-ca-tf-state-ca-central-1"
    key            = "prod/cinvoice/terraform.tfstate"
    region         = "ca-central-1"
    dynamodb_table = "cinvoice-celsin-ca-tf-locks"
    encrypt        = true
  }
}

variable "aws_region" {
  description = "Primary AWS region for app infrastructure."
  type        = string
  default     = "ca-central-1"
}

variable "root_domain" {
  description = "Root Route53 hosted zone domain."
  type        = string
  default     = "celsin.ca"
}

variable "app_subdomain" {
  description = "Frontend subdomain."
  type        = string
  default     = "cinvoice"
}

variable "stripe_secret_key" {
  description = "Stripe secret key stored only in backend env."
  type        = string
  sensitive   = true
}

variable "stripe_webhook_secret" {
  description = "Stripe webhook signing secret stored only in backend env."
  type        = string
  sensitive   = true
}

variable "jwt_secret" {
  description = "JWT secret used by backend for custom session tokens."
  type        = string
  sensitive   = true
}

variable "tags" {
  description = "Common tags."
  type        = map(string)
  default = {
    Project     = "Cinvoice"
    Environment = "prod"
    ManagedBy   = "terraform"
  }
}

provider "aws" {
  region = var.aws_region
}

# CloudFront certificates must live in us-east-1.
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"
}

locals {
  app_domain      = "${var.app_subdomain}.${var.root_domain}"
  invoice_bucket  = "data.${local.app_domain}"
  api_name        = "cinvoice-api"
  dynamodb_table  = "cinvoice-app"
  lambda_name     = "cinvoice-backend"
  lambda_zip_path = "${path.module}/backend.zip"
  settings_pk     = "TENANT#default"
  settings_sk     = "SETTINGS#stripe"
}

data "aws_route53_zone" "root" {
  name         = var.root_domain
  private_zone = false
}

resource "aws_s3_bucket" "site" {
  bucket = local.app_domain
  tags   = var.tags
}

resource "aws_s3_bucket_public_access_block" "site" {
  bucket                  = aws_s3_bucket.site.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "site" {
  bucket = aws_s3_bucket.site.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "site" {
  bucket = aws_s3_bucket.site.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket" "invoices" {
  bucket = local.invoice_bucket
  tags   = var.tags
}

resource "aws_s3_bucket_public_access_block" "invoices" {
  bucket                  = aws_s3_bucket.invoices.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "invoices" {
  bucket = aws_s3_bucket.invoices.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "invoices" {
  bucket = aws_s3_bucket.invoices.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_acm_certificate" "site" {
  provider                  = aws.us_east_1
  domain_name               = local.app_domain
  validation_method         = "DNS"
  subject_alternative_names = []
  tags                      = var.tags
}

resource "aws_route53_record" "site_cert_validation" {
  for_each = {
    for dvo in aws_acm_certificate.site.domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  }

  zone_id = data.aws_route53_zone.root.zone_id
  name    = each.value.name
  type    = each.value.type
  ttl     = 60
  records = [each.value.record]
}

resource "aws_acm_certificate_validation" "site" {
  provider                = aws.us_east_1
  certificate_arn         = aws_acm_certificate.site.arn
  validation_record_fqdns = [for r in aws_route53_record.site_cert_validation : r.fqdn]
}

resource "aws_cloudfront_origin_access_control" "site" {
  name                              = "cinvoice-site-oac"
  description                       = "OAC for Cinvoice site bucket"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_distribution" "site" {
  enabled             = true
  is_ipv6_enabled     = true
  default_root_object = "index.html"
  aliases             = [local.app_domain]
  comment             = "Cinvoice SPA distribution"

  origin {
    domain_name              = aws_s3_bucket.site.bucket_regional_domain_name
    origin_id                = "site-s3-origin"
    origin_access_control_id = aws_cloudfront_origin_access_control.site.id
  }

  default_cache_behavior {
    target_origin_id       = "site-s3-origin"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD", "OPTIONS"]
    compress               = true

    forwarded_values {
      query_string = true
      cookies {
        forward = "none"
      }
    }
  }

  # SPA fallback.
  custom_error_response {
    error_code            = 403
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 0
  }

  custom_error_response {
    error_code            = 404
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 0
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate_validation.site.certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }

  tags = var.tags
}

resource "aws_s3_bucket_policy" "site" {
  bucket = aws_s3_bucket.site.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "AllowCloudFrontRead"
        Effect    = "Allow"
        Principal = { Service = "cloudfront.amazonaws.com" }
        Action    = ["s3:GetObject"]
        Resource  = ["${aws_s3_bucket.site.arn}/*"]
        Condition = {
          StringEquals = {
            "AWS:SourceArn" = aws_cloudfront_distribution.site.arn
          }
        }
      }
    ]
  })
}

resource "aws_route53_record" "site_alias" {
  zone_id = data.aws_route53_zone.root.zone_id
  name    = local.app_domain
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.site.domain_name
    zone_id                = aws_cloudfront_distribution.site.hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_cognito_user_pool" "main" {
  name = "cinvoice-users"

  auto_verified_attributes = ["email"]
  username_attributes      = ["email"]
  mfa_configuration        = "OFF"

  password_policy {
    minimum_length                   = 8
    require_lowercase                = true
    require_numbers                  = true
    require_symbols                  = true
    require_uppercase                = true
    temporary_password_validity_days = 7
  }

  schema {
    name                = "email"
    attribute_data_type = "String"
    required            = true
    mutable             = false
  }

  tags = var.tags
}

resource "aws_cognito_user_pool_client" "web" {
  name         = "cinvoice-web-client"
  user_pool_id = aws_cognito_user_pool.main.id

  explicit_auth_flows = [
    "ALLOW_USER_SRP_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH",
    "ALLOW_USER_PASSWORD_AUTH"
  ]

  generate_secret               = false
  prevent_user_existence_errors = "ENABLED"
  refresh_token_validity        = 30
  access_token_validity         = 1
  id_token_validity             = 1
  token_validity_units {
    access_token  = "hours"
    id_token      = "hours"
    refresh_token = "days"
  }
}

resource "aws_dynamodb_table" "app" {
  name         = local.dynamodb_table
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"
  range_key    = "sk"

  attribute {
    name = "pk"
    type = "S"
  }

  attribute {
    name = "sk"
    type = "S"
  }

  tags = var.tags
}

resource "aws_iam_role" "lambda" {
  name = "cinvoice-lambda-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })
}

resource "aws_iam_role_policy" "lambda" {
  role = aws_iam_role.lambda.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = "arn:aws:logs:*:*:*"
      },
      {
        Effect = "Allow"
        Action = [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:UpdateItem"
        ]
        Resource = aws_dynamodb_table.app.arn
      },
      {
        Effect = "Allow"
        Action = [
          "s3:PutObject",
          "s3:GetObject"
        ]
        Resource = "${aws_s3_bucket.invoices.arn}/*"
      }
    ]
  })
}

data "archive_file" "backend_zip" {
  type        = "zip"
  source_file = "${path.module}/lambda/backend.py"
  output_path = local.lambda_zip_path
}

resource "aws_lambda_function" "backend" {
  function_name = local.lambda_name
  role          = aws_iam_role.lambda.arn
  runtime       = "python3.12"
  handler       = "backend.handler"
  filename      = data.archive_file.backend_zip.output_path
  timeout       = 30

  source_code_hash = data.archive_file.backend_zip.output_base64sha256

  environment {
    variables = {
      STRIPE_SECRET_KEY     = var.stripe_secret_key
      STRIPE_WEBHOOK_SECRET = var.stripe_webhook_secret
      JWT_SECRET            = var.jwt_secret
      TABLE_NAME            = aws_dynamodb_table.app.name
      INVOICE_BUCKET        = aws_s3_bucket.invoices.bucket
      SETTINGS_PK           = local.settings_pk
      SETTINGS_SK           = local.settings_sk
      COGNITO_USER_POOL_ID  = aws_cognito_user_pool.main.id
      COGNITO_APP_CLIENT_ID = aws_cognito_user_pool_client.web.id
      AWS_REGION            = var.aws_region
    }
  }

  tags = var.tags
}

resource "aws_apigatewayv2_api" "http" {
  name          = local.api_name
  protocol_type = "HTTP"

  cors_configuration {
    allow_origins = ["https://${local.app_domain}"]
    allow_methods = ["GET", "POST", "PUT", "OPTIONS"]
    allow_headers = ["*"]
    max_age       = 3600
  }
}

resource "aws_apigatewayv2_integration" "lambda" {
  api_id                 = aws_apigatewayv2_api.http.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.backend.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "routes" {
  for_each = toset([
    "POST /auth/login",
    "GET /settings/stripe",
    "PUT /settings/stripe",
    "POST /invoices/presign",
    "POST /stripe/webhook"
  ])

  api_id    = aws_apigatewayv2_api.http.id
  route_key = each.value
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}

resource "aws_apigatewayv2_stage" "prod" {
  api_id      = aws_apigatewayv2_api.http.id
  name        = "prod"
  auto_deploy = true

  tags = var.tags
}

resource "aws_lambda_permission" "allow_apigw" {
  statement_id  = "AllowExecutionFromAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.backend.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.http.execution_arn}/*/*"
}

output "app_domain" {
  value       = "${var.app_subdomain}.${var.root_domain}"
  description = "Frontend domain."
}

output "site_bucket_name" {
  value       = aws_s3_bucket.site.bucket
  description = "Static hosting bucket."
}

output "invoice_bucket_name" {
  value       = aws_s3_bucket.invoices.bucket
  description = "Invoice file bucket."
}

output "cloudfront_distribution_domain" {
  value       = aws_cloudfront_distribution.site.domain_name
  description = "CloudFront domain."
}

output "cognito_user_pool_id" {
  value       = aws_cognito_user_pool.main.id
  description = "Cognito user pool ID."
}

output "cognito_app_client_id" {
  value       = aws_cognito_user_pool_client.web.id
  description = "Cognito app client ID."
}

output "api_base_url" {
  value       = aws_apigatewayv2_stage.prod.invoke_url
  description = "HTTP API base URL."
}

output "dynamodb_table_name" {
  value       = aws_dynamodb_table.app.name
  description = "Application table name."
}
