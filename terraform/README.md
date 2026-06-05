# CInvoice Infrastructure

This directory contains Terraform configuration for deploying CInvoice on AWS.

## Resources Created

- **DynamoDB Table** (`cinvoice-main`): Single-table store for profiles, clients, catalog, invoices, drafts (GSI1 + GSI2)
- **Lambda Function** (`cinvoice-backend`): Python 3.12 monolith
  - `backend.py` — HTTP routing, Stripe webhook, admin endpoints
  - `entities.py` — Entity layer, workspace load/save, migrations
- **API Gateway**: HTTP API with Cognito JWT authorizer and Lambda proxy integration
- **S3 Buckets**:
  - Site bucket (`cinvoice.celsin.ca`) — static SPA via CloudFront
  - Invoice bucket (`data.cinvoice.celsin.ca`) — private PDFs and workspace files
- **CloudFront**: CDN for site bucket with OAC
- **Cognito**: User pool + SPA app client
- **Route 53 + ACM**: Custom domain and TLS (ACM in us-east-1 for CloudFront)
- **IAM**: Lambda execution role (DynamoDB, S3, Cognito, CloudWatch)

## Prerequisites

1. AWS CLI configured with appropriate credentials
2. Terraform installed (>= 1.10)
3. Route 53 hosted zone for `root_domain` (default `celsin.ca`)
4. Sensitive values for apply: `stripe_secret_key`, `stripe_webhook_secret`, `jwt_secret`

## Setup

1. Initialize Terraform:
```bash
cd terraform
terraform init
```

2. Review the plan:
```bash
terraform plan
```

3. Apply the configuration:
```bash
terraform apply
```

Optional remote state: see `bootstrap/` and enable `backend-s3.tf` when ready.

## Outputs

After deployment, Terraform outputs:

- `api_base_url` — API Gateway invoke URL (set as `VITE_API_BASE_URL`)
- `cognito_user_pool_id` / `cognito_app_client_id` — Cognito IDs for the SPA
- `site_bucket_name` — S3 bucket for frontend deploy
- `invoice_bucket_name` — S3 bucket for PDF storage
- `cloudfront_distribution_id` — For cache invalidation after deploy
- `app_domain` — Production URL (`cinvoice.celsin.ca`)
- `dynamodb_table_name` — `cinvoice-main`

## Updating Lambda Code

After editing `lambda/backend.py` or `lambda/entities.py`:

**Option A — Terraform** (rebuilds zip from `lambda/` directory):
```bash
terraform apply
```

**Option B — AWS CLI** (quick code push):
```bash
cd lambda
zip -j ../backend.zip backend.py entities.py
aws lambda update-function-code \
  --function-name cinvoice-backend \
  --zip-file fileb://../backend.zip \
  --region ca-central-1
```

## Frontend Configuration

After deployment, set frontend env from outputs:

```env
VITE_API_BASE_URL=<terraform output api_base_url>
VITE_COGNITO_USER_POOL_ID=<terraform output cognito_user_pool_id>
VITE_COGNITO_USER_POOL_CLIENT_ID=<terraform output cognito_app_client_id>
VITE_AWS_REGION=ca-central-1
```

Deploy the SPA via GitHub Actions (push to `main`) or `../scripts/deploy-site.ps1`.

## Cleanup

To destroy all resources:

```bash
terraform destroy
```

**Warning**: This deletes DynamoDB data and all provisioned infrastructure.
