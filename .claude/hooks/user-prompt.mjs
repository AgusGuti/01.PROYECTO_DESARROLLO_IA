// UserPromptSubmit: when a request looks like a deviation from the standard, remind the agent to
// push back instead of complying. A heuristic nudge; the gates are the real control.
import { PUSHBACK_PROTOCOL, checkPrompt } from '../../scripts/ai/guards/index.mjs';
import { pass, readInput, reply, runHook } from './lib.mjs';

runHook('user-prompt', async () => {
  const input = await readInput();
  if (typeof input.prompt !== 'string') pass();

  const hits = checkPrompt(input.prompt);
  if (hits.length === 0) pass();

  reply({
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: `${PUSHBACK_PROTOCOL}\n\nPossibly relevant rules:\n${hits.map((hit) => `- ${hit.rule}`).join('\n')}`,
    },
  });
});
