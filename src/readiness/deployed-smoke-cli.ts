import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { formatDeployedSmokeText, runDeployedSmokeChecks, writeDeployedSmokeArtifact } from "./deployed-smoke.js";

const baseUrl = process.env.MCP_BASE_URL ?? process.env.PUBLIC_BASE_URL;
const accessToken = process.env.MCP_ACCESS_TOKEN;
const outputPath = process.env.SMOKE_OUTPUT_JSON ?? process.env.SMOKE_ARTIFACT_PATH;
const smokeToolCall = process.env.SMOKE_TOOL_CALL;

if (!baseUrl) {
  console.error("Set MCP_BASE_URL or PUBLIC_BASE_URL to the deployed ClockifyMCP origin or /mcp URL.");
  process.exitCode = 1;
} else {
  try {
    const result = await runDeployedSmokeChecks({
      baseUrl,
      accessToken,
      smokeToolCall
    });

    for (const line of formatDeployedSmokeText(result)) {
      console.log(line);
    }

    if (outputPath) {
      await writeDeployedSmokeArtifact({
        result,
        outputPath,
        authenticated: Boolean(accessToken),
        ensureParentDirectory: async (path) => {
          await mkdir(dirname(path), { recursive: true });
        },
        writeFile
      });
      console.log(`Artifact: ${outputPath}`);
    }

    if (!result.ok) {
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Deployed smoke validation failed.");
    process.exitCode = 1;
  }
}
