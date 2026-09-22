import json
import re
from datetime import datetime
from typing import Any

import asyncpg
from fastapi import HTTPException, status

from .config import Settings


IDENTIFIER_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
ISO_DATETIME_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?$")
FILTER_OPS = {
    "eq": "=",
    "neq": "!=",
    "gt": ">",
    "gte": ">=",
    "lt": "<",
    "lte": "<=",
}
BOOLEAN_COLUMNS = {
    "accepted",
    "age_verified",
    "beta_reports_active",
    "enabled",
    "granted",
    "is_active",
    "is_default",
    "is_instant",
    "is_locked",
    "is_online",
    "is_test_account",
    "locked",
    "signed_by_client",
    "signed_by_model",
    "signed_by_photographer",
    "unlocked",
    "verified",
}
JSON_COLUMNS = {
    "action_payload",
    "analytics_payload",
    "contact_details",
    "context",
    "equipment",
    "genres",
    "metadata",
    "payload",
    "portfolio_urls",
    "required_equipment",
    "tags",
}
NUMERIC_SUFFIXES = ("_amount", "_count", "_fee", "_km", "_lat", "_latitude", "_lng", "_longitude", "_price", "_rate", "_score", "_total")
TIMESTAMP_SUFFIXES = ("_at", "_datetime")


def quote_ident(value: str) -> str:
    if not IDENTIFIER_RE.match(value):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Invalid identifier: {value}")
    return f'"{value}"'


def parse_select(raw_select: str | None) -> str:
    if not raw_select or raw_select.strip() == "*":
        return "*"
    columns: list[str] = []
    depth = 0
    current = ""
    for char in raw_select:
        if char == "(":
            depth += 1
        elif char == ")":
            depth = max(depth - 1, 0)
        if char == "," and depth == 0:
            append_select_token(columns, current)
            current = ""
            continue
        current += char
    append_select_token(columns, current)
    return ", ".join(columns) if columns else "*"


def select_column_names(raw_select: str | None) -> list[str]:
    if not raw_select or raw_select.strip() == "*":
        return []
    columns: list[str] = []
    depth = 0
    current = ""
    for char in raw_select:
        if char == "(":
            depth += 1
        elif char == ")":
            depth = max(depth - 1, 0)
        if char == "," and depth == 0:
            append_select_name(columns, current)
            current = ""
            continue
        current += char
    append_select_name(columns, current)
    return columns


def append_select_name(columns: list[str], token: str) -> None:
    token = token.strip()
    if not token or token == "*" or "(" in token or ")" in token:
        return
    if ":" in token:
        token = token.split(":", 1)[0]
    token = token.strip()
    if token and token != "*" and IDENTIFIER_RE.match(token):
        columns.append(token)


def append_select_token(columns: list[str], token: str) -> None:
    token = token.strip()
    if not token or token == "*":
        if token == "*":
            columns.append("*")
        return
    if "(" in token or ")" in token:
        return
    if ":" in token:
        token = token.split(":", 1)[0]
    token = token.strip()
    if token and token != "*":
        columns.append(quote_ident(token))


def normalize_rows(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, list):
        rows = payload
    else:
        rows = [payload]
    if not all(isinstance(row, dict) for row in rows):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Payload must be an object or object array.")
    return rows


def normalize_db_value(value: Any) -> Any:
    if isinstance(value, (dict, list)):
        return json.dumps(value)
    if isinstance(value, str) and ISO_DATETIME_RE.match(value):
        normalized = value[:-1] + "+00:00" if value.endswith("Z") else value
        try:
            return datetime.fromisoformat(normalized)
        except ValueError:
            return value
    return value


def infer_column_type(column: str, sample: Any = None, force_json: bool = False) -> str:
    if force_json or column in JSON_COLUMNS:
        return "jsonb"
    if column in BOOLEAN_COLUMNS or column.startswith("is_") or column.startswith("has_"):
        return "boolean"
    if column.endswith(TIMESTAMP_SUFFIXES) or column in {"date", "blocked_date", "current_period_start", "current_period_end"}:
        return "timestamptz"
    if column.endswith(NUMERIC_SUFFIXES) or column in {"amount", "balance", "duration", "duration_minutes", "eta_confidence", "fanout_count", "height", "hours", "intensity_level", "limit", "rating", "rate_zar", "severity"}:
        return "double precision"
    if isinstance(sample, bool):
        return "boolean"
    if isinstance(sample, (int, float)) and not isinstance(sample, bool):
        return "double precision"
    if isinstance(sample, (dict, list)):
        return "jsonb"
    return "text"


