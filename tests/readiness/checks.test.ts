import { runMarketplaceReadinessChecks } from "../../src/readiness/checks.js";

const productionFiles = {
  "server.json": JSON.stringify({
    "$schema": "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json",
    name: "io.github.softpeak/clockify-mcp",
    title: "Clockify MCP",
    description: "Remote MCP server for personal Clockify time tracking.",
    version: "1.0.0",
    repository: {
      url: "https://github.com/softpeak-ai/clockify-mcp",
      source: "github"
    },
    remotes: [{ type: "streamable-http", url: "https://clockify-mcp.softpeak.dev/mcp" }]
  }),
  "package.json": JSON.stringify({
    name: "clockify-mcp",
    version: "1.0.0",
    private: true
  }),
  "PRIVACY.md": "# Privacy Policy\n\nOperator: SoftPeak LLC.\nRetention: encrypted API keys stay until deletion request.",
  "TERMS.md": "# Terms of Service\n\nThese terms govern production use of ClockifyMCP.",
  "SECURITY.md": "# Security\n\nReport vulnerabilities to security@softpeak.dev. Support: support@softpeak.dev.",
  "README.md":
    "# ClockifyMCP\n\nProduction-ready remote MCP server.\n\nSupport: support@softpeak.dev\nSecurity: security@softpeak.dev\n",
  "docs/golden-prompts.md": [
    "# Golden Prompt Evidence Pack",
    "",
    "| GP-01 | profile |",
    "| GP-02 | entities |",
    "| GP-03 | entries |",
    "| GP-04 | timer |",
    "| GP-05 | start |",
    "| GP-06 | stop |",
    "| GP-07 | create |",
    "| GP-08 | update |",
    "| GP-09 | delete |",
    "| GP-10 | report |",
    "| GP-11 | negative |",
    "| GP-12 | injection |"
  ].join("\n"),
  "docs/release-evidence/README.md": [
    "# Release Evidence",
    "",
    "artifacts/",
    "deployed-smoke.json",
    "server.json",
    "mcp-inspector/",
    "chatgpt-developer-mode/",
    "screenshots/"
  ].join("\n"),
  "docs/submission-decision-pack.md": [
    "# Submission Decision Pack",
    "",
    "ClockifyMCP cannot enter Task 11 until every item in this file has an owner, a decision date, and evidence.",
    "",
    "## Required Owner Decisions",
    "",
    "| Decision | Decision Value | Owner | Decision Date | Evidence | Accepted Values |",
    "| --- | --- | --- | --- | --- | --- |",
    "| Public domain and HTTPS host | https://clockify-mcp.softpeak.dev | Jane Reviewer | 2026-07-03 | https://clockify-mcp.softpeak.dev/evidence/domain.md | Concrete public origin, for example `https://clockifymcp.example.dev` |",
    "| GitHub repository URL | https://github.com/softpeak-ai/clockify-mcp | Jane Reviewer | 2026-07-03 | https://github.com/softpeak-ai/clockify-mcp | Public or reviewer-accessible repository URL |",
    "| MCP Registry namespace | io.github.softpeak/clockify-mcp | Jane Reviewer | 2026-07-03 | https://clockify-mcp.softpeak.dev/evidence/mcp-namespace.md | Final `server.json.name` value |",
    "| Support contact | support@softpeak.dev | Jane Reviewer | 2026-07-03 | https://clockify-mcp.softpeak.dev/evidence/support-contact.md | Real monitored support email or help URL |",
    "| Security contact | security@softpeak.dev | Jane Reviewer | 2026-07-03 | https://clockify-mcp.softpeak.dev/evidence/security-contact.md | Real monitored security email or policy URL |",
    "| Privacy policy approval | https://clockify-mcp.softpeak.dev/privacy | Jane Reviewer | 2026-07-03 | https://clockify-mcp.softpeak.dev/privacy | Reviewed public privacy URL |",
    "| Terms approval | https://clockify-mcp.softpeak.dev/terms | Jane Reviewer | 2026-07-03 | https://clockify-mcp.softpeak.dev/terms | Reviewed public terms URL |",
    "| OpenAI organization verification | verified with app permissions | Jane Reviewer | 2026-07-03 | https://clockify-mcp.softpeak.dev/evidence/openai-verification.md | Dashboard evidence for verification and app permissions |",
    "| API-key onboarding policy path | OpenAI-approved | Jane Reviewer | 2026-07-03 | https://clockify-mcp.softpeak.dev/evidence/api-key-policy-decision-2026-07-03.md | `OpenAI-approved`, `Clockify OAuth migration`, or `private/developer-mode only` |",
    "| Demo Clockify account | prepared with sample data | Jane Reviewer | 2026-07-03 | https://clockify-mcp.softpeak.dev/evidence/demo-account.md | Account prepared with non-sensitive sample data |",
    "| Evidence storage location | https://clockify-mcp.softpeak.dev/evidence/ | Jane Reviewer | 2026-07-03 | https://clockify-mcp.softpeak.dev/evidence/ | Stable URL or repository path for smoke, inspector, ChatGPT screenshots, and golden prompts |",
    "| NPM package distribution | deferred | Jane Reviewer | 2026-07-03 | https://clockify-mcp.softpeak.dev/evidence/npm-distribution.md | `deferred`, `planned`, or `published` |",
    "",
    "## Go/No-Go Rule",
    "",
    "Do not change `docs/marketplace-readiness.md` to `Current status: production candidate.` until every required decision above is complete and linked."
  ].join("\n"),
  ".gitignore": "node_modules/\ndist/\ncoverage/\nartifacts/\n.env\n",
  "docs/marketplace-readiness.md":
    [
      "# Marketplace Readiness",
      "",
      "Current status: production candidate.",
      "",
      "Production endpoint: https://clockify-mcp.softpeak.dev/mcp",
      "Source commit: 0123456789abcdef0123456789abcdef01234567",
      "MCP Inspector: PASS",
      "MCP Inspector run date: 2026-07-03",
      "MCP Inspector artifact: https://clockify-mcp.softpeak.dev/evidence/mcp-inspector-2026-07-03.txt",
      "ChatGPT developer-mode validation: PASS",
      "ChatGPT validation date: 2026-07-03",
      "ChatGPT validation artifact: https://clockify-mcp.softpeak.dev/evidence/chatgpt-validation-2026-07-03.md",
      "Golden prompt matrix: PASS",
      "Golden prompt artifact folder: https://clockify-mcp.softpeak.dev/evidence/golden-prompts-2026-07-03/",
      "Deployed smoke check: PASS",
      "Deployed smoke run date: 2026-07-03",
      "Deployed smoke artifact: https://clockify-mcp.softpeak.dev/evidence/deployed-smoke-2026-07-03.txt",
      "MCP Registry manifest: PASS",
      "MCP Registry manifest artifact: https://clockify-mcp.softpeak.dev/evidence/server-json-2026-07-03.json",
      "NPM package distribution: deferred",
      "NPM pack dry-run: not applicable",
      "Submission screenshots: https://clockify-mcp.softpeak.dev/evidence/screenshots-2026-07-03/",
      "Demo account: prepared with sample workspaces, projects, tasks, tags, and time entries.",
      "",
      "## API-Key Onboarding Policy Gate",
      "",
      "Decision owner: Jane Reviewer",
      "Decision date: 2026-07-03",
      "Evidence link: https://clockify-mcp.softpeak.dev/evidence/api-key-policy-decision-2026-07-03.md",
      "Chosen path: OpenAI confirms this API-key onboarding pattern is acceptable for this app and Clockify use case."
    ].join("\n")
};

