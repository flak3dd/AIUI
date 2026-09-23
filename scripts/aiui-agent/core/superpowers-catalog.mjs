import fs from 'node:fs';
import path from 'node:path';
import { ROOT_DIR } from '../config.mjs';

const SKILLS_DIR = path.join(ROOT_DIR, 'skills', 'superpowers');

function skillEntries() {
  if (!fs.existsSync(SKILLS_DIR)) return [];
  return fs
    .readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const file = path.join(SKILLS_DIR, entry.name, 'SKILL.md');
      if (!fs.existsSync(file)) return null;
      const head = fs.readFileSync(file, 'utf8').slice(0, 800);
      const description = head.match(/^description:\s*(.+)$/m)?.[1]?.trim() || '';
      return { name: entry.name, description };
    })
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Short bootstrap. Full skill text stays on disk and is read with read_file. */
export function superpowersDirective() {
  const skills = skillEntries();
  if (skills.length === 0) return '';
  const pin = (() => {
    try {
      return fs.readFileSync(path.join(SKILLS_DIR, 'PIN'), 'utf8').trim();
    } catch {
      return 'unpinned';
    }
  })();
  const lines = skills.map((skill) => `- ${skill.name}: ${skill.description}`);
  return `Superpowers (obra/superpowers @ ${pin.slice(0, 12)}, MIT, local files only — not a marketplace MCP):
Before writing code, fixing a bug, or claiming done, read the matching skills/superpowers/<name>/SKILL.md and follow it.
- New build → brainstorming, then writing-plans, then test-driven-development.
- Bug → systematic-debugging, then verification-before-completion.
- Do not install Mem0, Zep, Puppeteer, Browser Use, Stripe, or a second filesystem MCP. MemPalace is the only long-term memory. Playwright is the only browser engine. File edits use read_file / replace_file_content / write_file inside the workspace, not raw shell as the file API.
${lines.join('\n')}`;
}
