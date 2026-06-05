"""Single-table DynamoDB entities for CInvoice (PK=USER#sub, SK=ENTITY#id)."""

from __future__ import annotations

import base64
import copy
import json
import os
import re
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Dict, List, Optional, Tuple

import boto3
from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError


dynamodb = boto3.resource("dynamodb")
s3 = boto3.client("s3")

TABLE_NAME = os.environ["TABLE_NAME"]
INVOICE_BUCKET = os.environ["INVOICE_BUCKET"]
SETTINGS_SK = os.environ["SETTINGS_SK"]
LEGACY_WORKSPACE_SK = "WORKSPACE#v1"
PROFILE_SK = "PROFILE"
DRAFT_SK = "DRAFT"


def _table():
    return dynamodb.Table(TABLE_NAME)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _user_pk(sub: str) -> str:
    return f"USER#{sub}"


def _logo_object_key(sub: str) -> str:
    return f"workspace/{sub}/logo"


def _to_decimal(obj: Any) -> Any:
    if isinstance(obj, float):
        return Decimal(str(obj))
    if isinstance(obj, dict):
        return {k: _to_decimal(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_to_decimal(v) for v in obj]
    return obj


def _from_decimal(obj: Any) -> Any:
    if isinstance(obj, Decimal):
        if obj % 1 == 0:
            return int(obj)
        return float(obj)
    if isinstance(obj, dict):
        return {k: _from_decimal(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_from_decimal(v) for v in obj]
    return obj


def _status_gsi(status: str) -> str:
    s = (status or "OPEN").upper()
    if s in ("DRAFT", "OPEN", "PARTIAL"):
        return "OPEN"
    if s == "PAID":
        return "PAID"
    if s == "OVERDUE":
        return "OVERDUE"
    return "OPEN"


def _invoice_status_ui(status: str) -> str:
    s = (status or "OPEN").upper()
    mapping = {
        "OPEN": "Open",
        "PAID": "Paid",
        "OVERDUE": "Overdue",
        "PARTIAL": "Partial",
        "DRAFT": "Draft",
    }
    return mapping.get(s, "Open")


def _query_prefix(pk: str, sk_prefix: str) -> List[Dict[str, Any]]:
    items: List[Dict[str, Any]] = []
    kwargs: Dict[str, Any] = {
        "KeyConditionExpression": Key("pk").eq(pk) & Key("sk").begins_with(sk_prefix),
    }
    while True:
        resp = _table().query(**kwargs)
        items.extend(resp.get("Items", []))
        if "LastEvaluatedKey" not in resp:
            break
        kwargs["ExclusiveStartKey"] = resp["LastEvaluatedKey"]
    return items


def _split_logo(profile: Dict[str, Any]) -> Tuple[Dict[str, Any], bool, bytes, str]:
    p = copy.deepcopy(profile)
    logo_url = p.get("logoDataUrl") or ""
    logo_bytes: Optional[bytes] = None
    content_type = "image/png"
    if isinstance(logo_url, str) and logo_url.startswith("data:"):
        try:
            meta, b64 = logo_url.split(",", 1)
            if ";" in meta:
                maybe_mime = meta[5 : meta.index(";")]
                if maybe_mime.startswith("image/"):
                    content_type = maybe_mime
            logo_bytes = base64.b64decode(b64, validate=False)
        except Exception:
            logo_bytes = None
    p["logoDataUrl"] = ""
    return p, bool(logo_bytes), logo_bytes or b"", content_type


def _attach_logo(sub: str, profile: Dict[str, Any]) -> Dict[str, Any]:
    out = copy.deepcopy(profile)
    try:
        obj = s3.get_object(Bucket=INVOICE_BUCKET, Key=_logo_object_key(sub))
        raw = obj["Body"].read()
        ct = obj.get("ContentType") or "image/png"
        b64 = base64.b64encode(raw).decode("ascii")
        out["logoDataUrl"] = f"data:{ct};base64,{b64}"
    except ClientError:
        pass
    return out


def _save_logo(sub: str, profile: Dict[str, Any], *, preserve_existing: bool = False) -> None:
    stripped, has_logo, logo_bytes, logo_ct = _split_logo(profile)
    if has_logo and logo_bytes:
        s3.put_object(
            Bucket=INVOICE_BUCKET,
            Key=_logo_object_key(sub),
            Body=logo_bytes,
            ContentType=logo_ct,
            ServerSideEncryption="AES256",
        )
    elif not preserve_existing:
        try:
            s3.delete_object(Bucket=INVOICE_BUCKET, Key=_logo_object_key(sub))
        except ClientError:
            pass


def _invoice_number_from_pdf_key(pdf_key: str) -> str:
    if not pdf_key:
        return ""
    base = str(pdf_key).rsplit("/", 1)[-1]
    return base[:-4] if base.lower().endswith(".pdf") else base


def _is_synthetic_invoice_number(iid: str, invoice_number: str) -> bool:
    iid = str(iid or "").strip()
    num = str(invoice_number or "").strip()
    if not iid or not num:
        return False
    if num == iid:
        return True
    if iid.startswith("inv-"):
        return num == iid.replace("inv-", "INV-", 1)
    return False


def _list_invoice_pdf_keys(sub: str) -> List[str]:
    prefix = f"invoices/{sub}/"
    keys: List[str] = []
    token: Optional[str] = None
    try:
        while True:
            kwargs: Dict[str, Any] = {"Bucket": INVOICE_BUCKET, "Prefix": prefix}
            if token:
                kwargs["ContinuationToken"] = token
            resp = s3.list_objects_v2(**kwargs)
            for obj in resp.get("Contents") or []:
                key = str(obj.get("Key") or "")
                if key.endswith(".pdf"):
                    keys.append(key)
            if not resp.get("IsTruncated"):
                break
            token = resp.get("NextContinuationToken")
    except ClientError:
        return []
    return sorted(keys)


def _safe_pdf_basename(invoice_number: str) -> str:
    safe = "".join(c for c in str(invoice_number) if c.isalnum() or c in "._-")[:160]
    return safe or f"inv-{int(datetime.now().timestamp())}"


def _find_pdf_key(
    sub: str, iid: str, invoice_number: str, pdf_keys: Optional[List[str]] = None
) -> str:
    prefix = f"invoices/{sub}/"
    keys = pdf_keys if pdf_keys is not None else _list_invoice_pdf_keys(sub)
    key_set = set(keys)
    num = str(invoice_number or "").strip()
    if num and not _is_synthetic_invoice_number(iid, num):
        candidate = f"{prefix}{_safe_pdf_basename(num)}.pdf"
        if candidate in key_set:
            return candidate
    inv_pdf = f"{prefix}{iid}.pdf"
    if inv_pdf in key_set:
        return inv_pdf
    return ""


def _normalize_invoice_fields(
    sub: str, inv: Dict[str, Any], pdf_keys: Optional[List[str]] = None
) -> Dict[str, Any]:
    out = copy.deepcopy(inv)
    iid = str(out.get("id") or "")
    num = str(out.get("invoiceNumber") or "").strip()
    pdf_key = str(out.get("pdfObjectKey") or "").strip()

    if pdf_key:
        derived = _invoice_number_from_pdf_key(pdf_key)
        if derived and (_is_synthetic_invoice_number(iid, num) or not num):
            out["invoiceNumber"] = derived
    else:
        found = _find_pdf_key(sub, iid, num, pdf_keys)
        if found:
            out["pdfObjectKey"] = found
            derived = _invoice_number_from_pdf_key(found)
            if derived and (_is_synthetic_invoice_number(iid, num) or not num):
                out["invoiceNumber"] = derived
    return out


def _profile_to_item(sub: str, profile: Dict[str, Any]) -> Dict[str, Any]:
    now = _now()
    return _to_decimal(
        {
            "pk": _user_pk(sub),
            "sk": PROFILE_SK,
            "entityType": "PROFILE",
            "companyName": profile.get("companyName", ""),
            "ownerName": profile.get("ownerName", ""),
            "email": profile.get("email", ""),
            "phone": profile.get("phone", ""),
            "streetAddress": profile.get("streetAddress", ""),
            "city": profile.get("city", ""),
            "province": profile.get("province", "ON"),
            "postalCode": profile.get("postalCode", ""),
            "gstHstNumber": profile.get("gstHstNumber", ""),
            "invoicePrefix": profile.get("invoiceNumberPrefix", "INV"),
            "invoiceNumberYear": profile.get("invoiceNumberYear", str(datetime.now().year)),
            "paymentAccountName": profile.get("paymentAccountName", ""),
            "paymentInstitutionName": profile.get("paymentInstitutionName", ""),
            "paymentInstitutionNumber": profile.get("paymentInstitutionNumber", ""),
            "paymentTransitNumber": profile.get("paymentTransitNumber", ""),
            "paymentAccountNumber": profile.get("paymentAccountNumber", ""),
            "paymentEmail": profile.get("paymentEmail", ""),
            "stripeAccountId": profile.get("stripeAccountId", ""),
            "stripePublishableKey": profile.get("stripePublishableKey", ""),
            "stripeConnected": bool(profile.get("stripeAccountId")),
            "hasLogo": bool(profile.get("logoDataUrl")),
            "updatedAt": now,
            "createdAt": profile.get("createdAt") or now,
        }
    )


def _item_to_profile(item: Optional[Dict[str, Any]], sub: str) -> Dict[str, Any]:
    base = {
        "companyName": "",
        "ownerName": "",
        "email": "",
        "phone": "",
        "streetAddress": "",
        "city": "",
        "province": "ON",
        "postalCode": "",
        "logoDataUrl": "",
        "gstHstNumber": "",
        "invoiceNumberPrefix": "INV",
        "invoiceNumberYear": str(datetime.now().year),
        "paymentAccountName": "",
        "paymentInstitutionName": "",
        "paymentInstitutionNumber": "",
        "paymentTransitNumber": "",
        "paymentAccountNumber": "",
        "paymentEmail": "",
        "stripeAccountId": "",
        "stripePublishableKey": "",
        "stripeWebhookSecret": "",
    }
    if not item:
        return base
    item = _from_decimal(item)
    base.update(
        {
            "companyName": item.get("companyName", ""),
            "ownerName": item.get("ownerName", ""),
            "email": item.get("email", ""),
            "phone": item.get("phone", ""),
            "streetAddress": item.get("streetAddress", ""),
            "city": item.get("city", ""),
            "province": item.get("province", "ON"),
            "postalCode": item.get("postalCode", ""),
            "gstHstNumber": item.get("gstHstNumber", ""),
            "invoiceNumberPrefix": item.get("invoicePrefix", "INV"),
            "invoiceNumberYear": item.get("invoiceNumberYear", str(datetime.now().year)),
            "paymentAccountName": item.get("paymentAccountName", ""),
            "paymentInstitutionName": item.get("paymentInstitutionName", ""),
            "paymentInstitutionNumber": item.get("paymentInstitutionNumber", ""),
            "paymentTransitNumber": item.get("paymentTransitNumber", ""),
            "paymentAccountNumber": item.get("paymentAccountNumber", ""),
            "paymentEmail": item.get("paymentEmail", ""),
            "stripeAccountId": item.get("stripeAccountId", ""),
            "stripePublishableKey": item.get("stripePublishableKey", ""),
        }
    )
    base = _attach_logo(sub, base)
    return base


def _client_to_item(sub: str, client: Dict[str, Any]) -> Dict[str, Any]:
    cid = str(client.get("id") or f"cl-{int(datetime.now().timestamp() * 1000)}")
    now = _now()
    return _to_decimal(
        {
            "pk": _user_pk(sub),
            "sk": f"CLIENT#{cid}",
            "entityType": "CLIENT",
            "id": cid,
            "name": client.get("name", ""),
            "company": client.get("company", ""),
            "email": client.get("email", ""),
            "phone": client.get("phone", ""),
            "streetAddress": client.get("streetAddress", ""),
            "city": client.get("city", ""),
            "province": client.get("province", "ON"),
            "postalCode": client.get("postalCode", ""),
            "gstHstNumber": client.get("gstHstNumber", ""),
            "totalInvoiced": client.get("totalInvoiced", 0),
            "createdAt": client.get("createdAt") or now,
            "updatedAt": now,
        }
    )


def _item_to_client(item: Dict[str, Any]) -> Dict[str, Any]:
    item = _from_decimal(item)
    return {
        "id": item.get("id", ""),
        "name": item.get("name", ""),
        "company": item.get("company", ""),
        "email": item.get("email", ""),
        "phone": item.get("phone", ""),
        "streetAddress": item.get("streetAddress", ""),
        "city": item.get("city", ""),
        "province": item.get("province", "ON"),
        "postalCode": item.get("postalCode", ""),
        "gstHstNumber": item.get("gstHstNumber", ""),
        "totalInvoiced": item.get("totalInvoiced", 0),
    }


def _catalog_to_item(sub: str, row: Dict[str, Any]) -> Dict[str, Any]:
    cid = str(row.get("id") or int(datetime.now().timestamp() * 1000))
    now = _now()
    return _to_decimal(
        {
            "pk": _user_pk(sub),
            "sk": f"CATALOG#{cid}",
            "entityType": "CATALOG",
            "id": int(cid) if str(cid).isdigit() else cid,
            "type": row.get("type", "Service"),
            "name": row.get("name", ""),
            "unit": row.get("unit", "Hour"),
            "defaultPrice": row.get("defaultPrice", 0),
            "taxRate": row.get("taxRate", 0),
            "createdAt": row.get("createdAt") or now,
            "updatedAt": now,
        }
    )


def _item_to_catalog(item: Dict[str, Any]) -> Dict[str, Any]:
    item = _from_decimal(item)
    return {
        "id": item.get("id"),
        "type": item.get("type", "Service"),
        "name": item.get("name", ""),
        "unit": item.get("unit", "Hour"),
        "defaultPrice": item.get("defaultPrice", 0),
        "taxRate": item.get("taxRate", 0),
    }


def _invoice_lines_totals(lines: List[Dict[str, Any]]) -> Tuple[float, float, float]:
    subtotal = 0.0
    tax = 0.0
    for line in lines:
        qty = float(line.get("quantity") or 0)
        price = float(line.get("price") or line.get("customPrice") or line.get("defaultPrice") or 0)
        rate = float(line.get("taxRate") or 0)
        line_sub = qty * price
        subtotal += line_sub
        tax += line_sub * rate / 100.0
    total = subtotal + tax
    return round(subtotal, 2), round(tax, 2), round(total, 2)


def _invoice_to_item(sub: str, inv: Dict[str, Any], lines: Optional[List[Dict[str, Any]]] = None) -> Dict[str, Any]:
    iid = str(inv.get("id") or f"inv-{int(datetime.now().timestamp() * 1000)}")
    status_raw = inv.get("status", "Open")
    status_gsi = _status_gsi(status_raw)
    client_id = str(inv.get("clientId") or "")
    subtotal = float(inv.get("subtotal") or 0)
    tax = float(inv.get("tax") or 0)
    total = float(inv.get("total") or inv.get("totalAmount") or 0)
    if lines:
        subtotal, tax, total = _invoice_lines_totals(lines)
    now = _now()
    item: Dict[str, Any] = {
        "pk": _user_pk(sub),
        "sk": f"INVOICE#{iid}",
        "entityType": "INVOICE",
        "id": iid,
        "invoiceNumber": inv.get("invoiceNumber", ""),
        "clientId": client_id,
        "clientName": inv.get("client") or inv.get("clientName") or "",
        "issueDate": inv.get("issueDate", ""),
        "dueDate": inv.get("dueDate", ""),
        "status": status_gsi,
        "subtotal": subtotal,
        "tax": tax,
        "total": total,
        "totalAmount": total,
        "paidAmount": inv.get("paidAmount", 0),
        "currency": inv.get("currency", "CAD"),
        "pdfObjectKey": inv.get("pdfObjectKey", ""),
        "paymentChannel": inv.get("paymentChannel", ""),
        "GSI1PK": _user_pk(sub),
        "GSI1SK": f"STATUS#{status_gsi}",
        "createdAt": inv.get("createdAt") or now,
        "updatedAt": now,
    }
    if client_id:
        item["GSI2PK"] = f"USER#{sub}#CLIENT#{client_id}"
        item["GSI2SK"] = f"INVOICE#{iid}"
    return _to_decimal(item)


def _line_to_item(sub: str, invoice_id: str, index: int, line: Dict[str, Any]) -> Dict[str, Any]:
    qty = float(line.get("quantity") or 0)
    price = float(line.get("price") or line.get("customPrice") or line.get("defaultPrice") or 0)
    rate = float(line.get("taxRate") or 0)
    line_sub = qty * price
    line_tax = line_sub * rate / 100.0
    line_total = line_sub + line_tax
    return _to_decimal(
        {
            "pk": _user_pk(sub),
            "sk": f"INVOICEITEM#{invoice_id}#{index}",
            "entityType": "INVOICEITEM",
            "invoiceId": invoice_id,
            "lineIndex": index,
            "name": line.get("name", ""),
            "unit": line.get("unit", "Hour"),
            "quantity": qty,
            "price": price,
            "taxRate": rate,
            "subtotal": round(line_sub, 2),
            "tax": round(line_tax, 2),
            "total": round(line_total, 2),
        }
    )


def _item_to_invoice(item: Dict[str, Any], line_items: List[Dict[str, Any]]) -> Dict[str, Any]:
    item = _from_decimal(item)
    return {
        "id": item.get("id", ""),
        "invoiceNumber": item.get("invoiceNumber", ""),
        "clientId": item.get("clientId", ""),
        "client": item.get("clientName") or item.get("client", ""),
        "issueDate": item.get("issueDate", ""),
        "dueDate": item.get("dueDate", ""),
        "totalAmount": item.get("totalAmount") or item.get("total") or 0,
        "paidAmount": item.get("paidAmount", 0),
        "status": _invoice_status_ui(item.get("status", "OPEN")),
        "paymentChannel": item.get("paymentChannel") or None,
        "pdfObjectKey": item.get("pdfObjectKey") or None,
        "subtotal": item.get("subtotal", 0),
        "tax": item.get("tax", 0),
        "total": item.get("total") or item.get("totalAmount") or 0,
        "lines": [
            {
                "name": li.get("name", ""),
                "unit": li.get("unit", "Hour"),
                "quantity": li.get("quantity", 0),
                "price": li.get("price", 0),
                "taxRate": li.get("taxRate", 0),
                "total": li.get("total", 0),
            }
            for li in (_from_decimal(raw) for raw in line_items)
        ],
    }


def _batch_write(items: List[Dict[str, Any]], deletes: Optional[List[Dict[str, str]]] = None) -> None:
    table = _table()
    deletes = deletes or []
    with table.batch_writer() as batch:
        for key in deletes:
            batch.delete_item(Key=key)
        for item in items:
            batch.put_item(Item=item)


def _delete_prefix_items(pk: str, sk_prefix: str, keep_sks: Optional[set] = None) -> None:
    keep_sks = keep_sks or set()
    to_delete = []
    for item in _query_prefix(pk, sk_prefix):
        if item["sk"] not in keep_sks:
            to_delete.append({"pk": pk, "sk": item["sk"]})
    if to_delete:
        _batch_write([], to_delete)


def _load_legacy_workspace_blob(sub: str) -> Optional[Dict[str, Any]]:
    pk = _user_pk(sub)
    item = _table().get_item(Key={"pk": pk, "sk": LEGACY_WORKSPACE_SK}).get("Item")
    if item and item.get("payload"):
        try:
            data = json.loads(str(item["payload"]))
            data.setdefault("profile", {})
            data["profile"] = _attach_logo(sub, data.get("profile") or {})
            return data
        except (json.JSONDecodeError, TypeError):
            return None
    legacy_key = f"workspace/{sub}/workspace.json"
    try:
        obj = s3.get_object(Bucket=INVOICE_BUCKET, Key=legacy_key)
        return json.loads(obj["Body"].read().decode("utf-8"))
    except ClientError:
        return None


def migrate_legacy_workspace_if_needed(sub: str) -> bool:
    """Import WORKSPACE#v1 blob into single-table entities; return True if migrated."""
    pk = _user_pk(sub)
    profile = _table().get_item(Key={"pk": pk, "sk": PROFILE_SK}).get("Item")
    if profile:
        return False
    legacy = _load_legacy_workspace_blob(sub)
    if not legacy:
        return False
    sync_workspace(sub, legacy, full_sync=True)
    try:
        _table().delete_item(Key={"pk": pk, "sk": LEGACY_WORKSPACE_SK})
    except ClientError:
        pass
    return True


def _repair_invoices_from_orphan_items(sub: str) -> List[Dict[str, Any]]:
    """Rebuild invoice headers when INVOICEITEM rows exist without INVOICE# (partial sync bug)."""
    pk = _user_pk(sub)
    line_rows = _query_prefix(pk, "INVOICEITEM#")
    if not line_rows:
        return []
    by_id: Dict[str, List[Dict[str, Any]]] = {}
    for row in line_rows:
        data = _from_decimal(row)
        iid = str(data.get("invoiceId") or "")
        if not iid:
            continue
        by_id.setdefault(iid, []).append(data)
    pdf_keys = _list_invoice_pdf_keys(sub)
    unassigned_pdfs = set(pdf_keys)
    repaired: List[Dict[str, Any]] = []
    for iid, lines in by_id.items():
        if _table().get_item(Key={"pk": pk, "sk": f"INVOICE#{iid}"}).get("Item"):
            continue
        lines_sorted = sorted(lines, key=lambda x: int(x.get("lineIndex") or 0))
        subtotal = sum(float(l.get("subtotal") or 0) for l in lines_sorted)
        tax = sum(float(l.get("tax") or 0) for l in lines_sorted)
        total = sum(float(l.get("total") or 0) for l in lines_sorted)
        pdf_key = _find_pdf_key(sub, iid, "", sorted(unassigned_pdfs))
        if pdf_key:
            unassigned_pdfs.discard(pdf_key)
        invoice_number = _invoice_number_from_pdf_key(pdf_key) if pdf_key else ""
        inv = {
            "id": iid,
            "invoiceNumber": invoice_number,
            "clientId": "",
            "client": "",
            "issueDate": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
            "dueDate": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
            "subtotal": round(subtotal, 2),
            "tax": round(tax, 2),
            "totalAmount": round(total, 2),
            "paidAmount": 0,
            "status": "Open",
            "lines": [
                {
                    "name": l.get("name", ""),
                    "unit": l.get("unit", "Hour"),
                    "quantity": l.get("quantity", 0),
                    "price": l.get("price", 0),
                    "taxRate": l.get("taxRate", 0),
                    "total": l.get("total", 0),
                }
                for l in lines_sorted
            ],
        }
        if pdf_key:
            inv["pdfObjectKey"] = pdf_key
        repaired.append(_item_to_invoice(_invoice_to_item(sub, inv, inv["lines"]), lines_sorted))
        _batch_write([_invoice_to_item(sub, inv, inv["lines"])])
    return repaired


def _persist_invoice_corrections(sub: str, invoices: List[Dict[str, Any]]) -> None:
    items: List[Dict[str, Any]] = []
    for inv in invoices:
        iid = str(inv.get("id") or "")
        if not iid:
            continue
        lines = inv.get("lines")
        items.append(_invoice_to_item(sub, inv, lines if lines else None))
    if items:
        _batch_write(items)


def load_bootstrap(sub: str) -> Dict[str, Any]:
    migrate_legacy_workspace_if_needed(sub)
    pk = _user_pk(sub)

    profile_item = _table().get_item(Key={"pk": pk, "sk": PROFILE_SK}).get("Item")
    profile = _item_to_profile(profile_item, sub)

    clients = [_item_to_client(i) for i in _query_prefix(pk, "CLIENT#")]
    catalog = [_item_to_catalog(i) for i in _query_prefix(pk, "CATALOG#")]

    invoices: List[Dict[str, Any]] = []
    pdf_keys = _list_invoice_pdf_keys(sub)
    corrections: List[Dict[str, Any]] = []
    for inv_item in _query_prefix(pk, "INVOICE#"):
        iid = str(_from_decimal(inv_item).get("id") or inv_item["sk"].split("#", 1)[1])
        lines = _query_prefix(pk, f"INVOICEITEM#{iid}#")
        lines_sorted = sorted(lines, key=lambda x: int(_from_decimal(x).get("lineIndex") or 0))
        inv = _item_to_invoice(inv_item, lines_sorted)
        fixed = _normalize_invoice_fields(sub, inv, pdf_keys)
        if fixed.get("invoiceNumber") != inv.get("invoiceNumber") or fixed.get("pdfObjectKey") != inv.get(
            "pdfObjectKey"
        ):
            corrections.append(fixed)
        invoices.append(fixed)

    if not invoices:
        invoices = _repair_invoices_from_orphan_items(sub)
    elif corrections:
        _persist_invoice_corrections(sub, corrections)

    draft_item = _table().get_item(Key={"pk": pk, "sk": DRAFT_SK}).get("Item")
    draft: Dict[str, Any] = {}
    if draft_item and draft_item.get("payload"):
        try:
            draft = json.loads(str(draft_item["payload"]))
        except (json.JSONDecodeError, TypeError):
            draft = {}

    last_pdf = draft.get("lastPdf")
    return {
        "profile": profile,
        "catalog": catalog,
        "clients": clients,
        "invoices": invoices,
        "draftLines": draft.get("draftLines") or [],
        "clientName": draft.get("clientName") or "",
        "clientGstHstNumber": draft.get("clientGstHstNumber") or "",
        "clientId": draft.get("clientId") or "",
        "meta": draft.get("meta") or {},
        "lastPdf": last_pdf,
        "storage": "single-table",
    }


def sync_workspace(sub: str, workspace: Dict[str, Any], *, full_sync: bool = False) -> None:
    """Decompose frontend workspace snapshot into single-table items.

    Empty arrays must not wipe existing CLIENT/CATALOG/INVOICE rows (auto-save race on login).
    Pass full_sync=True for explicit replace (export, Settings Save).
    """
    pk = _user_pk(sub)
    profile = workspace.get("profile") or {}
    items: List[Dict[str, Any]] = []

    existing_profile = _table().get_item(Key={"pk": pk, "sk": PROFILE_SK}).get("Item")
    profile_has_data = bool(str(profile.get("companyName") or profile.get("email") or "").strip())
    existing_has_data = bool(
        existing_profile and str(existing_profile.get("companyName") or existing_profile.get("email") or "").strip()
    )
    if profile_has_data or full_sync or not existing_has_data:
        _save_logo(sub, profile, preserve_existing=not full_sync)
        items.append(_profile_to_item(sub, profile))

    clients = workspace.get("clients") or []
    if clients or full_sync:
        client_ids = set()
        for c in clients:
            item = _client_to_item(sub, c)
            client_ids.add(item["sk"])
            items.append(item)
        if clients or full_sync:
            _delete_prefix_items(pk, "CLIENT#", client_ids)

    catalog = workspace.get("catalog") or []
    if catalog or full_sync:
        catalog_sks = set()
        for row in catalog:
            item = _catalog_to_item(sub, row)
            catalog_sks.add(item["sk"])
            items.append(item)
        if catalog or full_sync:
            _delete_prefix_items(pk, "CATALOG#", catalog_sks)

    invoices = workspace.get("invoices") or []
    line_items: List[Dict[str, Any]] = []
    if invoices or full_sync:
        invoice_ids = set()
        for inv in invoices:
            iid = str(inv.get("id") or f"inv-{int(datetime.now().timestamp() * 1000)}")
            inv_lines_payload = inv.get("lines")
            if inv_lines_payload is not None:
                lines_for_totals = inv_lines_payload
            else:
                existing = _query_prefix(pk, f"INVOICEITEM#{iid}#")
                lines_for_totals = [_from_decimal(li) for li in existing]
            items.append(_invoice_to_item(sub, inv, lines_for_totals if lines_for_totals else None))
            invoice_ids.add(f"INVOICE#{iid}")
            if inv_lines_payload is not None:
                _delete_prefix_items(pk, f"INVOICEITEM#{iid}#")
                for idx, line in enumerate(inv_lines_payload, start=1):
                    line_items.append(_line_to_item(sub, iid, idx, line))
        if invoices or full_sync:
            _delete_prefix_items(pk, "INVOICE#", invoice_ids)
        items.extend(line_items)

    draft_payload = {
        "draftLines": workspace.get("draftLines") or [],
        "clientName": workspace.get("clientName") or "",
        "clientGstHstNumber": workspace.get("clientGstHstNumber") or "",
        "clientId": workspace.get("clientId") or "",
        "meta": workspace.get("meta") or {},
        "lastPdf": workspace.get("lastPdf"),
    }
    meta = draft_payload.get("meta") or {}
    draft_has_data = bool(
        draft_payload.get("draftLines")
        or draft_payload.get("clientName")
        or str(meta.get("invoiceNumber") or "").strip()
    )
    if draft_has_data or full_sync or not _table().get_item(Key={"pk": pk, "sk": DRAFT_SK}).get("Item"):
        items.append(
            {
                "pk": pk,
                "sk": DRAFT_SK,
                "entityType": "DRAFT",
                "payload": json.dumps(draft_payload, separators=(",", ":")),
                "updatedAt": _now(),
            }
        )

    if items:
        _batch_write(items)


def create_invoice_with_items(sub: str, invoice: Dict[str, Any], lines: List[Dict[str, Any]]) -> Dict[str, Any]:
    iid = str(invoice.get("id") or f"inv-{int(datetime.now().timestamp() * 1000)}")
    invoice = {**invoice, "id": iid}
    items = [_invoice_to_item(sub, invoice, lines)]
    for idx, line in enumerate(lines, start=1):
        items.append(_line_to_item(sub, iid, idx, line))
    _batch_write(items)
    return _item_to_invoice(items[0], items[1:])


def delete_invoice(sub: str, invoice_id: str, invoice_number: str) -> Dict[str, Any]:
    """Delete invoice header, line items, and optional S3 PDF after invoice-number confirmation."""
    pk = _user_pk(sub)
    iid = str(invoice_id or "").strip()
    num = str(invoice_number or "").strip()
    if not iid or not num:
        raise ValueError("invoiceId and invoiceNumber are required")

    item = _table().get_item(Key={"pk": pk, "sk": f"INVOICE#{iid}"}).get("Item")
    if not item:
        raise LookupError("Invoice not found")

    item = _from_decimal(item)
    stored_num = str(item.get("invoiceNumber") or "").strip()
    if stored_num != num:
        raise ValueError("Invoice number does not match")

    deletes = [{"pk": pk, "sk": f"INVOICE#{iid}"}]
    for line in _query_prefix(pk, f"INVOICEITEM#{iid}#"):
        deletes.append({"pk": pk, "sk": line["sk"]})
    _batch_write([], deletes)

    pdf_key = str(item.get("pdfObjectKey") or "").strip()
    prefix = f"invoices/{sub}/"
    if pdf_key.startswith(prefix) and ".." not in pdf_key:
        try:
            s3.delete_object(Bucket=INVOICE_BUCKET, Key=pdf_key)
        except ClientError:
            pass

    return {"invoiceId": iid, "invoiceNumber": stored_num}


def _client_id_display(cid: str) -> str:
    raw = str(cid or "").strip()
    match = re.match(r"^cl-(\d+)$", raw, re.I)
    if match and len(match.group(1)) <= 4:
        return f"CL-{int(match.group(1)):03d}"
    return raw.upper()


def delete_client(sub: str, client_id: str, client_id_confirm: str) -> Dict[str, Any]:
    """Delete a client after the user confirms by typing the client ID."""
    pk = _user_pk(sub)
    cid = str(client_id or "").strip()
    confirm = str(client_id_confirm or "").strip()
    if not cid or not confirm:
        raise ValueError("clientId and clientIdConfirm are required")

    item = _table().get_item(Key={"pk": pk, "sk": f"CLIENT#{cid}"}).get("Item")
    if not item:
        raise LookupError("Client not found")

    item = _from_decimal(item)
    stored_id = str(item.get("id") or cid).strip()
    if _client_id_display(stored_id) != _client_id_display(confirm):
        raise ValueError("Client ID does not match")

    _batch_write([], [{"pk": pk, "sk": f"CLIENT#{cid}"}])
    return {"clientId": stored_id, "clientIdDisplay": _client_id_display(stored_id)}


def query_invoices_by_status(sub: str, status: str) -> List[Dict[str, Any]]:
    pk = _user_pk(sub)
    status_key = _status_gsi(status)
    items: List[Dict[str, Any]] = []
    kwargs: Dict[str, Any] = {
        "IndexName": "GSI1",
        "KeyConditionExpression": Key("GSI1PK").eq(pk) & Key("GSI1SK").eq(f"STATUS#{status_key}"),
    }
    while True:
        resp = _table().query(**kwargs)
        items.extend(resp.get("Items", []))
        if "LastEvaluatedKey" not in resp:
            break
        kwargs["ExclusiveStartKey"] = resp["LastEvaluatedKey"]
    result = []
    for inv_item in items:
        iid = str(_from_decimal(inv_item).get("id") or "")
        lines = _query_prefix(pk, f"INVOICEITEM#{iid}#")
        lines_sorted = sorted(lines, key=lambda x: int(_from_decimal(x).get("lineIndex") or 0))
        result.append(_item_to_invoice(inv_item, lines_sorted))
    return result


def query_invoices_by_client(sub: str, client_id: str) -> List[Dict[str, Any]]:
    gsi_pk = f"USER#{sub}#CLIENT#{client_id}"
    items: List[Dict[str, Any]] = []
    kwargs: Dict[str, Any] = {
        "IndexName": "GSI2",
        "KeyConditionExpression": Key("GSI2PK").eq(gsi_pk),
    }
    while True:
        resp = _table().query(**kwargs)
        items.extend(resp.get("Items", []))
        if "LastEvaluatedKey" not in resp:
            break
        kwargs["ExclusiveStartKey"] = resp["LastEvaluatedKey"]
    pk = _user_pk(sub)
    result = []
    for inv_item in items:
        iid = str(_from_decimal(inv_item).get("id") or "")
        lines = _query_prefix(pk, f"INVOICEITEM#{iid}#")
        lines_sorted = sorted(lines, key=lambda x: int(_from_decimal(x).get("lineIndex") or 0))
        result.append(_item_to_invoice(inv_item, lines_sorted))
    return result
