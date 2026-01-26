/**
 * Claude CLI integration for classification.
 * Ported from Python human_review/cli.py:classify()
 */

import { execSync, spawn, type SpawnOptions } from "node:child_process";

export interface ClassificationResult {
  label: string[];
  reasoning: string;
}

export interface ClassificationResponse {
  success: boolean;
  classifications?: Record<string, ClassificationResult>;
  error?: string;
}

/**
 * Find the Claude CLI executable.
 */
export function findClaudeExecutable(): string | null {
  try {
    // Try 'which claude' on Unix-like systems
    const result = execSync("which claude", { encoding: "utf-8" }).trim();
    return result || null;
  } catch {
    // Try 'where claude' on Windows
    try {
      const result = execSync("where claude", { encoding: "utf-8" }).trim();
      return result.split("\n")[0] || null;
    } catch {
      return null;
    }
  }
}

/**
 * Parse Claude CLI output, handling markdown code blocks.
 */
function extractJsonFromOutput(output: string): string {
  let text = output.trim();

  // Extract JSON from markdown code blocks
  if (text.includes("```json")) {
    const start = text.indexOf("```json") + 7;
    const end = text.indexOf("```", start);
    if (end > start) {
      text = text.slice(start, end).trim();
    }
  } else if (text.includes("```")) {
    const start = text.indexOf("```") + 3;
    const end = text.indexOf("```", start);
    if (end > start) {
      text = text.slice(start, end).trim();
    }
  }

  return text;
}

/**
 * Run Claude CLI with a prompt and return the classifications.
 */
export async function runClassification(
  prompt: string,
  cwd: string,
  model?: string,
): Promise<ClassificationResponse> {
  const claudePath = findClaudeExecutable();
  if (!claudePath) {
    return {
      success: false,
      error: "Claude CLI not found. Install it from https://claude.ai/code",
    };
  }

  return new Promise((resolve) => {
    const args = ["--print", "-p", prompt];
    if (model) {
      args.push("--model", model);
    }

    const options: SpawnOptions = {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
    };

    const child = spawn(claudePath, args, options);

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    // 5 minute timeout
    const timeout = setTimeout(() => {
      child.kill();
      resolve({ success: false, error: "Claude timed out after 5 minutes" });
    }, 300000);

    child.on("close", (code) => {
      clearTimeout(timeout);

      if (code !== 0) {
        resolve({
          success: false,
          error: `Claude failed with exit code ${code}: ${stderr}`,
        });
        return;
      }

      try {
        const jsonStr = extractJsonFromOutput(stdout);
        const parsed = JSON.parse(jsonStr);

        if (typeof parsed !== "object" || parsed === null) {
          resolve({
            success: false,
            error: "Expected JSON object from Claude",
          });
          return;
        }

        // Convert to expected format
        const classifications: Record<string, ClassificationResult> = {};
        for (const [hunkKey, data] of Object.entries(parsed)) {
          if (typeof data === "object" && data !== null) {
            const d = data as Record<string, unknown>;
            const label = Array.isArray(d.label) ? d.label : [];
            const reasoning =
              typeof d.reasoning === "string" ? d.reasoning : String(d.reasoning || "");
            classifications[hunkKey] = { label, reasoning };
          } else if (typeof data === "string") {
            classifications[hunkKey] = { label: [], reasoning: data };
          }
        }

        resolve({ success: true, classifications });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Unknown parse error";
        resolve({
          success: false,
          error: `Failed to parse Claude response: ${message}\n\nResponse:\n${stdout.slice(0, 500)}`,
        });
      }
    });

    child.on("error", (err) => {
      clearTimeout(timeout);
      resolve({ success: false, error: `Failed to spawn Claude: ${err.message}` });
    });
  });
}

/**
 * Synchronous version of runClassification for simpler use.
 */
export function runClassificationSync(
  prompt: string,
  cwd: string,
  model?: string,
): ClassificationResponse {
  const claudePath = findClaudeExecutable();
  if (!claudePath) {
    return {
      success: false,
      error: "Claude CLI not found. Install it from https://claude.ai/code",
    };
  }

  const args = ["--print", "-p", prompt];
  if (model) {
    args.push("--model", model);
  }

  try {
    const result = execSync([claudePath, ...args].join(" "), {
      cwd,
      encoding: "utf-8",
      timeout: 300000, // 5 minute timeout
      maxBuffer: 50 * 1024 * 1024, // 50MB buffer
    });

    const jsonStr = extractJsonFromOutput(result);
    const parsed = JSON.parse(jsonStr);

    if (typeof parsed !== "object" || parsed === null) {
      return {
        success: false,
        error: "Expected JSON object from Claude",
      };
    }

    // Convert to expected format
    const classifications: Record<string, ClassificationResult> = {};
    for (const [hunkKey, data] of Object.entries(parsed)) {
      if (typeof data === "object" && data !== null) {
        const d = data as Record<string, unknown>;
        const label = Array.isArray(d.label) ? d.label : [];
        const reasoning = typeof d.reasoning === "string" ? d.reasoning : String(d.reasoning || "");
        classifications[hunkKey] = { label, reasoning };
      } else if (typeof data === "string") {
        classifications[hunkKey] = { label: [], reasoning: data };
      }
    }

    return { success: true, classifications };
  } catch (err: unknown) {
    const error = err as { stderr?: string; message?: string };
    if (error.message?.includes("ETIMEDOUT") || error.message?.includes("timeout")) {
      return { success: false, error: "Claude timed out after 5 minutes" };
    }
    return {
      success: false,
      error: error.stderr || error.message || "Unknown error",
    };
  }
}
