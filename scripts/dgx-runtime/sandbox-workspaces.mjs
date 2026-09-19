import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import path from "node:path";

const DEFAULT_BASE = process.env.SANDBOX_BASE || "/tmp/spark-sandboxes";
const REGISTRY = "_registry.json";

async function loadRegistry(baseDir) {
  try {
    return JSON.parse(await readFile(path.join(baseDir, REGISTRY), "utf8"));
  } catch {
    return { next: 1, chats: {} };
  }
}

async function saveRegistry(baseDir, reg) {
  await mkdir(baseDir, { recursive: true });
  await writeFile(path.join(baseDir, REGISTRY), JSON.stringify(reg, null, 2));
}

export async function allocateWorkspace({ chatId, baseDir = DEFAULT_BASE }) {
  if (!chatId) throw new Error("chatId required");
  await mkdir(baseDir, { recursive: true });
  const reg = await loadRegistry(baseDir);
  if (reg.chats[chatId]) {
    const envId = reg.chats[chatId];
    const dir = path.join(baseDir, envId);
    await mkdir(dir, { recursive: true });
    return { envId, path: dir, chatId, created: false };
  }
  const envId = `workspace${reg.next}`;
  reg.next += 1;
  reg.chats[chatId] = envId;
  const dir = path.join(baseDir, envId);
  await mkdir(dir, { recursive: true });
  await saveRegistry(baseDir, reg);
  return { envId, path: dir, chatId, created: true };
}

export async function resolveWorkspace({
  chatId,
  envId,
  baseDir = DEFAULT_BASE,
}) {
  const reg = await loadRegistry(baseDir);
  const id = envId || (chatId ? reg.chats[chatId] : null);
  if (!id) return null;
  return { envId: id, path: path.join(baseDir, id), chatId: chatId || null };
}

export async function listWorkspaces(baseDir = DEFAULT_BASE) {
  const reg = await loadRegistry(baseDir);
  const out = [];
  for (const [chatId, envId] of Object.entries(reg.chats)) {
    out.push({ envId, path: path.join(baseDir, envId), chatId });
  }
  return out;
}
