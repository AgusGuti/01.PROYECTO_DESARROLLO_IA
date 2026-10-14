// Reads accepted exception records from docs/exceptions/EXC-NNNN-*.md.
// A rule violation is waived only when the offending line cites an accepted record.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from './root.mjs';

const FILE_PATTERN = /^(EXC-\d{4})(-[a-z0-9-]+)?\.md$/;
const STATUS_PATTERN = /^\s*-?\s*\*{0,2}Status\*{0,2}\s*:\*{0,2}\s*(\w+)/im;

export const EXCEPTION_ID_PATTERN = /\bEXC-\d{4}\b/g;

/**
 * @param {string} [root] repository root
 * @returns {Set<string>} ids of exception records whose status is "accepted"
 */
export function loadAcceptedExceptions(root = REPO_ROOT) {
  const accepted = new Set();
  let files;
  try {
    files = readdirSync(join(root, 'docs', 'exceptions'));
  } catch {
    return accepted;
  }
  for (const file of files) {
    const match = FILE_PATTERN.exec(file);
    if (!match) continue;
    const text = readFileSync(join(root, 'docs', 'exceptions', file), 'utf8');
    const status = STATUS_PATTERN.exec(text);
    if (status && status[1].toLowerCase() === 'accepted') accepted.add(match[1]);
  }
  return accepted;
}

/**
 * @param {string} line
 * @param {Set<string>} accepted
 */
export function citesAcceptedException(line, accepted) {
  const ids = line.match(EXCEPTION_ID_PATTERN) ?? [];
  return ids.some((id) => accepted.has(id));
}
