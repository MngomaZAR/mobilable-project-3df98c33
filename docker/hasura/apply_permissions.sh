#!/usr/bin/env bash
set -e
HASURA_URL=${HASURA_URL:-http://localhost:8080}
ADMIN_SECRET=${HASURA_ADMIN_SECRET:-hasura_admin_secret}

echo "Applying select permission for anonymous on profiles"
curl -s -X POST "$HASURA_URL/v1/metadata" \
  -H "Content-Type: application/json" \
  -H "x-hasura-admin-secret: $ADMIN_SECRET" \
  -d '{"type":"pg_create_select_permission","args":{"source":"default","table":{"schema":"public","name":"profiles"},"role":"anonymous","permission":{"columns":["id","full_name","city","avatar_url"],"filter":{},"limit":null}}}' | jq

echo "Applying select permission for anonymous on posts"
curl -s -X POST "$HASURA_URL/v1/metadata" \
  -H "Content-Type: application/json" \
  -H "x-hasura-admin-secret: $ADMIN_SECRET" \
  -d '{"type":"pg_create_select_permission","args":{"source":"default","table":{"schema":"public","name":"posts"},"role":"anonymous","permission":{"columns":["id","user_id","caption","location","comment_count","created_at","image_url","likes_count"],"filter":{},"limit":null,"allow_aggregations":true}}}' | jq

echo "Done"
