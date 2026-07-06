import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { runMarketplaceReadinessChecks } from "./checks.js";

const readinessFiles = [
  "server.json",
  "package.json",
  "PRIVACY.md",
  "TERMS.md",
  "SECURITY.md",
  "README.md",
  "docs/golden-prompts.md",
  "docs/release-evidence/README.md",
  "docs/submission-decision-pack.md",
  ".gitignore",
  "docs/marketplace-readiness.md"
] as const;

const cwd = process.cwd();
const files = Object.fromEntries(
  readinessFiles.map((file) => {
    try {
      return [file, readFileSync(resolve(cwd, file), "utf8")];
    } catch {
      return [file, undefined];
    }
  })
);

const result = runMarketplaceReadinessChecks({ files });
if (result.ok) {
  console.log("Marketplace readiness checks passed.");
} else {
  console.error("Marketplace readiness checks failed:");
  for (const failure of result.failures) {
    console.error(`- [${failure.id}] ${failure.file}: ${failure.message}`);
  }
  process.exitCode = 1;
}