def columns_from_filters(filters: list[dict[str, Any]]) -> dict[str, bool]:
    columns: dict[str, bool] = {}
    for item in filters:
        if item.get("op") == "match" and isinstance(item.get("value"), dict):
            for key in item["value"].keys():
                if IDENTIFIER_RE.match(str(key)):
                    columns[str(key)] = False
            continue
        column = item.get("column")
        if column and IDENTIFIER_RE.match(str(column)):
            columns[str(column)] = item.get("op") == "contains"
    return columns


async def ensure_table_exists(conn: asyncpg.Connection, table: str) -> None:
    table_sql = quote_ident(table)
    await conn.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto")
    await conn.execute(
        f"""
        CREATE TABLE IF NOT EXISTS {table_sql} (
            id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
            created_at timestamptz DEFAULT now(),
            updated_at timestamptz DEFAULT now()
        )
        """
    )


async def existing_columns(conn: asyncpg.Connection, table: str) -> dict[str, str]:
    rows = await conn.fetch(
        """
        SELECT column_name, data_type
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = $1
        """,
        table,
    )
    return {row["column_name"]: row["data_type"] for row in rows}


async def ensure_columns(
    conn: asyncpg.Connection,
    table: str,
    columns: dict[str, tuple[str, Any] | bool | None],
) -> None:
    if not columns:
        return
    await ensure_table_exists(conn, table)
    current = await existing_columns(conn, table)
    table_sql = quote_ident(table)
    for column, descriptor in columns.items():
        if column in current:
            continue
        if not IDENTIFIER_RE.match(column):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Invalid identifier: {column}")
        force_json = descriptor is True
        sample = descriptor[1] if isinstance(descriptor, tuple) else None
        column_type = infer_column_type(column, sample, force_json)
        await conn.execute(f"ALTER TABLE {table_sql} ADD COLUMN IF NOT EXISTS {quote_ident(column)} {column_type}")


async def ensure_unique_constraint(conn: asyncpg.Connection, table: str, columns: list[str]) -> None:
    if not columns:
        return
    await ensure_columns(conn, table, {column: None for column in columns})
    constraint = f"{table}_{'_'.join(columns)}_uniq"
    if not IDENTIFIER_RE.match(constraint):
        return
    try:
        await conn.execute(
            f"ALTER TABLE {quote_ident(table)} ADD CONSTRAINT {quote_ident(constraint)} UNIQUE ({', '.join(quote_ident(column) for column in columns)})"
        )
    except asyncpg.DuplicateObjectError:
        return
    except asyncpg.PostgresError:
        # Existing duplicate seed data should not make ordinary writes fail.
        return


class SqlBuilder:
    def __init__(self) -> None:
        self.values: list[Any] = []
        self.where: list[str] = []

    def add_value(self, value: Any) -> str:
        self.values.append(normalize_db_value(value))
        return f"${len(self.values)}"

    def add_filter(self, filter_item: dict[str, Any]) -> None:
        op = filter_item.get("op")
        column = filter_item.get("column")
        value = filter_item.get("value")

        if op == "match" and isinstance(value, dict):
            for key, val in value.items():
                self.where.append(f"{quote_ident(str(key))} = {self.add_value(val)}")
            return

        if op == "or" and isinstance(value, str):
            clause = self.parse_or_filter(value)
            if clause:
                self.where.append(f"({clause})")
            return

        if not column:
            return
        col = quote_ident(str(column))

        if op in FILTER_OPS:
            self.where.append(f"{col} {FILTER_OPS[op]} {self.add_value(value)}")
        elif op == "in":
            values = value if isinstance(value, list) else []
            if len(values) == 0:
                self.where.append("false")
            else:
                placeholders = ", ".join(self.add_value(v) for v in values)
                self.where.append(f"{col} IN ({placeholders})")
        elif op == "is":
            if value is None:
                self.where.append(f"{col} IS NULL")
            else:
                self.where.append(f"{col} IS {self.add_value(value)}")
        elif op == "contains":
            self.where.append(f"{col} @> {self.add_value(value)}::jsonb")
        elif op == "ilike":
            self.where.append(f"{col} ILIKE {self.add_value(value)}")

    def parse_or_filter(self, value: str) -> str:
        parts: list[str] = []
        for raw in value.split(","):
            segment = raw.strip()
            bits = segment.split(".", 2)
            if len(bits) != 3:
                continue
            column, op, raw_value = bits
            col = quote_ident(column)
            if op == "is" and raw_value == "null":
                parts.append(f"{col} IS NULL")
            elif op in FILTER_OPS:
                parts.append(f"{col} {FILTER_OPS[op]} {self.add_value(raw_value)}")
        return " OR ".join(parts)

    def where_sql(self, filters: list[dict[str, Any]]) -> str:
        for item in filters:
            self.add_filter(item)
        if not self.where:
            return ""
        return " WHERE " + " AND ".join(self.where)


