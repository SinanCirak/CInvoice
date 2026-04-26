import base64
import json
import os
from datetime import datetime, timedelta, timezone
from typing import Any, Dict

import boto3
from botocore.exceptions import ClientError


dynamodb = boto3.resource("dynamodb")
s3 = boto3.client("s3")
cognito = boto3.client("cognito-idp")

TABLE_NAME = os.environ["TABLE_NAME"]
INVOICE_BUCKET = os.environ["INVOICE_BUCKET"]
SETTINGS_PK = os.environ["SETTINGS_PK"]
SETTINGS_SK = os.environ["SETTINGS_SK"]
COGNITO_APP_CLIENT_ID = os.environ["COGNITO_APP_CLIENT_ID"]


def _response(status: int, body: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "statusCode": status,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "*",
            "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
        },
        "body": json.dumps(body),
    }


def _read_json(event: Dict[str, Any]) -> Dict[str, Any]:
    body = event.get("body") or "{}"
    if event.get("isBase64Encoded"):
        body = base64.b64decode(body).decode("utf-8")
    return json.loads(body)


def _mask_secret(value: str) -> str:
    if not value:
        return ""
    visible = value[:5]
    return visible + "*" * max(len(value) - 5, 8)


def _put_setting(key: str, value: str) -> None:
    table = dynamodb.Table(TABLE_NAME)
    table.update_item(
        Key={"pk": SETTINGS_PK, "sk": SETTINGS_SK},
        UpdateExpression="SET #k = :v, updatedAt = :u",
        ExpressionAttributeNames={"#k": key},
        ExpressionAttributeValues={":v": value, ":u": datetime.now(timezone.utc).isoformat()},
    )


def _get_settings() -> Dict[str, Any]:
    table = dynamodb.Table(TABLE_NAME)
    item = table.get_item(Key={"pk": SETTINGS_PK, "sk": SETTINGS_SK}).get("Item", {})
    return item


def _route(event: Dict[str, Any]) -> Dict[str, Any]:
    method = event.get("requestContext", {}).get("http", {}).get("method", "")
    path = event.get("requestContext", {}).get("http", {}).get("path", "")

    if method == "OPTIONS":
        return _response(200, {"ok": True})

    if method == "POST" and path.endswith("/auth/login"):
        payload = _read_json(event)
        try:
            auth = cognito.initiate_auth(
                ClientId=COGNITO_APP_CLIENT_ID,
                AuthFlow="USER_PASSWORD_AUTH",
                AuthParameters={
                    "USERNAME": payload["email"],
                    "PASSWORD": payload["password"],
                },
            )
            return _response(200, {"token": auth.get("AuthenticationResult", {})})
        except ClientError as exc:
            return _response(401, {"message": "Invalid credentials", "error": str(exc)})

    if method == "GET" and path.endswith("/settings/stripe"):
        settings = _get_settings()
        return _response(
            200,
            {
                "stripeSecretKeyMasked": _mask_secret(settings.get("stripeSecretKey", "")),
                "stripeWebhookSecretMasked": _mask_secret(settings.get("stripeWebhookSecret", "")),
            },
        )

    if method == "PUT" and path.endswith("/settings/stripe"):
        payload = _read_json(event)
        if "stripeSecretKey" in payload and payload["stripeSecretKey"]:
            _put_setting("stripeSecretKey", payload["stripeSecretKey"])
        if "stripeWebhookSecret" in payload and payload["stripeWebhookSecret"]:
            _put_setting("stripeWebhookSecret", payload["stripeWebhookSecret"])
        return _response(200, {"updated": True})

    if method == "POST" and path.endswith("/invoices/presign"):
        payload = _read_json(event)
        invoice_id = payload.get("invoiceId", f"inv-{int(datetime.now().timestamp())}")
        key = f"invoices/{invoice_id}.pdf"
        presigned_put = s3.generate_presigned_url(
            "put_object",
            Params={"Bucket": INVOICE_BUCKET, "Key": key, "ContentType": "application/pdf"},
            ExpiresIn=300,
        )
        presigned_get = s3.generate_presigned_url(
            "get_object",
            Params={"Bucket": INVOICE_BUCKET, "Key": key},
            ExpiresIn=int(timedelta(days=7).total_seconds()),
        )
        return _response(
            200,
            {
                "uploadUrl": presigned_put,
                "downloadUrl": presigned_get,
                "objectKey": key,
            },
        )

    if method == "POST" and path.endswith("/stripe/webhook"):
        # Signature verification is done using STRIPE_WEBHOOK_SECRET in real handler.
        # Kept as stub here so secret remains backend-only.
        return _response(200, {"received": True})

    return _response(404, {"message": "Not found"})


def handler(event: Dict[str, Any], _context: Any) -> Dict[str, Any]:
    try:
        return _route(event)
    except Exception as exc:
        return _response(500, {"message": "Internal server error", "error": str(exc)})
