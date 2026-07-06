import { existsSync, readFileSync } from "node:fs";

type PackageJson = {
  scripts?: {
    dev?: string;
    start?: string;
  };
};

describe("package scripts", () => {
  test("start script points at the compiled server entrypoint", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as PackageJson;
    const startScript = packageJson.scripts?.start ?? "";

    expect(startScript).toBe("node dist/src/server/index.js");
    expect(existsSync("src/server/index.ts")).toBe(true);
  });

  test("dev script loads local .env when present", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as PackageJson;
    const devScript = packageJson.scripts?.dev ?? "";

    expect(devScript).toBe("tsx watch --env-file-if-exists=.env src/server/index.ts");
  });
});
