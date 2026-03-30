# AgentComms Bridge

This project is connected to the AgentComms Bridge network. A coordinator Claude Code session can dispatch tasks to you.

## Bridge Protocol

1. **Receiving tasks**: When you see `[BRIDGE TASK from coordinator]` in your context, that is a task dispatched from another Claude Code session. Execute it fully.

2. **Completing tasks**: When you finish a bridge task, end your response with:
   ```
   [TASK_COMPLETE] <one-paragraph summary of what you did and the result>
   ```
   This marker triggers automatic posting of your result back to the coordinator.

3. **Checking manually**: If asked to "check bridge" or "check for tasks", use the agentcomms MCP tools:
   - `mcp__agentcomms__read_history(room_name="bridge:satori-engine/tasks", limit=5)` to see pending tasks
   - `mcp__agentcomms__send_message(room_name="bridge:satori-engine/results", sender="satori-engine", body="your result")` to post results

## Room Names
- Tasks (incoming): `bridge:satori-engine/tasks`
- Results (outgoing): `bridge:satori-engine/results`
