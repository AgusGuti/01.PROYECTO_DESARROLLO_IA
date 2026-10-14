// PreToolUse (Write | Edit | MultiEdit | NotebookEdit): block a non-compliant edit before it lands.
import {
  checkContent,
  checkPath,
  formatViolations,
  loadAcceptedExceptions,
  toRepoPath,
} from '../../scripts/ai/guards/index.mjs';
import { EXCEPTION_HINT, pass, readInput, reply, runHook } from './lib.mjs';

/** @param {'deny' | 'ask'} permissionDecision @param {string} permissionDecisionReason */
const decide = (permissionDecision, permissionDecisionReason) =>
  reply({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision,
      permissionDecisionReason,
    },
  });

/** The text this tool call is about to write. */
function proposedText(toolInput) {
  const parts = [toolInput.content, toolInput.new_string, toolInput.new_source];
  if (Array.isArray(toolInput.edits))
    parts.push(...toolInput.edits.map((edit) => edit?.new_string));
  return parts.filter((part) => typeof part === 'string').join('\n');
}

runHook('pre-edit', async () => {
  const input = await readInput();
  const toolInput = input.tool_input ?? {};
  const filePath = toolInput.file_path ?? toolInput.notebook_path;
  if (typeof filePath !== 'string') pass();

  const path = toRepoPath(filePath);
  if (path === null) pass(); // outside this repository: not ours to judge

  const pathResult = checkPath(path);
  if (pathResult.decision === 'deny') {
    decide('deny', `Blocked write to ${path}.\n${pathResult.message}`);
  }

  const violations = checkContent({
    path,
    content: proposedText(toolInput),
    accepted: loadAcceptedExceptions(),
  });
  if (violations.length > 0) {
    decide(
      'deny',
      `Blocked: this edit to ${path} breaks the engineering standard.\n${formatViolations(violations)}\n\n${EXCEPTION_HINT}`,
    );
  }

  if (pathResult.decision === 'ask') {
    decide('ask', `${path}: ${pathResult.message}`);
  }
  pass();
});