async def connect(settings: Settings) -> asyncpg.Connection:
    if not settings.postgres_url:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Postgres is not configured.")
    return await asyncpg.connect(settings.postgres_url)


def rows_to_dicts(records: list[asyncpg.Record]) -> list[dict[str, Any]]:
    return [dict(record) for record in records]


async def execute_table_query(settings: Settings, table: str, payload: dict[str, Any]) -> dict[str, Any]:
    table_sql = quote_ident(table)
    action = payload.get("action", "select")
    filters = payload.get("filters") if isinstance(payload.get("filters"), list) else []
    single = bool(payload.get("single"))
    maybe_single = bool(payload.get("maybeSingle"))
    head = bool(payload.get("head"))
    select_sql = parse_select(payload.get("select"))

    conn = await connect(settings)
    try:
        await ensure_table_exists(conn, table)
        query_columns: dict[str, tuple[str, Any] | bool | None] = {}
        query_columns.update({column: None for column in select_column_names(payload.get("select"))})
        query_columns.update(columns_from_filters(filters))
        for order in payload.get("order") or []:
            if isinstance(order, dict) and order.get("column") and IDENTIFIER_RE.match(str(order["column"])):
                query_columns[str(order["column"])] = None
        if action in {"insert", "upsert"}:
            for row in normalize_rows(payload.get("payload")):
                for column, value in row.items():
                    query_columns[column] = (column, value)
        elif action == "update" and isinstance(payload.get("payload"), dict):
            for column, value in payload["payload"].items():
                query_columns[column] = (column, value)
        await ensure_columns(conn, table, query_columns)

        builder = SqlBuilder()
        where = builder.where_sql(filters)

        if action == "select":
            order_sql = ""
            for order in payload.get("order") or []:
                if isinstance(order, dict) and order.get("column"):
                    direction = "ASC" if order.get("ascending", True) else "DESC"
                    order_sql += f" ORDER BY {quote_ident(str(order['column']))} {direction}"
                    break
            limit_sql = ""
            if isinstance(payload.get("range"), dict):
                start = int(payload["range"].get("from", 0))
                end = int(payload["range"].get("to", start))
                limit_sql = f" LIMIT {max(end - start + 1, 0)} OFFSET {max(start, 0)}"
            elif payload.get("limit") is not None:
                limit_sql = f" LIMIT {max(int(payload['limit']), 0)}"

            count_value = None
            if payload.get("count"):
                count_value = await conn.fetchval(f"SELECT count(*) FROM {table_sql}{where}", *builder.values)
            if head:
                return {"data": None, "error": None, "count": count_value}

            records = await conn.fetch(
                f"SELECT {select_sql} FROM {table_sql}{where}{order_sql}{limit_sql}",
                *builder.values,
            )
            rows = rows_to_dicts(records)
            return shape_rows(rows, single, maybe_single, count_value)

        if action in {"insert", "upsert"}:
            rows = normalize_rows(payload.get("payload"))
            if not rows:
                return {"data": [] if not single else None, "error": None}
            columns = sorted({key for row in rows for key in row.keys()})
            if not columns:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Insert payload has no columns.")
            column_sql = ", ".join(quote_ident(column) for column in columns)
            value_groups = []
            insert_builder = SqlBuilder()
            for row in rows:
                value_groups.append("(" + ", ".join(insert_builder.add_value(row.get(column)) for column in columns) + ")")
            conflict_sql = ""
            if action == "upsert" and payload.get("onConflict"):
                conflict_cols = [quote_ident(col.strip()) for col in str(payload["onConflict"]).split(",") if col.strip()]
                await ensure_unique_constraint(conn, table, [col.strip() for col in str(payload["onConflict"]).split(",") if col.strip()])
                update_cols = [col for col in columns if col not in {c.replace('"', "") for c in conflict_cols}]
                if conflict_cols and update_cols:
                    assignments = ", ".join(f"{quote_ident(col)} = EXCLUDED.{quote_ident(col)}" for col in update_cols)
                    conflict_sql = f" ON CONFLICT ({', '.join(conflict_cols)}) DO UPDATE SET {assignments}"
                elif conflict_cols:
                    conflict_sql = f" ON CONFLICT ({', '.join(conflict_cols)}) DO NOTHING"
            records = await conn.fetch(
                f"INSERT INTO {table_sql} ({column_sql}) VALUES {', '.join(value_groups)}{conflict_sql} RETURNING {select_sql}",
                *insert_builder.values,
            )
            return shape_rows(rows_to_dicts(records), single, maybe_single, None)

        if action == "update":
            row = payload.get("payload")
            if not isinstance(row, dict) or not row:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Update payload must be an object.")
            assignments = ", ".join(f"{quote_ident(column)} = {builder.add_value(value)}" for column, value in row.items())
            records = await conn.fetch(
                f"UPDATE {table_sql} SET {assignments}{where} RETURNING {select_sql}",
                *builder.values,
            )
            return shape_rows(rows_to_dicts(records), single, maybe_single, None)

        if action == "delete":
            records = await conn.fetch(f"DELETE FROM {table_sql}{where} RETURNING {select_sql}", *builder.values)
            return shape_rows(rows_to_dicts(records), single, maybe_single, None)

        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Unsupported action: {action}")
    finally:
        await conn.close()


