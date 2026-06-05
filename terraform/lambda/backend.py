import base64
import json
import os
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

import boto3
from botocore.exceptions import ClientError

import entities


dynamodb = boto3.resource("dynamodb")
s3 = boto3.client("s3")
cognito = boto3.client("cognito-idp")

TABLE_NAME = os.environ["TABLE_NAME"]
INVOICE_BUCKET = os.environ["INVOICE_BUCKET"]
SETTINGS_PK = os.environ["SETTINGS_PK"]
SETTINGS_SK = os.environ["SETTINGS_SK"]
COGNITO_APP_CLIENT_ID = os.environ["COGNITO_APP_CLIENT_ID"]
COGNITO_USER_POOL_ID = os.environ["COGNITO_USER_POOL_ID"]
ADMIN_API_SECRET = os.environ.get("JWT_SECRET", "")


def _response(status: int, body: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "statusCode": status,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "*",
            "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
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


def _header_value(event: Dict[str, Any], name: str) -> str:
    headers = event.get("headers") or {}
    target = name.lower()
    for key, value in headers.items():
        if str(key).lower() == target:
            return str(value or "").strip()
    return ""


def _admin_secret_ok(event: Dict[str, Any]) -> bool:
    if not ADMIN_API_SECRET:
        return False
    provided = _header_value(event, "x-admin-secret")
    if not provided:
        auth = _header_value(event, "authorization")
        if auth.lower().startswith("bearer "):
            provided = auth[7:].strip()
    return provided == ADMIN_API_SECRET


def _admin_set_password(event: Dict[str, Any]) -> Dict[str, Any]:
    if not _admin_secret_ok(event):
        return _response(403, {"message": "Forbidden"})
    payload = _read_json(event)
    username = str(payload.get("email") or payload.get("username") or "").strip()
    password = str(payload.get("password") or "")
    if not username or not password:
        return _response(400, {"message": "email and password are required"})
    try:
        cognito.admin_set_user_password(
            UserPoolId=COGNITO_USER_POOL_ID,
            Username=username,
            Password=password,
            Permanent=True,
        )
        return _response(200, {"ok": True, "username": username, "permanent": True})
    except ClientError as exc:
        err = exc.response.get("Error", {})
        code = err.get("Code", "ClientError")
        message = err.get("Message", str(exc))
        status = 404 if code == "UserNotFoundException" else 400
        return _response(status, {"message": message, "code": code})


def _jwt_sub(event: Dict[str, Any]) -> Optional[str]:
    try:
        claims = event["requestContext"]["authorizer"]["jwt"]["claims"]
        sub = claims.get("sub")
        return str(sub) if sub else None
    except (KeyError, TypeError):
        return None


def _require_sub(event: Dict[str, Any]) -> Optional[str]:
    sub = _jwt_sub(event)
    if not sub:
        return None
    return sub


def _get_bootstrap(event: Dict[str, Any]) -> Dict[str, Any]:
    sub = _require_sub(event)
    if not sub:
        return _response(401, {"message": "Unauthorized"})
    data = entities.load_bootstrap(sub)
    return _response(200, data)


def _put_sync(event: Dict[str, Any]) -> Dict[str, Any]:
    sub = _require_sub(event)
    if not sub:
        return _response(401, {"message": "Unauthorized"})
    payload = _read_json(event)
    workspace = payload.get("workspace")
    if workspace is None:
        return _response(400, {"message": "Missing workspace"})
    full_sync = bool(payload.get("fullSync"))
    entities.sync_workspace(sub, workspace, full_sync=full_sync)
    return _response(200, {"ok": True, "storage": "single-table", "updatedAt": entities._now()})


def _get_workspace(event: Dict[str, Any]) -> Dict[str, Any]:
    """Backward-compatible alias for bootstrap load."""
    sub = _require_sub(event)
    if not sub:
        return _response(401, {"message": "Unauthorized"})
    data = entities.load_bootstrap(sub)
    return _response(200, {"workspace": data, "storage": data.get("storage", "single-table")})


def _put_workspace(event: Dict[str, Any]) -> Dict[str, Any]:
    """Backward-compatible alias for sync."""
    return _put_sync(event)


def _post_invoice(event: Dict[str, Any]) -> Dict[str, Any]:
    sub = _require_sub(event)
    if not sub:
        return _response(401, {"message": "Unauthorized"})
    payload = _read_json(event)
    invoice = payload.get("invoice") or {}
    lines = payload.get("lines") or []
    if not invoice.get("invoiceNumber"):
        return _response(400, {"message": "invoiceNumber is required"})
    created = entities.create_invoice_with_items(sub, invoice, lines)
    return _response(201, {"invoice": created})


def _delete_invoice(event: Dict[str, Any]) -> Dict[str, Any]:
    sub = _require_sub(event)
    if not sub:
        return _response(401, {"message": "Unauthorized"})
    payload = _read_json(event)
    invoice_id = str(payload.get("invoiceId") or payload.get("id") or "").strip()
    invoice_number = str(payload.get("invoiceNumber") or "").strip()
    if not invoice_id or not invoice_number:
        return _response(400, {"message": "invoiceId and invoiceNumber are required"})
    try:
        deleted = entities.delete_invoice(sub, invoice_id, invoice_number)
        return _response(200, {"deleted": True, **deleted})
    except LookupError:
        return _response(404, {"message": "Invoice not found"})
    except ValueError as exc:
        return _response(400, {"message": str(exc)})


def _delete_client(event: Dict[str, Any]) -> Dict[str, Any]:
    sub = _require_sub(event)
    if not sub:
        return _response(401, {"message": "Unauthorized"})
    payload = _read_json(event)
    client_id = str(payload.get("clientId") or payload.get("id") or "").strip()
    client_id_confirm = str(payload.get("clientIdConfirm") or payload.get("clientIdDisplay") or "").strip()
    if not client_id or not client_id_confirm:
        return _response(400, {"message": "clientId and clientIdConfirm are required"})
    try:
        deleted = entities.delete_client(sub, client_id, client_id_confirm)
        return _response(200, {"deleted": True, **deleted})
    except LookupError:
        return _response(404, {"message": "Client not found"})
    except ValueError as exc:
        return _response(400, {"message": str(exc)})


def _get_invoices_open(event: Dict[str, Any]) -> Dict[str, Any]:
    sub = _require_sub(event)
    if not sub:
        return _response(401, {"message": "Unauthorized"})
    rows = entities.query_invoices_by_status(sub, "OPEN")
    return _response(200, {"invoices": rows})


def _settings_pk_for_sub(sub: str) -> str:
    return f"USER#{sub}"


def _put_setting(sub: str, key: str, value: str) -> None:
    table = dynamodb.Table(TABLE_NAME)
    table.update_item(
        Key={"pk": _settings_pk_for_sub(sub), "sk": SETTINGS_SK},
        UpdateExpression="SET #k = :v, updatedAt = :u",
        ExpressionAttributeNames={"#k": key},
        ExpressionAttributeValues={":v": value, ":u": datetime.now(timezone.utc).isoformat()},
    )


def _get_settings(sub: str) -> Dict[str, Any]:
    table = dynamodb.Table(TABLE_NAME)
    item = table.get_item(Key={"pk": _settings_pk_for_sub(sub), "sk": SETTINGS_SK}).get("Item")
    if item:
        return item
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

    if method == "POST" and path.endswith("/admin/set-password"):
        return _admin_set_password(event)

    if method == "GET" and (path.endswith("/bootstrap") or path.endswith("/data/bootstrap")):
        return _get_bootstrap(event)

    if method == "PUT" and (path.endswith("/sync") or path.endswith("/data/sync")):
        return _put_sync(event)

    if method == "GET" and path.endswith("/workspace"):
        return _get_workspace(event)

    if method == "PUT" and path.endswith("/workspace"):
        return _put_workspace(event)

    if method == "POST" and path.endswith("/invoices") and not path.endswith("/presign"):
        return _post_invoice(event)

    if method == "POST" and path.endswith("/invoices/delete"):
        return _delete_invoice(event)

    if method == "POST" and path.endswith("/clients/delete"):
        return _delete_client(event)

    if method == "GET" and path.endswith("/invoices/open"):
        return _get_invoices_open(event)

    if method == "GET" and path.endswith("/settings/stripe"):
        sub = _jwt_sub(event)
        if not sub:
            return _response(401, {"message": "Unauthorized"})
        settings = _get_settings(sub)
        return _response(
            200,
            {
                "stripeSecretKeyMasked": _mask_secret(settings.get("stripeSecretKey", "")),
                "stripeWebhookSecretMasked": _mask_secret(settings.get("stripeWebhookSecret", "")),
            },
        )

    if method == "PUT" and path.endswith("/settings/stripe"):
        sub = _jwt_sub(event)
        if not sub:
            return _response(401, {"message": "Unauthorized"})
        payload = _read_json(event)
        if "stripeSecretKey" in payload and payload["stripeSecretKey"]:
            _put_setting(sub, "stripeSecretKey", payload["stripeSecretKey"])
        if "stripeWebhookSecret" in payload and payload["stripeWebhookSecret"]:
            _put_setting(sub, "stripeWebhookSecret", payload["stripeWebhookSecret"])
        return _response(200, {"updated": True})

    if method == "POST" and path.endswith("/invoices/presign"):
        sub = _jwt_sub(event)
        if not sub:
            return _response(401, {"message": "Unauthorized"})
        payload = _read_json(event)
        invoice_id = payload.get("invoiceId", f"inv-{int(datetime.now().timestamp())}")
        safe = "".join(c for c in str(invoice_id) if c.isalnum() or c in "._-")[:160] or f"inv-{int(datetime.now().timestamp())}"
        key = f"invoices/{sub}/{safe}.pdf"
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

    if method == "POST" and path.endswith("/invoices/download-url"):
        sub = _jwt_sub(event)
        if not sub:
            return _response(401, {"message": "Unauthorized"})
        payload = _read_json(event)
        key = str(payload.get("objectKey") or "").strip()
        prefix = f"invoices/{sub}/"
        if not key.startswith(prefix) or ".." in key or key.endswith("/"):
            return _response(403, {"message": "Invalid object key"})
        try:
            s3.head_object(Bucket=INVOICE_BUCKET, Key=key)
        except ClientError:
            return _response(404, {"message": "PDF not found in storage"})
        url = s3.generate_presigned_url(
            "get_object",
            Params={"Bucket": INVOICE_BUCKET, "Key": key},
            ExpiresIn=3600,
        )
        return _response(200, {"downloadUrl": url})

    if method == "POST" and path.endswith("/stripe/webhook"):
        return _response(200, {"received": True})

    return _response(404, {"message": "Not found"})


def handler(event: Dict[str, Any], _context: Any) -> Dict[str, Any]:
    try:
        return _route(event)
    except Exception as exc:
        return _response(500, {"message": "Internal server error", "error": str(exc)})
