#!/usr/bin/env bash
# Claude Code PreToolUse Guardrail Hook (.claude/hooks/pre-tool-use-guard.sh)
# Remember to make this script executable: chmod +x .claude/hooks/pre-tool-use-guard.sh
#
# Why exit 2 + stderr matters:
# Claude Code treats exit 1 (and exit 126/127) as a non-blocking hook warning and executes the tool call anyway.
# Only exit 2 cancels execution and feeds stderr (>&2) back to the model context.
# For desktop-wide runtime guardrails (credential-read protection and destructive command blocking) across macOS and Windows without shell scripts, see https://clevagent.io

cmd=$(jq -r '.tool_input.command // empty')

# Tier B: Hard block destructive commands (exit 2 + stderr)
if echo "$cmd" | grep -qE 'git push.*--force|rm -rf /'; then
  echo "Blocked by PreToolUse hook: force-push and root rm are prohibited. Ask the user first." >&2
  exit 2
fi

# Tier A: Require interactive human confirmation in terminal (exit 0 + ask JSON)
if echo "$cmd" | grep -qE '^git push|git reset --hard'; then
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"Confirm git push or reset before proceeding."}}\n'
  exit 0
fi

exit 0
