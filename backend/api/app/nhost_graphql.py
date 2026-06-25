import re
from typing import Any

import httpx
from fastapi import HTTPException, status

from .config import Settings


IDENTIFIER_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
FILTER_OPS = {
    "eq": "_eq",
    "neq": "_neq",
    "gt": "_gt",
    "gte": "_gte",
    "lt": "_lt",
    "lte": "_lte",
}
SCALAR_KINDS = {"SCALAR", "ENUM"}
SCALAR_FIELD_CACHE: dict[tuple[str, str], list[str]] = {}


def ensure_identifier(value: str) -> str:
    if not IDENTIFIER_RE.match(value):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Invalid identifier: {value}")
    return value


def split_select(raw_select: str | None) -> list[str]:
    if not raw_select:
        return []
    tokens: list[str] = []
    depth = 0
    current = ""
    for char in raw_select:
        if char == "(":
            depth += 1
        elif char == ")":
            depth = max(depth - 1, 0)
        if char == "," and depth == 0:
            token = current.strip()
            if token:
                tokens.append(token)
            current = ""
            continue
        current += char
    token = current.strip()
    if token:
        tokens.append(token)
    return tokens


def parse_select_fields(raw_select: str | None) -> list[str]:
    if not raw_select or raw_select.strip() == "*":
        return []
    fields: list[str] = []
    for token in split_select(raw_select):
        if not token or token == "*" or "(" in token or ")" in token:
            continue
        if ":" in token:
            token = token.split(":", 1)[0]
        token = token.strip()
        if token and token != "*":
            fields.append(ensure_identifier(token))
    return list(dict.fromkeys(fields))


def unwrap_type(type_info: dict[str, Any] | None) -> dict[str, Any] | None:
    current = type_info
    while isinstance(current, dict) and current.get("ofType"):
        current = current.get("ofType")
    return current if isinstance(current, dict) else None


async def scalar_fields(settings: Settings, table: str, token: str | None) -> list[str]:
    cache_key = (settings.resolved_nhost_graphql_url, table)
    cached = SCALAR_FIELD_CACHE.get(cache_key)
    if cached:
        return cached
    query = """
      query IntrospectTable($name: String!) {
        __type(name: $name) {
          fields {
            name
            type {
              kind
              name
              ofType { kind name ofType { kind name } }
            }
          }
        }
      }
    """
    body = await graphql_request(settings, {"query": query, "variables": {"name": table}}, token)
    fields = []
    for field in (((body.get("data") or {}).get("__type") or {}).get("fields") or []):
        unwrapped = unwrap_type(field.get("type"))
        if unwrapped and unwrapped.get("kind") in SCALAR_KINDS:
            name = field.get("name")
            if isinstance(name, str) and not name.startswith("_"):
                fields.append(name)
    if not fields:
        fields = ["id"]
    SCALAR_FIELD_CACHE[cache_key] = fields
    return fields


async def graphql_request(settings: Settings, payload: dict[str, Any], token: str | None = None) -> dict[str, Any]:
    if not settings.resolved_nhost_graphql_url:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Nhost GraphQL is not configured.")
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if settings.nhost_admin_secret:
        headers["x-hasura-admin-secret"] = settings.nhost_admin_secret
    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.post(settings.resolved_nhost_graphql_url, json=payload, headers=headers)
    if response.status_code >= 400:
        raise HTTPException(status_code=response.status_code, detail=response.text)
    body = response.json()
    if body.get("errors"):
        message = body["errors"][0].get("message") if isinstance(body["errors"][0], dict) else "GraphQL request failed."
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=message)
    return body


def build_where(filters: list[dict[str, Any]]) -> dict[str, Any]:
    clauses: list[dict[str, Any]] = []
    for item in filters:
        op = item.get("op")
        column = item.get("column")
        value = item.get("value")

        if op == "match" and isinstance(value, dict):
            for key, val in value.items():
                clauses.append({ensure_identifier(str(key)): {"_eq": val}})
            continue

        if op == "or" and isinstance(value, str):
            or_clauses = parse_or_filter(value)
            if or_clauses:
                clauses.append({"_or": or_clauses})
            continue

        if not column:
            continue
        col = ensure_identifier(str(column))
        if op in FILTER_OPS:
            clauses.append({col: {FILTER_OPS[op]: value}})
        elif op == "in":
            clauses.append({col: {"_in": value if isinstance(value, list) else []}})
        elif op == "is":
            clauses.append({col: {"_is_null": value is None}})
        elif op == "contains":
            clauses.append({col: {"_contains": value}})
        elif op == "ilike":
            clauses.append({col: {"_ilike": value}})

    if not clauses:
        return {}
    if len(clauses) == 1:
        return clauses[0]
    return {"_and": clauses}


