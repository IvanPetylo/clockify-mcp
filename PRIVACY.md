# Privacy Policy

ClockifyMCP processes Clockify account data only to provide user-requested time-tracking actions through MCP clients such as ChatGPT.

Operator contact: Ivan Petylo, petylo.work+mcp@gmail.com, Telegram: @edwy_reed.

## Data Processed

- Clockify user profile and workspace identifiers.
- Project, task, client, tag, time-entry, timer, and report data returned by Clockify.
- Encrypted Clockify API key ciphertext and non-secret credential metadata.
- OAuth account-linking metadata such as subject, client id, scopes, and timestamps.

## Data Not Collected

- Raw ChatGPT conversation history.
- Payment card data.
- Government identifiers.
- Health data.
- Plaintext Clockify API keys after encryption.

## Use

Data is used to execute MCP tool calls requested by the authenticated user, maintain account linking, support account disconnection, and diagnose operational failures with redacted logs.

## Retention

Encrypted Clockify credentials remain stored until the user disconnects ClockifyMCP or requests deletion. Operational logs are retained only as long as needed for service reliability and security investigation, and must be redacted before storage or sharing.

## Sharing

ClockifyMCP sends requests to Clockify on behalf of the authenticated user. It does not sell user data.

## User Controls

Users can disconnect ClockifyMCP by deleting stored credentials through the authenticated disconnect endpoint or by contacting petylo.work+mcp@gmail.com.

## Security

Clockify API keys are encrypted at rest. OAuth and onboarding responses use no-store cache controls, and tool results are validated to prevent credential leakage.
