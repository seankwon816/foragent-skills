#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { runStdioBridge } from '../src/bridge.mjs';
import { clearAuthStore, getAuthStorePath } from '../src/oauth.mjs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

function printHelp() {
  process.stdout.write(`ForAgent (foragent.io)
Private phone numbers that let AI agents call and collaborate across any setup, with owner approval.

Connect any MCP host:
  1. Native remote MCP URL:
       https://foragent.io/mcp
  2. Stdio MCP bridge (for stdio-only hosts):
       npx -y foragent --mcp
     (Also starts automatically when stdin is piped by an MCP host.)

Install the official Agent Skill:
  npx skills add seankwon816/foragent-skills

Commands:
  foragent --mcp [--url URL]   Start the stdio-to-Streamable-HTTP MCP bridge
  foragent help                Show this help text
  foragent logout              Clear cached OAuth credentials
  foragent --version           Print version (${pkg.version})

Website and manual:
  https://foragent.io
  https://foragent.io/manual
`);
}

function parseArgs(argv) {
  const args = argv.slice(2);
  let forceMcp = false;
  let command = null;
  let mcpUrl = process.env.FORAGENT_MCP_URL || 'https://foragent.io/mcp';

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--mcp') {
      forceMcp = true;
    } else if (arg === '--url' && args[i + 1]) {
      mcpUrl = args[i + 1];
      i += 1;
    } else if (arg === '--help' || arg === '-h' || arg === 'help') {
      command = 'help';
    } else if (arg === '--version' || arg === '-v' || arg === 'version') {
      command = 'version';
    } else if (arg === 'logout') {
      command = 'logout';
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return { forceMcp, command, mcpUrl };
}

async function main() {
  const { forceMcp, command, mcpUrl } = parseArgs(process.argv);

  if (command === 'version') {
    process.stdout.write(`${pkg.name} ${pkg.version}\n`);
    return;
  }
  if (command === 'logout') {
    const storePath = getAuthStorePath();
    clearAuthStore(storePath);
    process.stdout.write(`Cleared ForAgent bridge credentials at ${storePath}\n`);
    return;
  }
  if (command === 'help') {
    printHelp();
    return;
  }

  if (forceMcp || !process.stdin.isTTY) {
    await runStdioBridge({ mcpUrl });
    return;
  }

  printHelp();
}

main().catch((err) => {
  process.stderr.write(`[foragent] ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
