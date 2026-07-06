export type MarketplaceReadinessInput = {
  files: Record<string, string | undefined>;
};

export type MarketplaceReadinessFailure = {
  id: string;
  file: string;
  message: string;
};

export type MarketplaceReadinessResult = {
  ok: boolean;
  failures: MarketplaceReadinessFailure[];
};

type ParsedMcpServer = {
  name: string;
  version: string;
  repositoryUrl: string;
  remoteUrls: string[];
};

type SubmissionDecisionRow = {
  decision: string;
  decisionValue: string;
  owner: string;
  decisionDate: string;
  evidence: string;
};

type SubmissionDecisionPack = Map<string, SubmissionDecisionRow>;

type ParsedPackageJson = {
  version: string;
  private?: boolean;
  repositoryUrl: string;
  main: string;
  files: unknown;
  mcpName: string;
  nodeEngine: string;
};

export function runMarketplaceReadinessChecks(input: MarketplaceReadinessInput): MarketplaceReadinessResult {
  const failures: MarketplaceReadinessFailure[] = [];
  const mcpServer = checkMcpServer(input.files["server.json"], failures);
  const packageJson = checkPackageJson(input.files["package.json"], failures);
  checkPackageMetadata({
    packageJson,
    mcpServer,
    readinessContent: input.files["docs/marketplace-readiness.md"]
  }, failures);
  checkLegalDocument({
    file: "PRIVACY.md",
    content: input.files["PRIVACY.md"],
    draftId: "privacy-draft",
    missingId: "privacy-missing"
  }, failures);
  checkLegalDocument({
    file: "TERMS.md",
    content: input.files["TERMS.md"],
    draftId: "terms-draft",
    missingId: "terms-missing"
  }, failures);
  checkSecurity(input.files["SECURITY.md"], failures);
  checkReadme(input.files["README.md"], failures);
  checkGoldenPrompts(input.files["docs/golden-prompts.md"], failures);
  checkReleaseEvidenceDocs(input.files["docs/release-evidence/README.md"], failures);
  const submissionDecisionPack = checkSubmissionDecisionPack(input.files["docs/submission-decision-pack.md"], failures);
  checkSubmissionDecisionPackConsistency(
    {
      decisionPack: submissionDecisionPack,
      mcpServer,
      readinessContent: input.files["docs/marketplace-readiness.md"],
      readmeContent: input.files["README.md"],
      securityContent: input.files["SECURITY.md"]
    },
    failures
  );
  checkArtifactIgnore(input.files[".gitignore"], failures);
  checkReleaseEvidence(input.files["docs/marketplace-readiness.md"], failures);

  return {
    ok: failures.length === 0,
    failures
  };
}

function checkSubmissionDecisionPack(
  content: string | undefined,
  failures: MarketplaceReadinessFailure[]
): SubmissionDecisionPack | undefined {
  const file = "docs/submission-decision-pack.md";
  if (!content) {
    failures.push({
      id: "submission-decision-pack-missing",
      file,
      message: "docs/submission-decision-pack.md must record owner decisions before Task 11 starts."
    });
    return undefined;
  }

  const rows = parseMarkdownTableRows(extractMarkdownSection(content, "Required Owner Decisions"));
  const requiredDecisions = [
    "Public domain and HTTPS host",
    "GitHub repository URL",
    "MCP Registry namespace",
    "Support contact",
    "Security contact",
    "Privacy policy approval",
    "Terms approval",
    "OpenAI organization verification",
    "API-key onboarding policy path",
    "Demo Clockify account",
    "Evidence storage location",
    "NPM package distribution"
  ];
  const duplicateDecisions = requiredDecisions.filter(
    (decision) => rows.filter((candidate) => candidate.decision === decision).length > 1
  );

  if (duplicateDecisions.length > 0) {
    failures.push({
      id: "submission-decision-pack-duplicate",
      file,
      message: `Submission decision pack contains duplicate required decision rows: ${duplicateDecisions.join(", ")}.`
    });
    return undefined;
  }

  const hasCompleteRows = requiredDecisions.every((decision) => {
    const row = rows.find((candidate) => candidate.decision === decision);
    return (
      row &&
      isValidDecisionValue(row.decisionValue) &&
      row.owner &&
      /^\d{4}-\d{2}-\d{2}$/.test(row.decisionDate) &&
      /^https:\/\/\S+$/.test(row.evidence) &&
      !isPlaceholderUrl(row.evidence)
    );
  });

  if (!hasCompleteRows) {
    failures.push({
      id: "submission-decision-pack-incomplete",
      file,
      message:
        "Complete every submission decision row with decision value, owner, YYYY-MM-DD decision date, and HTTPS evidence link."
    });
    return undefined;
  }
  return new Map(rows.map((row) => [row.decision, row]));
}

