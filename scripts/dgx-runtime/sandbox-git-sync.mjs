import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";

const execFileP = promisify(execFile);
const DEFAULT_REMOTE = process.env.AIUI_REMOTE_URL || "https://github.com/flak3dd/AIUI.git";
const DEFAULT_BRANCH = process.env.AIUI_BRANCH || "main";

export async function syncAiuiRepo({
  workspacePath,
  remoteUrl = DEFAULT_REMOTE,
  branch = DEFAULT_BRANCH,
}) {
  if (!workspacePath) throw new Error("workspacePath required");
  const gitDir = path.join(workspacePath, ".git");

  if (!fs.existsSync(gitDir)) {
    // Fresh workspace -> clone
    try {
      await execFileP("git", ["clone", "--branch", branch, remoteUrl, workspacePath], {
        timeout: 120000,
      });
      const { stdout: headOut } = await execFileP("git", ["-C", workspacePath, "rev-parse", "HEAD"]);
      return {
        ok: true,
        action: "clone",
        head: headOut.trim(),
        workspacePath,
      };
    } catch (err) {
      return {
        ok: false,
        action: "clone",
        error: err.stderr || err.message,
        workspacePath,
      };
    }
  } else {
    // Existing workspace -> fetch and fast-forward pull
    try {
      await execFileP("git", ["-C", workspacePath, "fetch", "origin", branch], {
        timeout: 60000,
      });
      await execFileP("git", ["-C", workspacePath, "pull", "--ff-only", "origin", branch], {
        timeout: 60000,
      });
      const { stdout: headOut } = await execFileP("git", ["-C", workspacePath, "rev-parse", "HEAD"]);
      return {
        ok: true,
        action: "pull",
        head: headOut.trim(),
        workspacePath,
      };
    } catch (err) {
      const isNonFf = (err.stderr || err.message || "").includes("Not possible to fast-forward");
      return {
        ok: false,
        action: "pull",
        error: isNonFf ? "non-ff" : (err.stderr || err.message),
        workspacePath,
      };
    }
  }
}