def parse_or_filter(value: str) -> list[dict[str, Any]]:
    clauses: list[dict[str, Any]] = []
    for raw in value.split(","):
        bits = raw.strip().split(".", 2)
        if len(bits) != 3:
            continue
        column, op, raw_value = bits
        col = ensure_identifier(column)
        if op == "is" and raw_value == "null":
            clauses.append({col: {"_is_null": True}})
        elif op in FILTER_OPS:
            clauses.append({col: {FILTER_OPS[op]: raw_value}})
    return clauses


def build_order(order_items: list[dict[str, Any]] | None) -> list[dict[str, str]] | None:
    if not order_items:
        return None
    orders = []
    for item in order_items:
        if not isinstance(item, dict) or not item.get("column"):
            continue
        orders.append({ensure_identifier(str(item["column"])): "asc" if item.get("ascending", True) else "desc"})
    return orders or None


def range_to_limit_offset(payload: dict[str, Any]) -> tuple[int | None, int | None]:
    if isinstance(payload.get("range"), dict):
        start = max(int(payload["range"].get("from", 0)), 0)
        end = max(int(payload["range"].get("to", start)), start)
        return end - start + 1, start
    if payload.get("limit") is not None:
        return max(int(payload["limit"]), 0), None
    return None, None


def normalize_rows(payload: Any) -> list[dict[str, Any]]:
    rows = payload if isinstance(payload, list) else [payload]
    if not all(isinstance(row, dict) for row in rows):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Payload must be an object or object array.")
    return rows


def shape_rows(rows: list[dict[str, Any]], single: bool, maybe_single: bool, count: int | None = None) -> dict[str, Any]:
    if single or maybe_single:
        return {"data": rows[0] if rows else None, "error": None, "count": count}
    return {"data": rows, "error": None, "count": count}


async def execute_nhost_table_query(
    settings: Settings,
    table: str,
    payload: dict[str, Any],
    token: str | None = None,
) -> dict[str, Any]:
    table = ensure_identifier(table)
    action = payload.get("action", "select")
    filters = payload.get("filters") if isinstance(payload.get("filters"), list) else []
    where = build_where(filters)
    fields = parse_select_fields(payload.get("select")) or await scalar_fields(settings, table, token)
    selection = "\n".join(fields)
    single = bool(payload.get("single"))
    maybe_single = bool(payload.get("maybeSingle"))

    if action == "select":
        limit, offset = range_to_limit_offset(payload)
        include_count = bool(payload.get("count"))
        query = f"""
          query TableSelect($where: {table}_bool_exp, $limit: Int, $offset: Int, $order_by: [{table}_order_by!], $includeCount: Boolean!) {{
            rows: {table}(where: $where, limit: $limit, offset: $offset, order_by: $order_by) {{
              {selection}
            }}
            aggregate: {table}_aggregate(where: $where) @include(if: $includeCount) {{
              aggregate {{ count }}
            }}
          }}
        """
        variables = {
            "where": where,
            "limit": limit,
            "offset": offset,
            "order_by": build_order(payload.get("order")),
            "includeCount": include_count,
        }
        body = await graphql_request(settings, {"query": query, "variables": variables}, token)
        data = body.get("data") or {}
        count = (((data.get("aggregate") or {}).get("aggregate") or {}).get("count") if include_count else None)
        if payload.get("head"):
            return {"data": None, "error": None, "count": count}
        return shape_rows(data.get("rows") or [], single, maybe_single, count)

    if action == "insert":
        rows = normalize_rows(payload.get("payload"))
        mutation = f"""
          mutation TableInsert($objects: [{table}_insert_input!]!) {{
            result: insert_{table}(objects: $objects) {{
              returning {{ {selection} }}
            }}
          }}
        """
        body = await graphql_request(settings, {"query": mutation, "variables": {"objects": rows}}, token)
        returning = (((body.get("data") or {}).get("result") or {}).get("returning") or [])
        return shape_rows(returning, single, maybe_single)

    if action == "update":
        row = payload.get("payload")
        if not isinstance(row, dict) or not row:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Update payload must be an object.")
        return await update_rows(settings, table, where, row, selection, token, single, maybe_single)

    if action == "upsert":
        rows = normalize_rows(payload.get("payload"))
        conflict_columns = [col.strip() for col in str(payload.get("onConflict") or "").split(",") if col.strip()]
        returning: list[dict[str, Any]] = []
        for row in rows:
            if conflict_columns and all(col in row for col in conflict_columns):
                conflict_where = build_where([{"op": "eq", "column": col, "value": row[col]} for col in conflict_columns])
                updated = await update_rows(settings, table, conflict_where, row, selection, token, False, False)
                updated_rows = updated.get("data") if isinstance(updated.get("data"), list) else []
                if updated_rows:
                    returning.extend(updated_rows)
                    continue
            inserted = await execute_nhost_table_query(
                settings,
                table,
                {"action": "insert", "payload": row, "select": payload.get("select")},
                token,
            )
            inserted_rows = inserted.get("data") if isinstance(inserted.get("data"), list) else [inserted.get("data")]
            returning.extend([item for item in inserted_rows if isinstance(item, dict)])
        return shape_rows(returning, single, maybe_single)

    if action == "delete":
        mutation = f"""
          mutation TableDelete($where: {table}_bool_exp!) {{
            result: delete_{table}(where: $where) {{
              returning {{ {selection} }}
            }}
          }}
        """
        body = await graphql_request(settings, {"query": mutation, "variables": {"where": where}}, token)
        returning = (((body.get("data") or {}).get("result") or {}).get("returning") or [])
        return shape_rows(returning, single, maybe_single)

    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Unsupported action: {action}")