function checkSubmissionDecisionPackConsistency(
  input: {
    decisionPack: SubmissionDecisionPack | undefined;
    mcpServer: ParsedMcpServer | undefined;
    readinessContent: string | undefined;
    readmeContent: string | undefined;
    securityContent: string | undefined;
  },
  failures: MarketplaceReadinessFailure[]
): void {
  const file = "docs/submission-decision-pack.md";
  if (!input.decisionPack) {
    return;
  }
  const mismatches: string[] = [];
  const publicOrigin = firstRemoteOrigin(input.mcpServer?.remoteUrls);
  if (publicOrigin && decisionValue(input.decisionPack, "Public domain and HTTPS host") !== publicOrigin) {
    mismatches.push("Public domain and HTTPS host must match the deployed MCP remote origin.");
  }
  if (
    input.mcpServer?.repositoryUrl &&
    decisionValue(input.decisionPack, "GitHub repository URL") !== input.mcpServer.repositoryUrl
  ) {
    mismatches.push("GitHub repository URL must match server.json repository.url.");
  }
  if (input.mcpServer?.name && decisionValue(input.decisionPack, "MCP Registry namespace") !== input.mcpServer.name) {
    mismatches.push("MCP Registry namespace must match server.json name.");
  }
  const npmDecision = npmPackageDistributionDecision(input.readinessContent);
  if (npmDecision && decisionValue(input.decisionPack, "NPM package distribution") !== npmDecision) {
    mismatches.push("NPM package distribution must match docs/marketplace-readiness.md.");
  }
  const readmeSupport = readmeSupportContact(input.readmeContent);
  if (readmeSupport && normalizedDecisionValue(input.decisionPack, "Support contact") !== readmeSupport) {
    mismatches.push("Support contact must match README.md.");
  }
  const securityReportingContact = securityVulnerabilityReportingContact(input.securityContent);
  if (
    securityReportingContact &&
    normalizedDecisionValue(input.decisionPack, "Security contact") !== securityReportingContact
  ) {
    mismatches.push("Security contact must match SECURITY.md vulnerability reporting contact.");
  }
  if (mismatches.length > 0) {
    failures.push({
      id: "submission-decision-pack-mismatch",
      file,
      message: mismatches.join(" ")
    });
  }
}

function parseMarkdownTableRows(content: string): SubmissionDecisionRow[] {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|") && line.endsWith("|"))
    .map((line) => splitMarkdownTableRow(line).map((cell) => cell.trim()))
    .filter((cells) => cells.length >= 6 && cells[0] !== "Decision" && !/^-+$/.test(cells[0] ?? ""))
    .map(([decision = "", decisionValue = "", owner = "", decisionDate = "", evidence = ""]) => ({
      decision,
      decisionValue,
      owner,
      decisionDate,
      evidence
    }));
}

function splitMarkdownTableRow(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  for (let index = 1; index < line.length - 1; index += 1) {
    const character = line[index];
    if (character === "\\" && line[index + 1] === "|") {
      current += "|";
      index += 1;
      continue;
    }
    if (character === "|") {
      cells.push(current);
      current = "";
      continue;
    }
    current += character;
  }
  cells.push(current);
  return cells;
}

function isValidDecisionValue(value: string): boolean {
  return Boolean(value) && !hasPlaceholderText(value) && !isPlaceholderUrl(value);
}

