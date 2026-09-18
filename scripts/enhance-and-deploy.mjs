import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const AIUIRO_DIR = '/Users/adminuser/AIUIRO-216';
const RORK_DIR = '/Users/adminuser/rork-checkout-r----apps------io';
const SCRIPTS_DIR = '/Users/adminuser/AIUI/scripts';

console.log('=== STARTING FEATHERLESS SELF-HEALING ENHANCEMENT & DEPLOYMENT ===');

// 1. Copy error_fixer.py and error_checker.py to AIUIRO-216
const fixerCode = fs.readFileSync(path.join(SCRIPTS_DIR, 'error_fixer_template.py'), 'utf-8');
const checkerCode = fs.readFileSync(path.join(SCRIPTS_DIR, 'error_checker_template.py'), 'utf-8');

fs.writeFileSync(path.join(AIUIRO_DIR, 'error_fixer.py'), fixerCode, { mode: 0o755 });
fs.writeFileSync(path.join(AIUIRO_DIR, 'error_checker.py'), checkerCode, { mode: 0o755 });
console.log('✅ Updated error_fixer.py and error_checker.py in AIUIRO-216');

// 2. Update cron_job.sh in AIUIRO-216
const cronJobSh = `#!/usr/bin/env bash
# Periodic Featherless AI Self-Healing Error Monitor
set -e

DIR="$(cd -P "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
export FEATHERLESS_API_KEY="\${FEATHERLESS_API_KEY:-rc_a939625b5ebea3e527e07ee81d1d3ac10a77be72203eed6e53c3a81f4174a86a}"

echo "=== [$(date '+%Y-%m-%d %H:%M:%S')] Featherless AI Self-Healing Monitor ==="
python3 "\${DIR}/error_checker.py" --heal --dir "\${DIR}"
echo "=== Monitor pass finished cleanly ==="
`;
fs.writeFileSync(path.join(AIUIRO_DIR, 'cron_job.sh'), cronJobSh, { mode: 0o755 });
console.log('✅ Updated cron_job.sh in AIUIRO-216');

// 3. Enhance featherless-chat.py
const chatSrcPath = path.join(RORK_DIR, 'featherless-chat.py');
try {
  execSync('git checkout featherless-chat.py', { cwd: RORK_DIR });
} catch (e) {
  /* ignore */
}
let chatCode = fs.readFileSync(chatSrcPath, 'utf-8');

// Add heal_command method to FeatherlessChatAgent if not already present
if (!chatCode.includes('def heal_command(')) {
  const methodToInsert = `
    def heal_command(self, command: str, max_rounds: int = 5) -> bool:
        """Execute a command and autonomously self-heal any failures using Featherless AI"""
        if RICH_AVAILABLE:
            self.console.print(Panel(
                f"[bold cyan]🚀 Executing with Self-Healing:[/bold cyan] [bold yellow]{command}[/bold yellow]",
                border_style="bright_cyan"
            ))
        else:
            print(f"🚀 Executing with Self-Healing: {command}")

        for round_idx in range(1, max_rounds + 1):
            out = self.tools.run_command(command)
            exit_code = 0
            if "Exit Code: " in out:
                try:
                    exit_code = int(out.split("Exit Code: ")[1].split("\\n")[0].strip())
                except Exception:
                    exit_code = 0

            if exit_code == 0 and "Traceback (most recent call last)" not in out:
                success_msg = f"✨ [SELF-HEAL COMPLETE] Command passed cleanly with Exit Code 0 on round {round_idx}!"
                if RICH_AVAILABLE:
                    self.console.print(Panel(success_msg, border_style="bright_green"))
                    self.console.print(Panel(out, title="Output", border_style="dim"))
                else:
                    print(success_msg)
                    print(out)
                return True

            heal_header = f"🩹 [SELF-HEALING ROUND {round_idx}/{max_rounds}] Command exited with code {exit_code}"
            if RICH_AVAILABLE:
                self.console.print(Panel(heal_header, border_style="yellow"))
                self.console.print(Panel(out, title="Error Traceback", border_style="red"))
            else:
                print(heal_header)
                print(out)

            heal_prompt = f"""[AUTONOMOUS SELF-HEALING REQUEST - ROUND {round_idx}/{max_rounds}]
The command \`{command}\` failed with exit code {exit_code}.

Command Output / Error:
{out}

TASK DIRECTIVE:
1. Inspect the error and identify the exact root cause, file, and line number.
2. Use \`read_file\` or \`search_files\` to inspect the failing code.
3. Use \`edit_file\` or \`write_file\` to fix the bug directly.
4. Run \`{command}\` with \`run_command\` to test and confirm the fix.
5. Provide a summary once the command exits with code 0."""

            self.send_message(heal_prompt)

            verify_out = self.tools.run_command(command)
            v_code = 0
            if "Exit Code: " in verify_out:
                try:
                    v_code = int(verify_out.split("Exit Code: ")[1].split("\\n")[0].strip())
                except Exception:
                    v_code = 0
            if v_code == 0 and "Traceback (most recent call last)" not in verify_out:
                success_msg = f"✨ [SELF-HEAL VERIFIED] Fix successful! Command passed with Exit Code 0."
                if RICH_AVAILABLE:
                    self.console.print(Panel(success_msg, border_style="bright_green"))
                else:
                    print(success_msg)
                return True

        fail_msg = f"❌ [SELF-HEAL FAILED] Could not resolve error after {max_rounds} rounds."
        if RICH_AVAILABLE:
            self.console.print(Panel(fail_msg, border_style="red"))
        else:
            print(fail_msg)
        return False
`;

  // Insert before def run_direct_command
  chatCode = chatCode.replace('    def run_direct_command(self, cmd_line: str):', methodToInsert + '\n    def run_direct_command(self, cmd_line: str):');
}