async def update_rows(
    settings: Settings,
    table: str,
    where: dict[str, Any],
    values: dict[str, Any],
    selection: str,
    token: str | None,
    single: bool,
    maybe_single: bool,
) -> dict[str, Any]:
    mutation = f"""
      mutation TableUpdate($where: {table}_bool_exp!, $set: {table}_set_input!) {{
        result: update_{table}(where: $where, _set: $set) {{
          returning {{ {selection} }}
        }}
      }}
    """
    body = await graphql_request(settings, {"query": mutation, "variables": {"where": where, "set": values}}, token)
    returning = (((body.get("data") or {}).get("result") or {}).get("returning") or [])
    return shape_rows(returning, single, maybe_single)


async def execute_nhost_rpc(settings: Settings, name: str, params: dict[str, Any], token: str | None = None) -> dict[str, Any]:
    name = ensure_identifier(name)
    arg_defs = []
    arg_uses = []
    variables: dict[str, Any] = {}
    for key, value in params.items():
        key = ensure_identifier(str(key))
        var_name = f"arg_{key}"
        arg_defs.append(f"${var_name}: jsonb")
        arg_uses.append(f"{key}: ${var_name}")
        variables[var_name] = value
    args = f"({', '.join(arg_uses)})" if arg_uses else ""
    query = f"query Rpc({', '.join(arg_defs)}) {{ result: {name}{args} }}"
    body = await graphql_request(settings, {"query": query, "variables": variables}, token)
    return {"data": (body.get("data") or {}).get("result"), "error": None}


async def schema_contract_status(
    settings: Settings,
    required_columns: dict[str, list[str]],
    token: str | None = None,
) -> dict[str, Any]:
    query = """
      query SchemaContract {
        __schema {
          queryType { fields { name } }
          mutationType { fields { name } }
        }
      }
    """
    body = await graphql_request(settings, {"query": query}, token)
    schema = (body.get("data") or {}).get("__schema") or {}
    query_fields = {
        field.get("name")
        for field in (((schema.get("queryType") or {}).get("fields")) or [])
        if isinstance(field.get("name"), str)
    }
    mutation_fields = {
        field.get("name")
        for field in (((schema.get("mutationType") or {}).get("fields")) or [])
        if isinstance(field.get("name"), str)
    }

    table_status: dict[str, dict[str, Any]] = {}
    for table, required in required_columns.items():
        table = ensure_identifier(table)
        available = table in query_fields
        fields = await scalar_fields(settings, table, token) if available else []
        missing_columns = [column for column in required if column not in fields]
        table_status[table] = {
            "available": available,
            "columns": fields,
            "missingColumns": missing_columns,
            "canInsert": f"insert_{table}" in mutation_fields,
            "canUpdate": f"update_{table}" in mutation_fields,
        }

    missing_tables = [table for table, info in table_status.items() if not info["available"]]
    missing_columns = {
        table: info["missingColumns"]
        for table, info in table_status.items()
        if info["available"] and info["missingColumns"]
    }

    return {
        "provider": "nhost_graphql",
        "ok": not missing_tables and not missing_columns,
        "missingTables": missing_tables,
        "missingColumns": missing_columns,
        "queryFields": sorted(str(field) for field in query_fields),
        "tables": table_status,
    }
