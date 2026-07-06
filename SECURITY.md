# Security Policy

## Supported Versions

ClockifyMCP is pre-1.0. Security fixes apply to the latest `main` branch until versioned releases are established.

## Secret Handling

Never commit:

- Clockify API keys.
- OAuth client secrets.
- JWT signing secrets.
- Credential encryption keys.
- Production database URLs.

Clockify API keys must be encrypted with authenticated encryption before storage. Tool responses, logs, UI hydration data, and MCP `_meta` must never contain credentials or bearer tokens.

## Reporting

Report vulnerabilities to Ivan Petylo at petylo.work+mcp@gmail.com. For quick coordination, use Telegram: @edwy_reed.

Include:

- Affected endpoint/tool.
- Reproduction steps.
- Whether any secret, token, or Clockify data was exposed.

Do not open public issues containing exploitable details or real credentials.

Expected first response time: within 72 hours.

## Review Focus

High-priority issues:

- Token validation bypass.
- Cross-user credential access.
- Plaintext Clockify key persistence.
- Secret leakage in logs or tool results.
- Destructive time-entry actions without exact confirmation.
- Admin/team Clockify operations exposed in v1.