function extractMarkdownSection(content: string, heading: string): string {
  const withoutFencedBlocks = stripFencedCodeBlocks(content);
  const headingPattern = new RegExp(`^##\\s+${escapeRegExp(heading)}\\s*$`, "im");
  const headingMatches = Array.from(withoutFencedBlocks.matchAll(new RegExp(headingPattern, "gim")));
  if (headingMatches.length !== 1) {
    return "";
  }
  const headingMatch = headingMatches[0]!;
  const sectionStart = headingMatch.index + headingMatch[0].length;
  const sectionTail = withoutFencedBlocks.slice(sectionStart);
  const nextHeadingIndex = sectionTail.search(/^##\s+/m);
  return nextHeadingIndex === -1 ? sectionTail : sectionTail.slice(0, nextHeadingIndex);
}

function checkGoldenPrompts(content: string | undefined, failures: MarketplaceReadinessFailure[]): void {
  const file = "docs/golden-prompts.md";
  if (!content) {
    failures.push({
      id: "golden-prompts-doc-missing",
      file,
      message: "docs/golden-prompts.md is required for ChatGPT developer-mode validation."
    });
    return;
  }
  const missingPromptIds = Array.from({ length: 12 }, (_, index) => `GP-${String(index + 1).padStart(2, "0")}`).filter(
    (id) => !new RegExp(`\\b${id}\\b`).test(content)
  );
  if (missingPromptIds.length > 0) {
    failures.push({
      id: "golden-prompts-incomplete",
      file,
      message: `Golden prompt matrix is missing ${missingPromptIds.join(", ")}.`
    });
  }
}

function checkReleaseEvidenceDocs(content: string | undefined, failures: MarketplaceReadinessFailure[]): void {
  const file = "docs/release-evidence/README.md";
  if (!content) {
    failures.push({
      id: "release-evidence-doc-missing",
      file,
      message: "docs/release-evidence/README.md must document the local release evidence layout."
    });
    return;
  }
  for (const expected of [
    "artifacts/",
    "deployed-smoke.json",
    "server.json",
    "mcp-inspector/",
    "chatgpt-developer-mode/",
    "screenshots/"
  ]) {
    if (!content.includes(expected)) {
      failures.push({
        id: "release-evidence-doc-incomplete",
        file,
        message: `Release evidence documentation must mention ${expected}.`
      });
      return;
    }
  }
}

function checkArtifactIgnore(content: string | undefined, failures: MarketplaceReadinessFailure[]): void {
  if (!content || !/^artifacts\/\s*$/im.test(content)) {
    failures.push({
      id: "artifacts-not-ignored",
      file: ".gitignore",
      message: "Local release artifacts must stay ignored by Git unless sanitized and explicitly published elsewhere."
    });
  }
}

function checkMcpServer(content: string | undefined, failures: MarketplaceReadinessFailure[]): ParsedMcpServer | undefined {
  const file = "server.json";
  if (!content) {
    failures.push({
      id: "mcp-server-missing",
      file,
      message: "server.json is required before publishing to MCP catalogs."
    });
    return undefined;
  }

  let parsed: {
    $schema?: unknown;
    name?: unknown;
    description?: unknown;
    version?: unknown;
    repository?: { url?: unknown };
    remotes?: Array<{ type?: unknown; url?: unknown }>;
  };
  try {
    parsed = JSON.parse(content) as typeof parsed;
  } catch {
    failures.push({
      id: "mcp-server-invalid-json",
      file,
      message: "server.json must be valid JSON."
    });
    return undefined;
  }

  const schema = typeof parsed.$schema === "string" ? parsed.$schema : "";
  const name = typeof parsed.name === "string" ? parsed.name : "";
  const description = typeof parsed.description === "string" ? parsed.description : "";
  const version = typeof parsed.version === "string" ? parsed.version : "";
  const repositoryUrl = typeof parsed.repository?.url === "string" ? parsed.repository.url : "";
  const remoteUrls = Array.isArray(parsed.remotes)
    ? parsed.remotes.map((remote) => (typeof remote.url === "string" ? remote.url : ""))
    : [];
  const remoteTypes = Array.isArray(parsed.remotes)
    ? parsed.remotes.map((remote) => (typeof remote.type === "string" ? remote.type : ""))
    : [];

  if (!/^https:\/\/static\.modelcontextprotocol\.io\/schemas\/.+\/server\.schema\.json$/i.test(schema)) {
    failures.push({
      id: "mcp-schema-missing",
      file,
      message: "server.json must include the official MCP Registry JSON schema URL."
    });
  }
  if (!name || /(^|[./])example([./]|$)|example/i.test(name)) {
    failures.push({
      id: "mcp-name-placeholder",
      file,
      message: "Replace the placeholder MCP registry name with the real namespace."
    });
  }
  if (name && !/^[a-zA-Z0-9.-]+\/[a-zA-Z0-9._-]+$/.test(name)) {
    failures.push({
      id: "mcp-name-invalid",
      file,
      message: "server.json name must use MCP Registry reverse-DNS format with one namespace slash."
    });
  }
  if (!description || description.length > 100) {
    failures.push({
      id: "mcp-description-missing",
      file,
      message: "server.json must include a non-empty description no longer than 100 characters."
    });
  }
  if (!version) {
    failures.push({
      id: "mcp-version-missing",
      file,
      message: "server.json must include a version."
    });
  }
  if (!repositoryUrl || isPlaceholderUrl(repositoryUrl)) {
    failures.push({
      id: "mcp-repository-placeholder",
      file,
      message: "Replace the placeholder repository URL with the public source repository."
    });
  }
  if (remoteUrls.length === 0 || remoteUrls.some((url) => !url || isPlaceholderUrl(url))) {
    failures.push({
      id: "mcp-remote-placeholder",
      file,
      message: "Replace placeholder remote URLs with the deployed HTTPS MCP endpoint."
    });
  }
  if (remoteUrls.some((url) => !url.startsWith("https://"))) {
    failures.push({
      id: "mcp-remote-not-https",
      file,
      message: "Remote MCP endpoints must use HTTPS before marketplace submission."
    });
  }
  if (remoteTypes.some((type) => type !== "streamable-http" && type !== "sse")) {
    failures.push({
      id: "mcp-remote-transport-invalid",
      file,
      message: "Remote MCP endpoints must declare streamable-http or sse transport."
    });
  }
  if (remoteUrls.some((url) => hasInvalidMcpRemotePath(url))) {
    failures.push({
      id: "mcp-remote-path-invalid",
      file,
      message: "Remote MCP endpoint URLs must point at the /mcp path."
    });
  }
  return { name, version, repositoryUrl, remoteUrls };
}

function checkPackageJson(content: string | undefined, failures: MarketplaceReadinessFailure[]): ParsedPackageJson | undefined {
  const file = "package.json";
  if (!content) {
    failures.push({
      id: "package-json-missing",
      file,
      message: "package.json is required for version and optional MCP Registry package checks."
    });
    return undefined;
  }
  let parsed: {
    version?: unknown;
    private?: unknown;
    repository?: unknown;
    main?: unknown;
    files?: unknown;
    mcpName?: unknown;
    engines?: { node?: unknown };
  };
  try {
    parsed = JSON.parse(content) as typeof parsed;
  } catch {
    failures.push({
      id: "package-json-invalid",
      file,
      message: "package.json must be valid JSON."
    });
    return undefined;
  }
  return {
    version: typeof parsed.version === "string" ? parsed.version : "",
    private: typeof parsed.private === "boolean" ? parsed.private : undefined,
    repositoryUrl:
      typeof parsed.repository === "string"
        ? parsed.repository
        : parsed.repository && typeof parsed.repository === "object" && "url" in parsed.repository
          ? String((parsed.repository as { url?: unknown }).url ?? "")
          : "",
    main: typeof parsed.main === "string" ? parsed.main : "",
    files: parsed.files,
    mcpName: typeof parsed.mcpName === "string" ? parsed.mcpName : "",
    nodeEngine: typeof parsed.engines?.node === "string" ? parsed.engines.node : ""
  };
}

function checkPackageMetadata(
  input: {
    packageJson: ParsedPackageJson | undefined;
    mcpServer: ParsedMcpServer | undefined;
    readinessContent: string | undefined;
  },
  failures: MarketplaceReadinessFailure[]
): void {
  const decision = npmPackageDistributionDecision(input.readinessContent);
  if (!decision) {
    failures.push({
      id: "npm-package-decision-missing",
      file: "docs/marketplace-readiness.md",
      message: "Record whether npm package distribution is deferred, planned, or published."
    });
  }
  if (!input.packageJson || !input.mcpServer) {
    return;
  }
  if (input.mcpServer.version && input.packageJson.version && input.mcpServer.version !== input.packageJson.version) {
    failures.push({
      id: "mcp-version-mismatch",
      file: "server.json",
      message: "server.json version must match package.json version."
    });
  }
  if (input.packageJson.mcpName && input.mcpServer.name && input.packageJson.mcpName !== input.mcpServer.name) {
    failures.push({
      id: "mcp-package-name-mismatch",
      file: "package.json",
      message: "package.json mcpName must match server.json name."
    });
  }
  if (decision === "planned" || decision === "published") {
    if (input.packageJson.private !== false) {
      failures.push({
        id: "npm-package-private",
        file: "package.json",
        message: "NPM package distribution requires package.json private to be false."
      });
    }
    if (!input.packageJson.repositoryUrl) {
      failures.push({
        id: "npm-package-repository-missing",
        file: "package.json",
        message: "NPM package distribution requires package.json repository metadata."
      });
    }
    if (!input.packageJson.main) {
      failures.push({
        id: "npm-package-main-missing",
        file: "package.json",
        message: "NPM package distribution requires a runtime main entrypoint."
      });
    }
    if (!Array.isArray(input.packageJson.files) || input.packageJson.files.length === 0) {
      failures.push({
        id: "npm-package-files-missing",
        file: "package.json",
        message: "NPM package distribution requires a files allowlist."
      });
    }
    if (!input.packageJson.mcpName) {
      failures.push({
        id: "npm-package-mcp-name-missing",
        file: "package.json",
        message: "NPM package distribution requires package.json mcpName ownership metadata."
      });
    }
    if (!input.packageJson.nodeEngine) {
      failures.push({
        id: "npm-package-engines-missing",
        file: "package.json",
        message: "NPM package distribution requires package.json engines.node."
      });
    }
  }
}

function checkLegalDocument(
  input: { file: string; content: string | undefined; draftId: string; missingId: string },
  failures: MarketplaceReadinessFailure[]
): void {
  if (!input.content) {
    failures.push({
      id: input.missingId,
      file: input.file,
      message: `${input.file} is required before marketplace submission.`
    });
    return;
  }
  if (hasPlaceholderText(input.content)) {
    failures.push({
      id: input.draftId,
      file: input.file,
      message: `${input.file} still looks like draft or placeholder legal copy.`
    });
  }
}

function checkSecurity(content: string | undefined, failures: MarketplaceReadinessFailure[]): void {
  if (!content) {
    failures.push({
      id: "security-missing",
      file: "SECURITY.md",
      message: "SECURITY.md is required before marketplace submission."
    });
    return;
  }
  if (
    !/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(content) ||
    /repository owner/i.test(content) ||
    hasPlaceholderText(content) ||
    /\.example\b/i.test(content)
  ) {
    failures.push({
      id: "security-contact-placeholder",
      file: "SECURITY.md",
      message: "Add real support and vulnerability-reporting contact details."
    });
  }
}

function checkReadme(content: string | undefined, failures: MarketplaceReadinessFailure[]): void {
  if (!content) {
    failures.push({
      id: "readme-missing",
      file: "README.md",
      message: "README.md is required before marketplace submission."
    });
    return;
  }
  if (
    /implementation scaffold|private development|private beta|non-production|not ready|production deployment still needs/i.test(
      content
    )
  ) {
    failures.push({
      id: "readme-status-not-production",
      file: "README.md",
      message: "README still describes the project as non-production or incomplete."
    });
  }
  if (!/support:\s*[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(content) || hasPlaceholderText(content)) {
    failures.push({
      id: "readme-support-contact-missing",
      file: "README.md",
      message: "README must include real support contact details before submission."
    });
  }
}

function checkReleaseEvidence(content: string | undefined, failures: MarketplaceReadinessFailure[]): void {
  if (!content) {
    failures.push({
      id: "readiness-doc-missing",
      file: "docs/marketplace-readiness.md",
      message: "Marketplace readiness evidence document is required."
    });
    return;
  }
  const evidenceContent = stripFencedCodeBlocks(content);
  if (/not ready|private development build|implementation scaffold/i.test(evidenceContent)) {
    failures.push({
      id: "readiness-status-not-production",
      file: "docs/marketplace-readiness.md",
      message: "Readiness status still says this is not a production candidate."
    });
  }
  if (hasPlaceholderText(content)) {
    failures.push({
      id: "readiness-evidence-placeholder",
      file: "docs/marketplace-readiness.md",
      message: "Readiness evidence still contains TODO, draft, or placeholder text."
    });
  }
  if (!/MCP Inspector:\s*PASS/i.test(evidenceContent)) {
    failures.push({
      id: "mcp-inspector-evidence-missing",
      file: "docs/marketplace-readiness.md",
      message: "Record MCP Inspector PASS evidence before release."
    });
  }
  if (!/ChatGPT developer-mode validation:\s*PASS/i.test(evidenceContent)) {
    failures.push({
      id: "chatgpt-validation-evidence-missing",
      file: "docs/marketplace-readiness.md",
      message: "Record ChatGPT developer-mode validation PASS evidence before release."
    });
  }
  checkApiKeyPolicyGate(evidenceContent, failures);
  checkDeferredPublicChatGptSubmission(evidenceContent, failures);
  if (/Current status:\s*production candidate/i.test(evidenceContent) || /:\s*PASS/i.test(evidenceContent)) {
    checkConcreteReleaseEvidence(evidenceContent, failures);
  }
}

function checkApiKeyPolicyGate(content: string, failures: MarketplaceReadinessFailure[]): void {
  const file = "docs/marketplace-readiness.md";
  const requiredFields = ["Decision owner", "Decision date", "Evidence link", "Chosen path"];
  const hasAllFields = requiredFields.every((field) => new RegExp(`^${field}:\\s*\\S.+$`, "im").test(content));
  const hasDecisionDate = /^Decision date:\s*\d{4}-\d{2}-\d{2}\s*$/im.test(content);
  const hasEvidenceLink = /^Evidence link:\s*https:\/\/\S+\s*$/im.test(content);
  const hasAcceptedPath =
    /^Chosen path:\s*(?:OpenAI confirms|Clockify confirms|Public ChatGPT submission is deferred)\b.+$/im.test(content);

  if (!hasAllFields || !hasDecisionDate || !hasEvidenceLink || !hasAcceptedPath) {
    failures.push({
      id: "api-key-policy-gate-unresolved",
      file,
      message: "Document the API-key onboarding policy decision, owner, date, evidence link, and chosen path before release."
    });
  }
}

function checkDeferredPublicChatGptSubmission(content: string, failures: MarketplaceReadinessFailure[]): void {
  const deferred = /^Chosen path:\s*Public ChatGPT submission is deferred\b.+$/im.test(content);
  const claimsProductionCandidate = /^Current status:\s*production candidate\s*\.?\s*$/im.test(content);
  const claimsChatGptPass = /^ChatGPT developer-mode validation:\s*PASS\s*$/im.test(content);
  if (deferred && (claimsProductionCandidate || claimsChatGptPass)) {
    failures.push({
      id: "chatgpt-public-submission-deferred",
      file: "docs/marketplace-readiness.md",
      message:
        "A deferred public ChatGPT submission decision cannot be recorded as a production candidate for ChatGPT marketplace release."
    });
  }
}

function checkConcreteReleaseEvidence(content: string, failures: MarketplaceReadinessFailure[]): void {
  const file = "docs/marketplace-readiness.md";
  if (!/^Production endpoint:\s*https:\/\/\S+\/mcp\s*$/im.test(content)) {
    failures.push({
      id: "readiness-endpoint-missing",
      file,
      message: "Record the exact deployed HTTPS MCP endpoint used for validation."
    });
  }
  if (!/^Source commit:\s*[a-f0-9]{40}\s*$/im.test(content)) {
    failures.push({
      id: "readiness-commit-missing",
      file,
      message: "Record the exact 40-character source commit validated for release."
    });
  }
  if (!/^MCP Inspector run date:\s*\d{4}-\d{2}-\d{2}\s*$/im.test(content)) {
    failures.push({
      id: "mcp-inspector-date-missing",
      file,
      message: "Record the MCP Inspector validation date in YYYY-MM-DD format."
    });
  }
  if (!/^MCP Inspector artifact:\s*https:\/\/\S+\s*$/im.test(content)) {
    failures.push({
      id: "mcp-inspector-artifact-missing",
      file,
      message: "Link the saved MCP Inspector validation artifact."
    });
  }
  if (!/^ChatGPT validation date:\s*\d{4}-\d{2}-\d{2}\s*$/im.test(content)) {
    failures.push({
      id: "chatgpt-validation-date-missing",
      file,
      message: "Record the ChatGPT developer-mode validation date in YYYY-MM-DD format."
    });
  }
  if (!/^ChatGPT validation artifact:\s*https:\/\/\S+\s*$/im.test(content)) {
    failures.push({
      id: "chatgpt-validation-artifact-missing",
      file,
      message: "Link the saved ChatGPT developer-mode validation artifact."
    });
  }
  if (!/^Golden prompt matrix:\s*PASS\s*$/im.test(content)) {
    failures.push({
      id: "golden-prompt-evidence-missing",
      file,
      message: "Record ChatGPT golden prompt matrix PASS evidence before release."
    });
  }
  if (!/^Golden prompt artifact folder:\s*https:\/\/\S+\s*$/im.test(content)) {
    failures.push({
      id: "golden-prompt-artifact-missing",
      file,
      message: "Link the saved ChatGPT golden prompt evidence folder."
    });
  }
  if (!/^Deployed smoke check:\s*PASS\s*$/im.test(content)) {
    failures.push({
      id: "deployed-smoke-evidence-missing",
      file,
      message: "Record deployed smoke validation PASS evidence before release."
    });
  }
  if (!/^Deployed smoke run date:\s*\d{4}-\d{2}-\d{2}\s*$/im.test(content)) {
    failures.push({
      id: "deployed-smoke-date-missing",
      file,
      message: "Record the deployed smoke validation date in YYYY-MM-DD format."
    });
  }
  if (!/^Deployed smoke artifact:\s*https:\/\/\S+\s*$/im.test(content)) {
    failures.push({
      id: "deployed-smoke-artifact-missing",
      file,
      message: "Link the saved deployed smoke validation artifact."
    });
  }
  if (!/^MCP Registry manifest:\s*PASS\s*$/im.test(content)) {
    failures.push({
      id: "mcp-registry-evidence-missing",
      file,
      message: "Record MCP Registry manifest PASS evidence before catalog release."
    });
  }
  if (!/^MCP Registry manifest artifact:\s*https:\/\/\S+\s*$/im.test(content)) {
    failures.push({
      id: "mcp-registry-artifact-missing",
      file,
      message: "Link the saved MCP Registry manifest or publisher validation artifact."
    });
  }
  if (!/^Submission screenshots:\s*https:\/\/\S+\s*$/im.test(content)) {
    failures.push({
      id: "readiness-screenshots-missing",
      file,
      message: "Link the final submission screenshots or screenshot bundle."
    });
  }
  if (!/^Demo account:\s*prepared\b.+/im.test(content)) {
    failures.push({
      id: "readiness-demo-account-missing",
      file,
      message: "Record that the demo Clockify account is prepared with sample data."
    });
  }
}

function isPlaceholderUrl(value: string): boolean {
  return /example\.com|\.example\b|github\.com\/example\b|placeholder|todo/i.test(value);
}

function decisionValue(decisionPack: SubmissionDecisionPack, decision: string): string {
  return decisionPack.get(decision)?.decisionValue ?? "";
}

function normalizedDecisionValue(decisionPack: SubmissionDecisionPack, decision: string): string {
  return decisionValue(decisionPack, decision).trim().toLowerCase();
}

function readmeSupportContact(content: string | undefined): string | undefined {
  return /\bsupport:\s*([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i
    .exec(content ?? "")?.[1]
    ?.toLowerCase();
}

function securityVulnerabilityReportingContact(content: string | undefined): string | undefined {
  const value = content ?? "";
  return (
    /report vulnerabilities to\s*([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i.exec(value)?.[1] ??
    /\b(?:security contact|security|vulnerability reporting):\s*([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i.exec(
      value
    )?.[1] ??
    /([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i.exec(value)?.[1]
  )?.toLowerCase();
}

function firstRemoteOrigin(remoteUrls: string[] | undefined): string | undefined {
  const firstUrl = remoteUrls?.[0];
  if (!firstUrl) {
    return undefined;
  }
  try {
    return new URL(firstUrl).origin;
  } catch {
    return undefined;
  }
}

function hasInvalidMcpRemotePath(value: string): boolean {
  try {
    return new URL(value).pathname !== "/mcp";
  } catch {
    return true;
  }
}

function npmPackageDistributionDecision(content: string | undefined): "deferred" | "planned" | "published" | undefined {
  const match = /^NPM package distribution:\s*(deferred|planned|published)\b/im.exec(
    stripFencedCodeBlocks(content ?? "")
  );
  return match?.[1].toLowerCase() as "deferred" | "planned" | "published" | undefined;
}

function hasPlaceholderText(value: string): boolean {
  return /\bdraft\b|\bplaceholder\b|\btodo\b|replace before publication|fill in real/i.test(value);
}

function stripFencedCodeBlocks(value: string): string {
  return value.replace(/```[\s\S]*?```/g, "");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