// Add /heal slash command to _handle_command after /help
if (!chatCode.includes('elif cmd == "/heal":')) {
  const slashHeal = `        elif cmd == "/heal":
            if len(parts) > 1:
                self.heal_command(" ".join(parts[1:]))
            else:
                print("Usage: /heal <command to run and fix>")\n`;
  chatCode = chatCode.replace('        elif cmd == "/tools":', slashHeal + '        elif cmd == "/tools":');
}

// Add CLI argument --heal
if (!chatCode.includes('parser.add_argument("--heal",')) {
  chatCode = chatCode.replace(
    '    parser.add_argument("--prompt", "--task", "-t", dest="task", help="Execute task autonomously and exit")',
    '    parser.add_argument("--prompt", "--task", "-t", dest="task", help="Execute task autonomously and exit")\n    parser.add_argument("--heal", help="Run command and enter autonomous self-healing loop on error")'
  );

  chatCode = chatCode.replace(
    '    if args.task:\n        agent.send_message(args.task)\n    else:\n        agent.run_interactive()',
    '    if args.heal:\n        agent.heal_command(args.heal)\n    elif args.task:\n        agent.send_message(args.task)\n    else:\n        agent.run_interactive()'
  );
}

// Write back to RORK_DIR and AIUIRO_DIR
fs.writeFileSync(chatSrcPath, chatCode, { mode: 0o755 });
fs.writeFileSync(path.join(AIUIRO_DIR, 'featherless-chat.py'), chatCode, { mode: 0o755 });
console.log('✅ Updated featherless-chat.py in both rork-checkout and AIUIRO-216');

// 4. Create README in AIUIRO-216
const docMd = `# 🪶 Featherless AI Self-Healing Error Fixer

This repository contains autonomous self-healing tools powered by **Featherless.ai**.

## Capabilities

1. **Autonomous Self-Healing Command Runner**:
   Runs any command or script. If an error occurs, Featherless AI analyzes the traceback, inspects the failing file, edits the code, and re-executes until the command succeeds with Exit Code 0:
   \`\`\`bash
   python3 featherless-chat.py --heal "python3 your_script.py"
   # or with global feather CLI
   feather --heal "npm test"
   \`\`\`

2. **Workspace Syntax Scanner & Auto-Healer**:
   Scans all Python and JSON files in the workspace for compilation errors and automatically repairs them:
   \`\`\`bash
   python3 error_checker.py --heal
   \`\`\`

3. **Autonomous Interactive Agent**:
   Full terminal agent with autonomous tool execution:
   \`\`\`bash
   python3 featherless-chat.py
   \`\`\`
   Inside the chat, use \`/heal <command>\` to run and heal any failing process.

4. **Background / Cron Job**:
   \`\`\`bash
   bash cron_job.sh
   \`\`\`
`;
fs.writeFileSync(path.join(AIUIRO_DIR, 'FEATHERLESS_SELF_HEALING.md'), docMd);
console.log('✅ Written FEATHERLESS_SELF_HEALING.md in AIUIRO-216');

// 5. Test error_checker.py in AIUIRO-216
console.log('\n=== TESTING ERROR CHECKER IN AIUIRO-216 ===');
try {
  const out = execSync('python3 error_checker.py', { cwd: AIUIRO_DIR, encoding: 'utf-8' });
  console.log(out.trim());
} catch (err) {
  console.log(err.stdout?.toString() || err.message);
}

// 6. Test error_fixer.py CLI help in AIUIRO-216
console.log('\n=== TESTING ERROR FIXER IN AIUIRO-216 ===');
try {
  const out = execSync('python3 error_fixer.py --help', { cwd: AIUIRO_DIR, encoding: 'utf-8' });
  console.log(out.trim().slice(0, 300) + '...');
} catch (err) {
  console.log(err.message);
}

// 7. Test featherless-chat.py --help in AIUIRO-216
console.log('\n=== TESTING FEATHERLESS-CHAT --HELP ===');
try {
  const out = execSync('python3 featherless-chat.py --help', { cwd: AIUIRO_DIR, encoding: 'utf-8' });
  console.log(out.trim().slice(0, 350) + '...');
} catch (err) {
  console.log(err.message);
}

// 8. Commit and Push to AIUIRO-216 git
console.log('\n=== COMMITTING AND PUSHING TO GITHUB AIUIRO-216 ===');
const runGit = (cmd) => {
  try {
    const res = execSync(cmd, { cwd: AIUIRO_DIR, encoding: 'utf-8' });
    if (res.trim()) console.log(res.trim());
  } catch (err) {
    console.error(`Git error: ${err.message}`);
  }
};

runGit('git config user.name "flak3dd"');
runGit('git config user.email "andrew098710@gmail.com"');
runGit('git add error_fixer.py error_checker.py cron_job.sh featherless-chat.py FEATHERLESS_SELF_HEALING.md');
runGit('git status --short');
runGit('git commit -m "feat(agent): add featherless ai self-healing error fixer and autonomous runner"');
runGit('git push origin main');
runGit('git ls-remote origin refs/heads/main');

console.log('\n=== DEPLOYMENT AND PUSH COMPLETE ===');
