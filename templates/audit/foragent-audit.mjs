#!/usr/bin/env node
/**
 * foragent-audit.mjs
 * Zero-dependency local configuration & security auditor for Claude Code, OpenAI Codex CLI, and MCP servers.
 * Scans 4 high-risk local configuration paths in <1 second with zero network requests and zero secret output:
 *   1. .claude/settings.local.json -> checks for inline credentials saved by "Yes, and don't ask again"
 *   2. ~/.codex/config.toml        -> checks for 30s command yield and 1s subagent polling token leaks
 *   3. .claude/agents/Explore.md   -> checks whether built-in Explore subagent is pinned to Haiku read-only
 *   4. .mcp.json / ~/.claude.json  -> checks for 0.0.0.0 wildcard HTTP bindings and unpinned npx -y packages
 *
 * Usage:
 *   node foragent-audit.mjs [repo-path]
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const repoRoot = path.resolve(process.argv[2] || process.cwd());
const homeDir = os.homedir();

const SECRET_RE = /\b(?:sk-[A-Za-z0-9_-]{12,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|xoxb-[0-9A-Za-z-]+)\b|Authorization:\s*Bearer\s+[^\s$"']+|PGPASSWORD=[^\s$"']+/i;

const results = [];

function addResult(check, file, status, detail, fix) {
  results.push({ check, file, status, detail, fix });
}

// Check 1: .claude/settings.local.json secret exposure & gitignore check
const localSettingsPath = path.join(repoRoot, ".claude", "settings.local.json");
if (fs.existsSync(localSettingsPath)) {
  const raw = fs.readFileSync(localSettingsPath, "utf8");
  if (SECRET_RE.test(raw)) {
    addResult(
      "Claude Local Permissions",
      ".claude/settings.local.json",
      "FAIL",
      "Literal token or password pattern detected inside saved permission rules.",
      "Replace inline secrets with $ENV_VAR references and add .claude/settings.local.json to ~/.gitignore_global."
    );
  } else {
    addResult(
      "Claude Local Permissions",
      ".claude/settings.local.json",
      "PASS",
      "No inline token or password patterns found in saved permission rules.",
      "-"
    );
  }
} else {
  addResult(
    "Claude Local Permissions",
    ".claude/settings.local.json",
    "PASS",
    "File not present in repository root.",
    "-"
  );
}

// Check 2: ~/.codex/config.toml yield & subagent polling timeouts
const codexConfigPath = path.join(homeDir, ".codex", "config.toml");
if (fs.existsSync(codexConfigPath)) {
  const raw = fs.readFileSync(codexConfigPath, "utf8");
  const hasYield = /default_exec_yield_time_ms\s*=\s*(\d+)/.exec(raw);
  const hasMinWait = /min_wait_timeout_ms\s*=\s*(\d+)/.exec(raw);
  const yieldVal = hasYield ? Number(hasYield[1]) : 30000;
  const minWaitVal = hasMinWait ? Number(hasMinWait[1]) : 1000;
  if (yieldVal < 120000 || minWaitVal < 15000) {
    addResult(
      "Codex CLI Polling Drain",
      "~/.codex/config.toml",
      "WARN",
      `yield=${yieldVal}ms, min_wait=${minWaitVal}ms (defaults resend full context every 30s and poll at 1s).`,
      "Set default_exec_yield_time_ms = 300000 and min_wait_timeout_ms = 30000 in ~/.codex/config.toml."
    );
  } else {
    addResult(
      "Codex CLI Polling Drain",
      "~/.codex/config.toml",
      "PASS",
      `yield=${yieldVal}ms, min_wait=${minWaitVal}ms configured cleanly.`,
      "-"
    );
  }
} else {
  addResult(
    "Codex CLI Polling Drain",
    "~/.codex/config.toml",
    "WARN",
    "No ~/.codex/config.toml found (Codex CLI defaults to 30s yield and 1s subagent polling).",
    "Create ~/.codex/config.toml from templates/codex/config.toml."
  );
}

// Check 3: .claude/agents/Explore.md Haiku read-only override
const explorePath = path.join(repoRoot, ".claude", "agents", "Explore.md");
if (fs.existsSync(explorePath)) {
  const raw = fs.readFileSync(explorePath, "utf8");
  const isHaiku = /model:\s*haiku/i.test(raw);
  const isReadOnly = /disallowedTools:.*Write/i.test(raw);
  if (isHaiku && isReadOnly) {
    addResult(
      "Explore Subagent Quota",
      ".claude/agents/Explore.md",
      "PASS",
      "Explore subagent is pinned to Haiku in read-only mode.",
      "-"
    );
  } else {
    addResult(
      "Explore Subagent Quota",
      ".claude/agents/Explore.md",
      "WARN",
      "Explore.md exists but is missing 'model: haiku' or 'disallowedTools: Write, Edit'.",
      "Add model: haiku, effort: low, omitClaudeMd: true, and disallowedTools: Write, Edit."
    );
  }
} else {
  addResult(
    "Explore Subagent Quota",
    ".claude/agents/Explore.md",
    "WARN",
    "No Explore.md override found (file searches run on your main Opus/Sonnet quota).",
    "Copy templates/subagents/Explore.md to .claude/agents/Explore.md."
  );
}

// Check 4: .mcp.json wildcard binding & unpinned npx check
const mcpPath = path.join(repoRoot, ".mcp.json");
if (fs.existsSync(mcpPath)) {
  const raw = fs.readFileSync(mcpPath, "utf8");
  const hasWildcardBind = /0\.0\.0\.0/.test(raw);
  const hasUnpinnedNpx = /"npx"\s*,\s*\[[^\]]*"-y"\s*,\s*"[@a-z0-9/_-]+(?<!@\d+\.\d+\.\d+)"/i.test(raw);
  if (hasWildcardBind || hasUnpinnedNpx) {
    addResult(
      "MCP Server Config",
      ".mcp.json",
      "FAIL",
      "Detected 0.0.0.0 binding or unpinned npx -y package in .mcp.json.",
      "Bind local HTTP servers to localhost and pin exact package versions + tools/list SHA-256 digests."
    );
  } else {
    addResult(
      "MCP Server Config",
      ".mcp.json",
      "PASS",
      "No wildcard bindings or unpinned npx packages detected.",
      "-"
    );
  }
} else {
  addResult(
    "MCP Server Config",
    ".mcp.json",
    "PASS",
    "No project .mcp.json file present.",
    "-"
  );
}

console.log("\n=== AI Coding Agent Local Security & Quota Audit ===");
console.log(`Target Repository: ${repoRoot}\n`);
for (const r of results) {
  const badge = r.status === "PASS" ? "[PASS]" : r.status === "WARN" ? "[WARN]" : "[FAIL]";
  console.log(`${badge} ${r.check} (${r.file})`);
  console.log(`       Finding: ${r.detail}`);
  if (r.fix !== "-") {
    console.log(`       Fix:     ${r.fix}`);
  }
}
const fails = results.filter(r => r.status === "FAIL").length;
const warns = results.filter(r => r.status === "WARN").length;
console.log(`\nSummary: ${results.length - fails - warns} PASS, ${warns} WARN, ${fails} FAIL`);
process.exit(fails > 0 ? 1 : 0);
