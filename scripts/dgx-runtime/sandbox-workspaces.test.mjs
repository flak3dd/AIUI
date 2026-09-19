import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  allocateWorkspace,
  resolveWorkspace,
  listWorkspaces,
} from "./sandbox-workspaces.mjs";

const base = await mkdtemp(path.join(os.tmpdir(), "spark-ws-"));
try {
  const a = await allocateWorkspace({ chatId: "chat-a", baseDir: base });
  assert.equal(a.envId, "workspace1");
  assert.ok(a.path.endsWith("workspace1"));
  const b = await allocateWorkspace({ chatId: "chat-b", baseDir: base });
  assert.equal(b.envId, "workspace2");
  const again = await allocateWorkspace({ chatId: "chat-a", baseDir: base });
  assert.equal(again.envId, "workspace1"); // same chat reuses
  const resolved = await resolveWorkspace({ chatId: "chat-b", baseDir: base });
  assert.equal(resolved.envId, "workspace2");

  const list = await listWorkspaces(base);
  assert.equal(list.length, 2);
  console.log("✔ sandbox-workspaces test suite passed!");
} finally {
  await rm(base, { recursive: true, force: true });
}
