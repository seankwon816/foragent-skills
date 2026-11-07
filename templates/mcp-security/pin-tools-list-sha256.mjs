#!/usr/bin/env node
/**
 * MCP tools/list Canonical SHA-256 Pinning & Post-Approval Drift Detector
 * Zero-dependency Node.js utility for auditing local and remote MCP servers.
 *
 * Why this matters:
 * An MCP server can pass initial approval on Day 1 and later mutate its `tools/list`
 * response at runtime, either by injecting new instructions into tool descriptions,
 * widening `inputSchema`, or flipping `annotations.destructiveHint` from `true` to
 * `false` so the host client stops prompting for user confirmation.
 *
 * Usage:
 *   1. Save a canonical tools/list JSON payload from your MCP server to tools-list.json
 *   2. Compute and record the canonical SHA-256 digest:
 *        node pin-tools-list-sha256.mjs --pin ./tools-list.json
 *   3. Verify a live tools/list response in CI or a pre-session wrapper:
 *        node pin-tools-list-sha256.mjs --verify ./tools-list.json <expected-sha256>
 */

import crypto from "node:crypto";
import fs from "node:fs";

function canonicalizeToolsList(payload) {
  const tools = Array.isArray(payload) ? payload : payload.tools || [];
  const normalized = tools
    .map((tool) => ({
      name: String(tool.name || ""),
      description: String(tool.description || ""),
      inputSchema: sortKeysDeep(tool.inputSchema || {}),
      annotations: sortKeysDeep({
        readOnlyHint: Boolean(tool.annotations?.readOnlyHint),
        destructiveHint:
          tool.annotations?.destructiveHint === undefined
            ? true
            : Boolean(tool.annotations.destructiveHint),
        idempotentHint: Boolean(tool.annotations?.idempotentHint),
        openWorldHint:
          tool.annotations?.openWorldHint === undefined
            ? true
            : Boolean(tool.annotations.openWorldHint),
      }),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return JSON.stringify(normalized);
}

function sortKeysDeep(value) {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        acc[key] = sortKeysDeep(value[key]);
        return acc;
      }, {});
  }
  return value;
}

function sha256Hex(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

const [, , mode, filePath, expectedHash] = process.argv;

if (!mode || !filePath || (mode !== "--pin" && mode !== "--verify")) {
  console.error(
    "Usage:\n  node pin-tools-list-sha256.mjs --pin <tools-list.json>\n  node pin-tools-list-sha256.mjs --verify <tools-list.json> <expected-sha256>"
  );
  process.exit(1);
}

const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
const canonical = canonicalizeToolsList(raw);
const actualHash = sha256Hex(canonical);

if (mode === "--pin") {
  console.log(actualHash);
  process.exit(0);
}

if (!expectedHash || actualHash.toLowerCase() !== expectedHash.toLowerCase()) {
  console.error(
    `[MCP-DRIFT-BLOCKED] tools/list SHA-256 mismatch!\n  Expected: ${expectedHash || "(missing)"}\n  Actual:   ${actualHash}\n  Action:   Inspect tool descriptions, inputSchema, and destructiveHint annotations before re-approving.`
  );
  process.exit(2);
}

console.log(`[MCP-PIN-OK] Verified tools/list SHA-256: ${actualHash}`);