describe("marketplace readiness checks", () => {
  test("passes a production-ready fixture", () => {
    const result = runMarketplaceReadinessChecks({ files: productionFiles });

    expect(result.ok).toBe(true);
    expect(result.failures).toEqual([]);
  });

  test("rejects production candidate evidence when public ChatGPT submission is deferred", () => {
    const result = runMarketplaceReadinessChecks({
      files: {
        ...productionFiles,
        "docs/marketplace-readiness.md": productionFiles["docs/marketplace-readiness.md"].replace(
          "Chosen path: OpenAI confirms this API-key onboarding pattern is acceptable for this app and Clockify use case.",
          "Chosen path: Public ChatGPT submission is deferred and the app remains private/developer-mode only."
        )
      }
    });

    expect(result.ok).toBe(false);
    expect(result.failures.map((failure) => failure.id)).toContain("chatgpt-public-submission-deferred");
  });

  test("detects placeholder metadata, draft legal docs, and missing validation evidence", () => {
    const result = runMarketplaceReadinessChecks({
      files: {
        "server.json": JSON.stringify({
          name: "io.github.example/clockify-mcp",
          repository: { url: "https://github.com/example/clockify-mcp" },
          remotes: [{ type: "streamable-http", url: "https://clockify-mcp.example.com/mcp" }]
        }),
        "package.json": JSON.stringify({ name: "clockify-mcp", version: "0.1.0", private: true }),
        "PRIVACY.md": "# Privacy Policy Draft\n\nReplace before publication.",
        "TERMS.md": "# Terms Draft\n\nDraft terms.",
        "SECURITY.md": "# Security\n\nReport privately to the repository owner.",
        "README.md": "# ClockifyMCP\n\nThis repository is an implementation scaffold.",
        "docs/marketplace-readiness.md":
          "# Marketplace Readiness\n\nCurrent status: private development build.\n\nNPM package distribution: deferred."
      }
    });

    expect(result.ok).toBe(false);
    expect(result.failures.map((failure) => failure.id).sort()).toEqual([
      "api-key-policy-gate-unresolved",
      "artifacts-not-ignored",
      "chatgpt-validation-evidence-missing",
      "golden-prompts-doc-missing",
      "mcp-description-missing",
      "mcp-inspector-evidence-missing",
      "mcp-name-placeholder",
      "mcp-remote-placeholder",
      "mcp-repository-placeholder",
      "mcp-schema-missing",
      "mcp-version-missing",
      "privacy-draft",
      "readiness-status-not-production",
      "readme-status-not-production",
      "readme-support-contact-missing",
      "release-evidence-doc-missing",
      "security-contact-placeholder",
      "submission-decision-pack-missing",
      "terms-draft"
    ]);
  });

  test("detects TODO copy, reserved example domains, non-HTTPS remotes, and placeholder evidence", () => {
    const result = runMarketplaceReadinessChecks({
      files: {
        "server.json": JSON.stringify({
          "$schema": "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json",
          name: "io.github.softpeak/clockify-mcp",
          description: "Remote MCP server for personal Clockify time tracking.",
          version: "1.0.0",
          repository: { url: "https://github.com/softpeak-ai/clockify-mcp" },
          remotes: [{ type: "streamable-http", url: "http://clockify-mcp.softpeak.example/mcp" }]
        }),
        "package.json": JSON.stringify({ name: "clockify-mcp", version: "1.0.0", private: true }),
        "PRIVACY.md": "# Privacy Policy\n\nTODO: fill in real privacy policy.",
        "TERMS.md": "# Terms\n\nTODO: fill in real terms.",
        "SECURITY.md": "# Security\n\nReport to security@softpeak.example. Support: support@softpeak.example.",
        "README.md": "# ClockifyMCP\n\nTODO add production support contact.",
        "docs/marketplace-readiness.md":
          "# Marketplace Readiness\n\nCurrent status: production candidate.\n\nTODO replace evidence.\nMCP Inspector: PASS\nChatGPT developer-mode validation: PASS\nNPM package distribution: deferred.\n"
      }
    });

    expect(result.ok).toBe(false);
    expect(result.failures.map((failure) => failure.id).sort()).toEqual([
      "api-key-policy-gate-unresolved",
      "artifacts-not-ignored",
      "chatgpt-validation-artifact-missing",
      "chatgpt-validation-date-missing",
      "deployed-smoke-artifact-missing",
      "deployed-smoke-date-missing",
      "deployed-smoke-evidence-missing",
      "golden-prompt-artifact-missing",
      "golden-prompt-evidence-missing",
      "golden-prompts-doc-missing",
      "mcp-inspector-artifact-missing",
      "mcp-inspector-date-missing",
      "mcp-registry-artifact-missing",
      "mcp-registry-evidence-missing",
      "mcp-remote-not-https",
      "mcp-remote-placeholder",
      "privacy-draft",
      "readiness-commit-missing",
      "readiness-demo-account-missing",
      "readiness-endpoint-missing",
      "readiness-evidence-placeholder",
      "readiness-screenshots-missing",
      "readme-support-contact-missing",
      "release-evidence-doc-missing",
      "security-contact-placeholder",
      "submission-decision-pack-missing",
      "terms-draft"
    ]);
  });

  test("detects validation labels without concrete release evidence", () => {
    const result = runMarketplaceReadinessChecks({
      files: {
        ...productionFiles,
      "docs/marketplace-readiness.md":
          "# Marketplace Readiness\n\nCurrent status: production candidate.\n\nMCP Inspector: PASS\nChatGPT developer-mode validation: PASS\nNPM package distribution: deferred\n"
      }
    });

    expect(result.ok).toBe(false);
    expect(result.failures.map((failure) => failure.id).sort()).toEqual([
      "api-key-policy-gate-unresolved",
      "chatgpt-validation-artifact-missing",
      "chatgpt-validation-date-missing",
      "deployed-smoke-artifact-missing",
      "deployed-smoke-date-missing",
      "deployed-smoke-evidence-missing",
      "golden-prompt-artifact-missing",
      "golden-prompt-evidence-missing",
      "mcp-inspector-artifact-missing",
      "mcp-inspector-date-missing",
      "mcp-registry-artifact-missing",
      "mcp-registry-evidence-missing",
      "readiness-commit-missing",
      "readiness-demo-account-missing",
      "readiness-endpoint-missing",
      "readiness-screenshots-missing"
    ]);
  });

  test("detects missing MCP Registry manifest evidence", () => {
    const result = runMarketplaceReadinessChecks({
      files: {
        ...productionFiles,
        "docs/marketplace-readiness.md": productionFiles["docs/marketplace-readiness.md"].replace(
          /^MCP Registry manifest: PASS\nMCP Registry manifest artifact: https:\/\/\S+\n/im,
          ""
        )
      }
    });

    expect(result.ok).toBe(false);
    expect(result.failures.map((failure) => failure.id).sort()).toEqual([
      "mcp-registry-artifact-missing",
      "mcp-registry-evidence-missing"
    ]);
  });

  test("detects unresolved API-key onboarding policy gate", () => {
    const result = runMarketplaceReadinessChecks({
      files: {
        ...productionFiles,
        "docs/marketplace-readiness.md": [
          "# Marketplace Readiness",
          "",
          "Current status: production candidate.",
          "",
          "Production endpoint: https://clockify-mcp.softpeak.dev/mcp",
          "Source commit: 0123456789abcdef0123456789abcdef01234567",
          "MCP Inspector: PASS",
          "MCP Inspector run date: 2026-07-03",
          "MCP Inspector artifact: https://clockify-mcp.softpeak.dev/evidence/mcp-inspector-2026-07-03.txt",
          "ChatGPT developer-mode validation: PASS",
          "ChatGPT validation date: 2026-07-03",
          "ChatGPT validation artifact: https://clockify-mcp.softpeak.dev/evidence/chatgpt-validation-2026-07-03.md",
          "Golden prompt matrix: PASS",
          "Golden prompt artifact folder: https://clockify-mcp.softpeak.dev/evidence/golden-prompts-2026-07-03/",
          "Deployed smoke check: PASS",
          "Deployed smoke run date: 2026-07-03",
          "Deployed smoke artifact: https://clockify-mcp.softpeak.dev/evidence/deployed-smoke-2026-07-03.txt",
          "Submission screenshots: https://clockify-mcp.softpeak.dev/evidence/screenshots-2026-07-03/",
          "Demo account: prepared with sample workspaces, projects, tasks, tags, and time entries.",
          "",
          "## API-Key Onboarding Policy Gate",
          "",
          "Decision owner:",
          "Decision date:",
          "Evidence link:",
          "Chosen path:"
        ].join("\n")
      }
    });

    expect(result.ok).toBe(false);
    expect(result.failures.map((failure) => failure.id)).toContain("api-key-policy-gate-unresolved");
  });

  test("detects malformed API-key onboarding policy gate values", () => {
    const result = runMarketplaceReadinessChecks({
      files: {
        ...productionFiles,
        "docs/marketplace-readiness.md": productionFiles["docs/marketplace-readiness.md"]
          .replace("Decision date: 2026-07-03", "Decision date: July 3 2026")
          .replace(
            "Evidence link: https://clockify-mcp.softpeak.dev/evidence/api-key-policy-decision-2026-07-03.md",
            "Evidence link: http://clockify-mcp.softpeak.dev/evidence/api-key-policy-decision-2026-07-03.md"
          )
          .replace(
            "Chosen path: OpenAI confirms this API-key onboarding pattern is acceptable for this app and Clockify use case.",
            "Chosen path: Submit publicly without policy review."
          )
      }
    });

    expect(result.ok).toBe(false);
    expect(result.failures.map((failure) => failure.id)).toContain("api-key-policy-gate-unresolved");
  });

  test("detects missing golden prompt evidence even when other release evidence is present", () => {
    const result = runMarketplaceReadinessChecks({
      files: {
        ...productionFiles,
        "docs/marketplace-readiness.md": productionFiles["docs/marketplace-readiness.md"].replace(
          /Golden prompt matrix: PASS\nGolden prompt artifact folder: https:\/\/\S+\n/,
          ""
        )
      }
    });

    expect(result.ok).toBe(false);
    expect(result.failures.map((failure) => failure.id).sort()).toEqual([
      "golden-prompt-artifact-missing",
      "golden-prompt-evidence-missing"
    ]);
  });

  test("does not treat fenced release evidence template as validation evidence", () => {
    const result = runMarketplaceReadinessChecks({
      files: {
        ...productionFiles,
        "docs/marketplace-readiness.md": [
          "# Marketplace Readiness",
          "",
          "Current status: private development build.",
          "NPM package distribution: deferred",
          "",
          "```text",
          "Current status: production candidate.",
          "Production endpoint: https://clockify-mcp.softpeak.dev/mcp",
          "Source commit: 0123456789abcdef0123456789abcdef01234567",
          "MCP Inspector: PASS",
          "MCP Inspector run date: 2026-07-03",
          "MCP Inspector artifact: https://clockify-mcp.softpeak.dev/evidence/mcp-inspector.txt",
          "ChatGPT developer-mode validation: PASS",
          "ChatGPT validation date: 2026-07-03",
          "ChatGPT validation artifact: https://clockify-mcp.softpeak.dev/evidence/chatgpt-validation.md",
          "Submission screenshots: https://clockify-mcp.softpeak.dev/evidence/screenshots/",
          "Demo account: prepared with sample workspaces, projects, tasks, tags, and time entries.",
          "```"
        ].join("\n")
      }
    });

    expect(result.ok).toBe(false);
    expect(result.failures.map((failure) => failure.id).sort()).toEqual([
      "api-key-policy-gate-unresolved",
      "chatgpt-validation-evidence-missing",
      "mcp-inspector-evidence-missing",
      "readiness-status-not-production"
    ]);
  });

  test("detects explicit non-production README wording even with support contact", () => {
    const result = runMarketplaceReadinessChecks({
      files: {
        ...productionFiles,
        "README.md": "# ClockifyMCP\n\nThis is a non-production private beta.\n\nSupport: support@softpeak.dev\n"
      }
    });

    expect(result.ok).toBe(false);
    expect(result.failures.map((failure) => failure.id)).toEqual(["readme-status-not-production"]);
  });

  test("detects missing local release evidence documentation", () => {
    const files: Record<string, string | undefined> = { ...productionFiles };
    files["docs/golden-prompts.md"] = undefined;
    files["docs/release-evidence/README.md"] = undefined;

    const result = runMarketplaceReadinessChecks({ files });

    expect(result.ok).toBe(false);
    expect(result.failures.map((failure) => failure.id).sort()).toEqual([
      "golden-prompts-doc-missing",
      "release-evidence-doc-missing"
    ]);
  });

  test("detects missing submission decision pack", () => {
    const files: Record<string, string | undefined> = { ...productionFiles };
    files["docs/submission-decision-pack.md"] = undefined;

    const result = runMarketplaceReadinessChecks({ files });

    expect(result.ok).toBe(false);
    expect(result.failures.map((failure) => failure.id)).toEqual(["submission-decision-pack-missing"]);
  });

  test("detects incomplete submission decision pack rows", () => {
    const result = runMarketplaceReadinessChecks({
      files: {
        ...productionFiles,
        "docs/submission-decision-pack.md": [
          "# Submission Decision Pack",
          "",
          "## Required Owner Decisions",
          "",
          "| Decision | Owner | Decision Date | Evidence | Accepted Values |",
          "| --- | --- | --- | --- | --- |",
          "| Public domain and HTTPS host | Jane Reviewer | 2026-07-03 | https://clockify-mcp.softpeak.dev/evidence/domain.md | Concrete public origin |",
          "| GitHub repository URL |  |  |  | Public or reviewer-accessible repository URL |",
          "| MCP Registry namespace | Jane Reviewer | 2026-07-03 | https://clockify-mcp.softpeak.dev/evidence/mcp-namespace.md | Final `server.json.name` value |",
          "| Support contact | Jane Reviewer | 2026-07-03 | https://clockify-mcp.softpeak.dev/evidence/support-contact.md | Real monitored support email or help URL |",
          "| Security contact | Jane Reviewer | 2026-07-03 | https://clockify-mcp.softpeak.dev/evidence/security-contact.md | Real monitored security email or policy URL |",
          "| Privacy policy approval | Jane Reviewer | 2026-07-03 | https://clockify-mcp.softpeak.dev/privacy | Reviewed public privacy URL |",
          "| Terms approval | Jane Reviewer | 2026-07-03 | https://clockify-mcp.softpeak.dev/terms | Reviewed public terms URL |",
          "| OpenAI organization verification | Jane Reviewer | 2026-07-03 | https://clockify-mcp.softpeak.dev/evidence/openai-verification.md | Dashboard evidence for verification and app permissions |",
          "| API-key onboarding policy path | Jane Reviewer | 2026-07-03 | https://clockify-mcp.softpeak.dev/evidence/api-key-policy-decision-2026-07-03.md | `OpenAI-approved`, `Clockify OAuth migration`, or `private/developer-mode only` |",
          "| Demo Clockify account | Jane Reviewer | 2026-07-03 | https://clockify-mcp.softpeak.dev/evidence/demo-account.md | Account prepared with non-sensitive sample data |",
          "| Evidence storage location | Jane Reviewer | 2026-07-03 | https://clockify-mcp.softpeak.dev/evidence/ | Stable URL or repository path for smoke, inspector, ChatGPT screenshots, and golden prompts |",
          "| NPM package distribution | Jane Reviewer | 2026-07-03 | https://clockify-mcp.softpeak.dev/evidence/npm-distribution.md | `deferred`, `planned`, or `published` |"
        ].join("\n")
      }
    });

    expect(result.ok).toBe(false);
    expect(result.failures.map((failure) => failure.id)).toEqual(["submission-decision-pack-incomplete"]);
  });

  test("detects submission decision pack rows without concrete decision values", () => {
    const result = runMarketplaceReadinessChecks({
      files: {
        ...productionFiles,
        "docs/submission-decision-pack.md": [
          "# Submission Decision Pack",
          "",
          "## Required Owner Decisions",
          "",
          "| Decision | Owner | Decision Date | Evidence | Accepted Values |",
          "| --- | --- | --- | --- | --- |",
          "| Public domain and HTTPS host | Jane Reviewer | 2026-07-03 | https://clockify-mcp.softpeak.dev/evidence/domain.md | Concrete public origin |",
          "| GitHub repository URL | Jane Reviewer | 2026-07-03 | https://github.com/softpeak-ai/clockify-mcp | Public or reviewer-accessible repository URL |",
          "| MCP Registry namespace | Jane Reviewer | 2026-07-03 | https://clockify-mcp.softpeak.dev/evidence/mcp-namespace.md | Final `server.json.name` value |",
          "| Support contact | Jane Reviewer | 2026-07-03 | https://clockify-mcp.softpeak.dev/evidence/support-contact.md | Real monitored support email or help URL |",
          "| Security contact | Jane Reviewer | 2026-07-03 | https://clockify-mcp.softpeak.dev/evidence/security-contact.md | Real monitored security email or policy URL |",
          "| Privacy policy approval | Jane Reviewer | 2026-07-03 | https://clockify-mcp.softpeak.dev/privacy | Reviewed public privacy URL |",
          "| Terms approval | Jane Reviewer | 2026-07-03 | https://clockify-mcp.softpeak.dev/terms | Reviewed public terms URL |",
          "| OpenAI organization verification | Jane Reviewer | 2026-07-03 | https://clockify-mcp.softpeak.dev/evidence/openai-verification.md | Dashboard evidence for verification and app permissions |",
          "| API-key onboarding policy path | Jane Reviewer | 2026-07-03 | https://clockify-mcp.softpeak.dev/evidence/api-key-policy-decision-2026-07-03.md | `OpenAI-approved`, `Clockify OAuth migration`, or `private/developer-mode only` |",
          "| Demo Clockify account | Jane Reviewer | 2026-07-03 | https://clockify-mcp.softpeak.dev/evidence/demo-account.md | Account prepared with non-sensitive sample data |",
          "| Evidence storage location | Jane Reviewer | 2026-07-03 | https://clockify-mcp.softpeak.dev/evidence/ | Stable URL or repository path for smoke, inspector, ChatGPT screenshots, and golden prompts |",
          "| NPM package distribution | Jane Reviewer | 2026-07-03 | https://clockify-mcp.softpeak.dev/evidence/npm-distribution.md | `deferred`, `planned`, or `published` |"
        ].join("\n")
      }
    });

    expect(result.ok).toBe(false);
    expect(result.failures.map((failure) => failure.id)).toEqual(["submission-decision-pack-incomplete"]);
  });

  test("does not accept completed sample decision rows before the canonical decision table", () => {
    const result = runMarketplaceReadinessChecks({
      files: {
        ...productionFiles,
        "docs/submission-decision-pack.md": [
          "# Submission Decision Pack",
          "",
          "## Example Completed Decisions",
          "",
          productionFiles["docs/submission-decision-pack.md"],
          "",
          "## Required Owner Decisions",
          "",
          "| Decision | Owner | Decision Date | Evidence | Accepted Values |",
          "| --- | --- | --- | --- | --- |",
          "| Public domain and HTTPS host |  |  |  | Concrete public origin |"
        ].join("\n")
      }
    });

    expect(result.ok).toBe(false);
    expect(result.failures.map((failure) => failure.id)).toEqual(["submission-decision-pack-incomplete"]);
  });

  test("does not accept placeholder evidence URLs in the submission decision pack", () => {
    const result = runMarketplaceReadinessChecks({
      files: {
        ...productionFiles,
        "docs/submission-decision-pack.md": productionFiles["docs/submission-decision-pack.md"].replace(
          "https://clockify-mcp.softpeak.dev/evidence/domain.md",
          "https://clockifymcp.example.dev/evidence/domain.md"
        )
      }
    });

    expect(result.ok).toBe(false);
    expect(result.failures.map((failure) => failure.id)).toEqual(["submission-decision-pack-incomplete"]);
  });

  test("does not accept placeholder decision values in the submission decision pack", () => {
    const result = runMarketplaceReadinessChecks({
      files: {
        ...productionFiles,
        "docs/submission-decision-pack.md": productionFiles["docs/submission-decision-pack.md"].replace(
          "https://clockify-mcp.softpeak.dev | Jane Reviewer",
          "https://clockifymcp.example.dev | Jane Reviewer"
        )
      }
    });

    expect(result.ok).toBe(false);
    expect(result.failures.map((failure) => failure.id)).toEqual(["submission-decision-pack-incomplete"]);
  });

  test("accepts escaped markdown pipes inside submission decision values", () => {
    const result = runMarketplaceReadinessChecks({
      files: {
        ...productionFiles,
        "docs/submission-decision-pack.md": productionFiles["docs/submission-decision-pack.md"].replace(
          "OpenAI-approved | Jane Reviewer",
          "OpenAI-approved \\| Clockify-confirmed | Jane Reviewer"
        )
      }
    });

    expect(result.ok).toBe(true);
    expect(result.failures).toEqual([]);
  });

  test("detects submission decision pack MCP namespace mismatch", () => {
    const result = runMarketplaceReadinessChecks({
      files: {
        ...productionFiles,
        "docs/submission-decision-pack.md": productionFiles["docs/submission-decision-pack.md"].replace(
          "io.github.softpeak/clockify-mcp | Jane Reviewer",
          "io.github.softpeak/other-clockify-mcp | Jane Reviewer"
        )
      }
    });

    expect(result.ok).toBe(false);
    expect(result.failures.map((failure) => failure.id)).toEqual(["submission-decision-pack-mismatch"]);
  });

  test("detects submission decision pack GitHub repository mismatch", () => {
    const result = runMarketplaceReadinessChecks({
      files: {
        ...productionFiles,
        "docs/submission-decision-pack.md": productionFiles["docs/submission-decision-pack.md"].replace(
          "https://github.com/softpeak-ai/clockify-mcp | Jane Reviewer",
          "https://github.com/softpeak-ai/clockify-mcp-review | Jane Reviewer"
        )
      }
    });

    expect(result.ok).toBe(false);
    expect(result.failures.map((failure) => failure.id)).toEqual(["submission-decision-pack-mismatch"]);
  });

  test("detects submission decision pack public origin mismatch", () => {
    const result = runMarketplaceReadinessChecks({
      files: {
        ...productionFiles,
        "docs/submission-decision-pack.md": productionFiles["docs/submission-decision-pack.md"].replace(
          "https://clockify-mcp.softpeak.dev | Jane Reviewer",
          "https://clockify-alt.softpeak.dev | Jane Reviewer"
        )
      }
    });

    expect(result.ok).toBe(false);
    expect(result.failures.map((failure) => failure.id)).toEqual(["submission-decision-pack-mismatch"]);
  });

  test("detects submission decision pack npm distribution mismatch", () => {
    const result = runMarketplaceReadinessChecks({
      files: {
        ...productionFiles,
        "docs/submission-decision-pack.md": productionFiles["docs/submission-decision-pack.md"].replace(
          "| NPM package distribution | deferred |",
          "| NPM package distribution | planned |"
        )
      }
    });

    expect(result.ok).toBe(false);
    expect(result.failures.map((failure) => failure.id)).toEqual(["submission-decision-pack-mismatch"]);
  });

  test("detects submission decision pack support contact mismatch", () => {
    const result = runMarketplaceReadinessChecks({
      files: {
        ...productionFiles,
        "docs/submission-decision-pack.md": productionFiles["docs/submission-decision-pack.md"].replace(
          "| Support contact | support@softpeak.dev |",
          "| Support contact | help@softpeak.dev |"
        )
      }
    });

    expect(result.ok).toBe(false);
    expect(result.failures.map((failure) => failure.id)).toEqual(["submission-decision-pack-mismatch"]);
  });

  test("detects support contact mismatch when README support label is inline", () => {
    const result = runMarketplaceReadinessChecks({
      files: {
        ...productionFiles,
        "README.md":
          "# ClockifyMCP\n\nProduction-ready remote MCP server.\n\nContact Support: support@softpeak.dev\nSecurity: security@softpeak.dev\n",
        "docs/submission-decision-pack.md": productionFiles["docs/submission-decision-pack.md"].replace(
          "| Support contact | support@softpeak.dev |",
          "| Support contact | help@softpeak.dev |"
        )
      }
    });

    expect(result.ok).toBe(false);
    expect(result.failures.map((failure) => failure.id)).toEqual(["submission-decision-pack-mismatch"]);
  });

  test("detects submission decision pack security contact mismatch", () => {
    const result = runMarketplaceReadinessChecks({
      files: {
        ...productionFiles,
        "docs/submission-decision-pack.md": productionFiles["docs/submission-decision-pack.md"].replace(
          "| Security contact | security@softpeak.dev |",
          "| Security contact | security-review@softpeak.dev |"
        )
      }
    });

    expect(result.ok).toBe(false);
    expect(result.failures.map((failure) => failure.id)).toEqual(["submission-decision-pack-mismatch"]);
  });

  test("detects security contact mismatch when SECURITY uses a security contact label", () => {
    const result = runMarketplaceReadinessChecks({
      files: {
        ...productionFiles,
        "SECURITY.md": "# Security\n\nSecurity contact: security@softpeak.dev. Support: support@softpeak.dev.",
        "docs/submission-decision-pack.md": productionFiles["docs/submission-decision-pack.md"].replace(
          "| Security contact | security@softpeak.dev |",
          "| Security contact | security-review@softpeak.dev |"
        )
      }
    });

    expect(result.ok).toBe(false);
    expect(result.failures.map((failure) => failure.id)).toEqual(["submission-decision-pack-mismatch"]);
  });

  test("rejects duplicate submission decision pack rows", () => {
    const result = runMarketplaceReadinessChecks({
      files: {
        ...productionFiles,
        "docs/submission-decision-pack.md": productionFiles["docs/submission-decision-pack.md"].replace(
          "| MCP Registry namespace | io.github.softpeak/clockify-mcp | Jane Reviewer | 2026-07-03 | https://clockify-mcp.softpeak.dev/evidence/mcp-namespace.md | Final `server.json.name` value |",
          [
            "| MCP Registry namespace | io.github.softpeak/clockify-mcp | Jane Reviewer | 2026-07-03 | https://clockify-mcp.softpeak.dev/evidence/mcp-namespace.md | Final `server.json.name` value |",
            "| MCP Registry namespace | io.github.softpeak/other-clockify-mcp | Jane Reviewer | 2026-07-03 | https://clockify-mcp.softpeak.dev/evidence/mcp-namespace-duplicate.md | Final `server.json.name` value |"
          ].join("\n")
        )
      }
    });

    expect(result.ok).toBe(false);
    expect(result.failures.map((failure) => failure.id)).toEqual(["submission-decision-pack-duplicate"]);
  });

  test("detects incomplete golden prompt matrix and unignored local artifacts", () => {
    const result = runMarketplaceReadinessChecks({
      files: {
        ...productionFiles,
        "docs/golden-prompts.md": "# Golden Prompt Evidence Pack\n\n| GP-01 | profile |",
        ".gitignore": "node_modules/\ndist/\ncoverage/\n.env\n"
      }
    });

    expect(result.ok).toBe(false);
    expect(result.failures.map((failure) => failure.id).sort()).toEqual([
      "artifacts-not-ignored",
      "golden-prompts-incomplete"
    ]);
  });

  test("does not accept misleading artifact ignore patterns", () => {
    const result = runMarketplaceReadinessChecks({
      files: {
        ...productionFiles,
        ".gitignore": "node_modules/\ndocs/artifacts/\n!artifacts/\n"
      }
    });

    expect(result.ok).toBe(false);
    expect(result.failures.map((failure) => failure.id)).toEqual(["artifacts-not-ignored"]);
  });

  test("detects missing official server.json manifest", () => {
    const files: Record<string, string | undefined> = { ...productionFiles };
    files["server.json"] = undefined;

    const result = runMarketplaceReadinessChecks({ files });

    expect(result.ok).toBe(false);
    expect(result.failures.map((failure) => failure.id)).toEqual(["mcp-server-missing"]);
    expect(result.failures[0]?.file).toBe("server.json");
  });

  test("detects invalid MCP Registry schema, transport, remote path, version, and package mcpName", () => {
    const result = runMarketplaceReadinessChecks({
      files: {
        ...productionFiles,
        "server.json": JSON.stringify({
          "$schema": "https://example.com/server.schema.json",
          name: "io.github.softpeak/clockify-mcp",
          title: "Clockify MCP",
          description: "Remote MCP server for personal Clockify time tracking.",
          version: "1.0.1",
          repository: {
            url: "https://github.com/softpeak-ai/clockify-mcp",
            source: "github"
          },
          remotes: [{ type: "stdio", url: "https://clockify-mcp.softpeak.dev/api" }]
        }),
        "package.json": JSON.stringify({
          name: "clockify-mcp",
          version: "1.0.0",
          private: true,
          mcpName: "io.github.softpeak/other"
        })
      }
    });

    expect(result.ok).toBe(false);
    expect(result.failures.map((failure) => failure.id).sort()).toEqual([
      "mcp-package-name-mismatch",
      "mcp-remote-path-invalid",
      "mcp-remote-transport-invalid",
      "mcp-schema-missing",
      "mcp-version-mismatch"
    ]);
  });

  test("detects server.json values that violate required MCP Registry schema fields", () => {
    const result = runMarketplaceReadinessChecks({
      files: {
        ...productionFiles,
        "server.json": JSON.stringify({
          "$schema": "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json",
          name: "clockify-mcp",
          title: "Clockify MCP",
          description: "",
          version: "",
          repository: {
            url: "https://github.com/softpeak-ai/clockify-mcp",
            source: "github"
          },
          remotes: [{ type: "streamable-http", url: "https://clockify-mcp.softpeak.dev/mcp" }]
        }),
        "docs/submission-decision-pack.md": productionFiles["docs/submission-decision-pack.md"].replace(
          "io.github.softpeak/clockify-mcp | Jane Reviewer",
          "clockify-mcp | Jane Reviewer"
        )
      }
    });

    expect(result.ok).toBe(false);
    expect(result.failures.map((failure) => failure.id).sort()).toEqual([
      "mcp-description-missing",
      "mcp-name-invalid",
      "mcp-version-missing"
    ]);
  });

  test("detects missing npm package distribution decision", () => {
    const result = runMarketplaceReadinessChecks({
      files: {
        ...productionFiles,
        "docs/marketplace-readiness.md": productionFiles["docs/marketplace-readiness.md"].replace(
          /^NPM package distribution: deferred\n/im,
          ""
        )
      }
    });

    expect(result.ok).toBe(false);
    expect(result.failures.map((failure) => failure.id)).toEqual(["npm-package-decision-missing"]);
  });

  test("does not accept npm package distribution decision from fenced template text", () => {
    const result = runMarketplaceReadinessChecks({
      files: {
        ...productionFiles,
        "docs/marketplace-readiness.md": productionFiles["docs/marketplace-readiness.md"].replace(
          /^NPM package distribution: deferred\n/im,
          "```text\nNPM package distribution: deferred\n```\n"
        )
      }
    });

    expect(result.ok).toBe(false);
    expect(result.failures.map((failure) => failure.id)).toEqual(["npm-package-decision-missing"]);
  });

  test("requires npm publish metadata when npm package distribution is planned", () => {
    const result = runMarketplaceReadinessChecks({
      files: {
        ...productionFiles,
        "package.json": JSON.stringify({
          name: "clockify-mcp",
          version: "1.0.0",
          private: true
        }),
        "docs/marketplace-readiness.md": productionFiles["docs/marketplace-readiness.md"].replace(
          "NPM package distribution: deferred",
          "NPM package distribution: planned"
        ),
        "docs/submission-decision-pack.md": productionFiles["docs/submission-decision-pack.md"].replace(
          "| NPM package distribution | deferred |",
          "| NPM package distribution | planned |"
        )
      }
    });

    expect(result.ok).toBe(false);
    expect(result.failures.map((failure) => failure.id).sort()).toEqual([
      "npm-package-engines-missing",
      "npm-package-files-missing",
      "npm-package-main-missing",
      "npm-package-mcp-name-missing",
      "npm-package-private",
      "npm-package-repository-missing"
    ]);
  });
});
