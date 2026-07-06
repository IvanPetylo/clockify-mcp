#!/usr/bin/env sh
set -eu

PUBLIC_BASE_URL="${PUBLIC_BASE_URL:-https://clockify.velryx.cc}"
EVIDENCE_DIR="${EVIDENCE_DIR:-/var/www/clockify-mcp/evidence}"
RUN_DATE="${RUN_DATE:-$(date +%F)}"
MCP_ACCESS_TOKEN="${MCP_ACCESS_TOKEN:-}"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

trim_trailing_slash() {
  printf '%s' "$1" | sed 's:/*$::'
}

check_get() {
  path="$1"
  expected_status="${2:-200}"
  url="${PUBLIC_BASE_URL}${path}"
  status=$(curl -fsS -o /dev/null -w '%{http_code}' "$url" || true)
  if [ "$status" != "$expected_status" ]; then
    echo "FAIL GET $path expected $expected_status got ${status:-curl-error}" >&2
    exit 1
  fi
  echo "PASS GET $path"
}

write_public_metadata() {
  curl -fsS "${PUBLIC_BASE_URL}/.well-known/mcp/server-card.json" -o "${EVIDENCE_DIR}/server-card-${RUN_DATE}.json"
  curl -fsS "${PUBLIC_BASE_URL}/.well-known/oauth-protected-resource" -o "${EVIDENCE_DIR}/oauth-protected-resource-${RUN_DATE}.json"
  curl -fsS "${PUBLIC_BASE_URL}/.well-known/oauth-authorization-server" -o "${EVIDENCE_DIR}/oauth-authorization-server-${RUN_DATE}.json"
  if [ -f ./server.json ]; then
    cp ./server.json "${EVIDENCE_DIR}/server-json-${RUN_DATE}.json"
  fi
}

post_mcp() {
  payload="$1"
  tmp_body="$2"
  status=$(curl -fsS -o "$tmp_body" -w '%{http_code}' \
    -H "Authorization: Bearer ${MCP_ACCESS_TOKEN}" \
    -H "Content-Type: application/json" \
    --data "$payload" \
    "${PUBLIC_BASE_URL}/mcp" || true)
  if [ "$status" != "200" ]; then
    echo "FAIL MCP POST expected 200 got ${status:-curl-error}" >&2
    exit 1
  fi
  if ! grep -q '"result"' "$tmp_body"; then
    echo "FAIL MCP POST did not return a JSON-RPC result" >&2
    exit 1
  fi
}

write_smoke_summary() {
  output="${EVIDENCE_DIR}/deployed-smoke-${RUN_DATE}.json"
  authenticated="false"
  if [ -n "$MCP_ACCESS_TOKEN" ]; then
    authenticated="true"
  fi
  cat > "$output" <<EOF
{
  "ok": true,
  "publicBaseUrl": "${PUBLIC_BASE_URL}",
  "mcpUrl": "${PUBLIC_BASE_URL}/mcp",
  "runDate": "${RUN_DATE}",
  "authenticated": ${authenticated},
  "note": "Sanitized curl-based deployment smoke summary. Raw MCP payloads and tokens are not written."
}
EOF
}

PUBLIC_BASE_URL=$(trim_trailing_slash "$PUBLIC_BASE_URL")

require_command curl
require_command sed
require_command grep
mkdir -p "$EVIDENCE_DIR"

check_get "/healthz"
check_get "/readyz"
check_get "/privacy"
check_get "/terms"
check_get "/.well-known/oauth-protected-resource"
check_get "/.well-known/oauth-authorization-server"
check_get "/.well-known/mcp/server-card.json"

unauth_status=$(curl -fsS -o /dev/null -w '%{http_code}' \
  -H "Content-Type: application/json" \
  --data '{"jsonrpc":"2.0","id":1,"method":"initialize"}' \
  "${PUBLIC_BASE_URL}/mcp" || true)
if [ "$unauth_status" != "401" ]; then
  echo "FAIL unauthenticated MCP expected 401 got ${unauth_status:-curl-error}" >&2
  exit 1
fi
echo "PASS unauthenticated MCP challenge"

tmp_body="$(mktemp)"
trap 'rm -f "$tmp_body"' EXIT

if [ -n "$MCP_ACCESS_TOKEN" ]; then
  post_mcp '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"clockify-mcp-live-validate","version":"0.1.0"}}}' "$tmp_body"
  echo "PASS authenticated MCP initialize"
  post_mcp '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' "$tmp_body"
  echo "PASS authenticated MCP tools/list"
else
  echo "SKIP authenticated MCP checks; set MCP_ACCESS_TOKEN to include them."
fi

write_public_metadata
write_smoke_summary

echo "Evidence written to ${EVIDENCE_DIR}"
echo "Next external checks: MCP Inspector and ChatGPT developer-mode validation."
