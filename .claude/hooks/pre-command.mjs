// PreToolUse (Bash | PowerShell): block commands that bypass gates, destroy data or break self-containment.
import { checkCommand, formatViolations, gitState } from '../../scripts/ai/guards/index.mjs';
import { EXCEPTION_HINT, pass, readInput, reply, runHook } from './lib.mjs';

runHook('pre-command', async () => {
  const input = await readInput();
  const command = input.tool_input?.command;
  if (typeof command !== 'string' || command.trim() === '') pass();

  const result = checkCommand({ command, ...gitState() });
  if (result.decision === 'allow') pass();

  const details = formatViolations(result.violations);
  reply({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: result.decision,
      permissionDecisionReason:
        result.decision === 'deny'
          ? `Blocked command.\n${details}\n\n${EXCEPTION_HINT}`
          : `Needs Agustín's approval.\n${details}`,
    },
  });
});
