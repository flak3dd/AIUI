import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { syncAiuiRepo } from "./sandbox-git-sync.mjs";

const execFileP = promisify(execFile);

const root = await mkdtemp(path.join(os.tmpdir(), "aiui-sync-"));
const bare = path.join(root, "bare.git");
const ws = path.join(root, "workspace1");
try {
  await execFileP("git", ["init", "--bare", bare]);
  const seed = path.join(root, "seed");
  await mkdir(seed);
  await execFileP("git", ["-C", seed, "init"]);
  await execFileP("git", ["-C", seed, "config", "user.email", "t@t"]);
  await execFileP("git", ["-C", seed, "config", "user.name", "t"]);
  await writeFile(path.join(seed, "README.md"), "hi\n");
  await execFileP("git", ["-C", seed, "add", "."]);
  await execFileP("git", ["-C", seed, "commit", "-m", "init"]);
  await execFileP("git", ["-C", seed, "branch", "-M", "main"]);
  await execFileP("git", ["-C", seed, "remote", "add", "origin", bare]);
  await execFileP("git", ["-C", seed, "push", "-u", "origin", "main"]);

  const r1 = await syncAiuiRepo({
    workspacePath: ws,
    remoteUrl: bare,
    branch: "main",
  });
  assert.equal(r1.action, "clone");
  assert.equal(r1.ok, true);

  await writeFile(path.join(seed, "README.md"), "hi2\n");
  await execFileP("git", ["-C", seed, "add", "."]);
  await execFileP("git", ["-C", seed, "commit", "-m", "upd"]);
  await execFileP("git", ["-C", seed, "push"]);

  const r2 = await syncAiuiRepo({
    workspacePath: ws,
    remoteUrl: bare,
    branch: "main",
  });
  assert.equal(r2.action, "pull");
  assert.equal(r2.ok, true);

  console.log("✔ sandbox-git-sync test suite passed!");
} finally {
  await rm(root, { recursive: true, force: true });
}
