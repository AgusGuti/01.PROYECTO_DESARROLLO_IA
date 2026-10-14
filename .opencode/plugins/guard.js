// OpenCode side of the agent guards. It applies the same rules as the Claude Code hooks by
// calling the shared functions in scripts/ai/guards, so the two tools cannot drift apart.
//
// A plugin cannot ask the user a question, so it only enforces hard denials. Decisions that need
// approval ("ask") are expressed as permissions in opencode.json.
import {
  checkCommand,
  checkContent,
  checkPath,
  formatViolations,
  gitState,
  loadAcceptedExceptions,
  toRepoPath,
} from '../../scripts/ai/guards/index.mjs';

const HINT =
  'Do not work around this guard. Write the compliant version, or use the request-exception ' +
  'skill so Agustín can accept a record in docs/exceptions/.';

/** Splits an apply_patch payload into the lines it adds, per file. */
function addedLinesByFile(patchText) {
  const files = new Map();
  let current = null;
  for (const line of patchText.split(/\r?\n/)) {
    const header = /^\*\*\* (?:Add|Update) File: (.+)$/.exec(line);
    if (header) {
      current = header[1].trim();
      files.set(current, []);
    } else if (current && line.startsWith('+')) {
      files.get(current).push(line.slice(1));
    }
  }
  return files;
}

/** @returns {{ path: string, content: string }[]} the writes a tool call is about to make */
function proposedWrites(tool, args) {
  if (typeof args.patchText === 'string') {
    return [...addedLinesByFile(args.patchText)].map(([path, lines]) => ({
      path,
      content: lines.join('\n'),
    }));
  }
  const path = args.filePath ?? args.file_path ?? args.path;
  if (typeof path !== 'string') return [];
  const parts = [args.content, args.newString, args.new_string];
  if (Array.isArray(args.edits)) {
    parts.push(...args.edits.map((edit) => edit?.newString ?? edit?.new_string));
  }
  return [{ path, content: parts.filter((part) => typeof part === 'string').join('\n') }];
}

function checkWrite({ path, content }) {
  const repoPath = toRepoPath(path);
  if (repoPath === null) return;

  const pathResult = checkPath(repoPath);
  if (pathResult.decision === 'deny') {
    throw new Error(`Blocked write to ${repoPath}. ${pathResult.message}`);
  }
  const violations = checkContent({
    path: repoPath,
    content,
    accepted: loadAcceptedExceptions(),
  });
  if (violations.length > 0) {
    throw new Error(
      `Blocked: this edit to ${repoPath} breaks the engineering standard.\n${formatViolations(violations)}\n\n${HINT}`,
    );
  }
}

export const StandardGuard = async () => ({
  'tool.execute.before': async (input, output) => {
    const args = output?.args ?? {};

    if (input.tool === 'bash' && typeof args.command === 'string') {
      const result = checkCommand({ command: args.command, ...gitState() });
      if (result.decision === 'deny') {
        throw new Error(`Blocked command.\n${formatViolations(result.violations)}\n\n${HINT}`);
      }
      return;
    }

    if (['write', 'edit', 'multiedit', 'patch', 'apply_patch'].includes(input.tool)) {
      for (const write of proposedWrites(input.tool, args)) checkWrite(write);
    }
  },
});