def shape_rows(rows: list[dict[str, Any]], single: bool, maybe_single: bool, count: int | None) -> dict[str, Any]:
    if single:
        return {"data": rows[0] if rows else None, "error": None, "count": count}
    if maybe_single:
        return {"data": rows[0] if rows else None, "error": None, "count": count}
    return {"data": rows, "error": None, "count": count}


async def execute_rpc(settings: Settings, name: str, params: dict[str, Any]) -> dict[str, Any]:
    function_sql = quote_ident(name)
    builder = SqlBuilder()
    arguments = []
    for key, value in params.items():
        arguments.append(f"{quote_ident(key)} := {builder.add_value(value)}")
    conn = await connect(settings)
    try:
        value = await conn.fetchval(f"SELECT {function_sql}({', '.join(arguments)})", *builder.values)
        return {"data": value, "error": None}
    finally:
        await conn.close()


async def schema_contract_status(settings: Settings, required_columns: dict[str, list[str]]) -> dict[str, Any]:
    conn = await connect(settings)
    try:
        for table, columns in required_columns.items():
            await ensure_columns(conn, table, {column: None for column in columns})

        table_names = list(required_columns.keys())
        table_rows = await conn.fetch(
            """
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = 'public'
              AND table_name = ANY($1::text[])
            """,
            table_names,
        )
        available_tables = {row["table_name"] for row in table_rows}

        column_rows = await conn.fetch(
            """
            SELECT table_name, column_name
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = ANY($1::text[])
            """,
            table_names,
        )
        columns_by_table: dict[str, set[str]] = {table: set() for table in table_names}
        for row in column_rows:
            columns_by_table.setdefault(row["table_name"], set()).add(row["column_name"])

        table_status: dict[str, dict[str, Any]] = {}
        for table, required in required_columns.items():
            available = table in available_tables
            columns = sorted(columns_by_table.get(table, set()))
            missing_columns = [column for column in required if column not in columns]
            table_status[table] = {
                "available": available,
                "columns": columns,
                "missingColumns": missing_columns,
            }

        missing_tables = [table for table, info in table_status.items() if not info["available"]]
        missing_columns = {
            table: info["missingColumns"]
            for table, info in table_status.items()
            if info["available"] and info["missingColumns"]
        }

        return {
            "provider": "postgres",
            "ok": not missing_tables and not missing_columns,
            "missingTables": missing_tables,
            "missingColumns": missing_columns,
            "tables": table_status,
        }
    finally:
        await conn.close()
