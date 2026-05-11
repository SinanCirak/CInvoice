$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Write-Host "Building frontend..." -ForegroundColor Cyan
npm run build

$tfDir = Join-Path $root "terraform"
if (-not (Test-Path $tfDir)) {
  throw "terraform/ directory not found."
}

Write-Host "Reading Terraform outputs..." -ForegroundColor Cyan
Push-Location $tfDir
try {
  $prevEap = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  $outJson = terraform output -json 2>&1 | Out-String
  $ErrorActionPreference = $prevEap
  if ($LASTEXITCODE -ne 0) {
    throw "terraform output -json failed: $outJson"
  }
  $out = $outJson | ConvertFrom-Json
} finally {
  Pop-Location
}

$bucket = $out.site_bucket_name.value
if (-not $bucket) {
  throw "site_bucket_name missing. Run terraform apply in terraform/ first."
}

$cfId = $null
if ($out.PSObject.Properties.Name -contains "cloudfront_distribution_id") {
  $cfId = [string]$out.cloudfront_distribution_id.value
}

Write-Host "Syncing dist/ -> s3://$bucket/ (single pass + --delete)" -ForegroundColor Cyan
aws s3 sync (Join-Path $root "dist") "s3://$bucket/" --delete

if ($cfId) {
  Write-Host "Invalidating CloudFront ($cfId)..." -ForegroundColor Cyan
  aws cloudfront create-invalidation --distribution-id $cfId --paths "/*" | Out-Null
  Write-Host "Done. Give CloudFront a minute to propagate." -ForegroundColor Green
} else {
  Write-Host "Done (no CloudFront id in outputs)." -ForegroundColor Green
}
