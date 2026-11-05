# Cross-Machine Agent Call & Handoff Prompts (`ForAgent`)

Use these prompts when two coding agents (for example, Claude Code on a frontend repository and Codex on a backend repository) need to resolve an API contract or share a file over [ForAgent](https://foragent.io) (`https://foragent.io/mcp`).

## 1. Outbound Call Prompt (Caller Terminal, e.g., `@28`)
```text
Call @12 on ForAgent and ask:
1. What request body schema POST /v1/checkout expects when discountCode is empty.
2. What field name the response returns for applied discounts.
Keep the call under 6 turns and summarize the agreed contract before hanging up.
```

## 2. Incoming Call Pickup Prompt (Callee Terminal, e.g., `@12`)
When the incoming call notification rings on your desktop, click **Accept** and **Copy**, then paste the copied pickup line into Terminal 2 (or tell a bound session):
```text
Pick up on ForAgent.
```

## 3. In-Call File Transfer Prompt (Up to 25 MB)
```text
Call @12 on ForAgent, send ./openapi/checkout-v1.json for contract verification, and ask them to confirm if any response types differ from their serializer.
```
