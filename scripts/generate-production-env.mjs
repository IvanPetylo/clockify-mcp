import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

const outputPath = ".env.production";
const force = process.argv.includes("--force");
const help = process.argv.includes("--help") || process.argv.includes("-h");

if (help) {
  console.log("Usage: npm run env:production [-- --force]");
  console.log("Generates .env.production from .env.production.example with random production secrets.");
  process.exit(0);
}

if (existsSync(outputPath) && !force) {
  console.error(`${outputPath} already exists. Re-run with -- --force to overwrite.`);
  process.exit(1);
}

const postgresPassword = randomBytes(24).toString("base64url");
const credentialKey = randomBytes(32).toString("base64");
const jwtSecret = randomBytes(48).toString("base64url");

const contents = readFileSync(".env.production.example", "utf8")
  .replace(/^POSTGRES_PASSWORD=.*$/m, `POSTGRES_PASSWORD=${postgresPassword}`)
  .replace(
    /^DATABASE_URL=.*$/m,
    `DATABASE_URL=postgres://clockify_mcp:${postgresPassword}@postgres:5432/clockify_mcp`
  )
  .replace(/^CLOCKIFY_CREDENTIAL_ENCRYPTION_KEY=.*$/m, `CLOCKIFY_CREDENTIAL_ENCRYPTION_KEY=${credentialKey}`)
  .replace(/^OAUTH_JWT_SECRET=.*$/m, `OAUTH_JWT_SECRET=${jwtSecret}`);

writeFileSync(outputPath, contents, { encoding: "utf8", flag: "w" });
console.log(`Wrote ${outputPath}. Replace OAUTH_ALLOWED_REDIRECT_URIS with the ChatGPT callback URI before deploy.`);
