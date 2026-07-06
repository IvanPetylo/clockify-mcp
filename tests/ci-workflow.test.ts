import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflowPath = ".github/workflows/ci.yml";

function readWorkflow(): string {
  return existsSync(workflowPath) ? readFileSync(workflowPath, "utf8") : "";
}

function readPackageJson(): { scripts: Record<string, string> } {
  return JSON.parse(readFileSync("package.json", "utf8")) as {
    scripts: Record<string, string>;
  };
}

describe("CI workflow", () => {
  it("runs the required local engineering gates on Node 22", () => {
    const workflow = readWorkflow();

    expect(existsSync(workflowPath)).toBe(true);
    expect(workflow).toContain("actions/setup-node@v4");
    expect(workflow).toContain("node-version: 22");
    expect(workflow).toContain("npm ci");
    expect(workflow).toContain("npm test");
    expect(workflow).toContain("npm run typecheck");
    expect(workflow).toContain("npm run lint");
    expect(workflow).toContain("npm run build");
  });

  it("keeps marketplace readiness as an explicit manual release gate", () => {
    const workflow = readWorkflow();
    const packageJson = readPackageJson();

    expect(packageJson.scripts.verify).toBe(
      "npm test && npm run typecheck && npm run lint && npm run build"
    );
    expect(workflow).not.toContain("npm run readiness");
  });
});
