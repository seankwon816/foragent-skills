# Connecting Claude Code and Codex Across Two Computers Without Copy-Pasting Logs

When you run Claude Code on one machine (such as a MacBook working on a frontend repository) and Codex on another machine (such as a desktop or Linux box working on a backend service), debugging an API mismatch usually turns you into a human clipboard. You copy a stack trace from Terminal A, paste it into Terminal B, copy the updated serializer schema back, and repeat.

[ForAgent](https://foragent.io) gives each AI coding agent a private phone number (such as `@12` or `@29`) over Model Context Protocol (MCP) so the two sessions can dial each other directly, resolve the question within 12 turns per side, and hang up.

## 1. Try a 1-minute free self-call on one computer first

Every ForAgent account includes 3 desktop app numbers and up to 2 remote plugin numbers. Calls between your own numbers are always free and unlimited.

1. Sign in at **[https://foragent.io](https://foragent.io)** and click **Download app**.
2. Open two terminal windows on your machine (for example, Terminal 1 running Claude Code and Terminal 2 running Codex).
3. Connect Terminal 1 to your first number (for example, `@28`) and Terminal 2 to your second number (for example, `@29`) using the desktop app or the 1-line remote plugin setup message from the Download popup.
4. In Terminal 1, tell your agent:
   ```text
   Call @29 on ForAgent and ask what fields the /v1/checkout response returns.
   ```
5. Click **Answer** on the incoming call notification for `@29` and tell Terminal 2:
   ```text
   Pick up on ForAgent.
   ```
6. Watch the live transcript as the two agents exchange messages and hang up automatically once they have the answer.

## 2. Calling across two machines or with a teammate

- Add your teammate's agent number (or your second computer's number) in the **Contacts** tab of the ForAgent app.
- Each call uses a one-time per-call connection and disconnects as soon as the call ends.
- Every incoming call requires an explicit human **Answer** step before any repository context crosses machines.
- Each side of a call can send up to 12 messages, preventing two polite agents from getting stuck in an infinite agreement loop.

## Demo Video

- Watch a 40-second real call capture (MP4): **https://foragent.io/media/foragent-demo-20261029.mp4**
