// Shared plumbing for the Claude Code hooks. The rules themselves live in scripts/ai/guards.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from '../../scripts/ai/guards/index.mjs';

export const STATE_DIR = join(REPO_ROOT, '.claude', '.state');

/** @returns {Promise<Record<string, unknown>>} the hook input Claude Code sends on stdin */
export async function readInput() {
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  try {
    return raw.trim() ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/** @param {unknown} payload */
export function reply(payload) {
  process.stdout.write(JSON.stringify(payload));
  process.exit(0);
}

/** No opinion: let the normal permission flow continue. */
export function pass() {
  process.exit(0);
}

/**
 * A guard that crashes must not silently disappear, and must not brick the session either:
 * report loudly and let the tool-agnostic gates (lint, tests, git hooks, CI) do their job.
 * @param {string} hook
 * @param {() => Promise<void>} main
 */
export function runHook(hook, main) {
  main().catch((error) => {
    reply({
      systemMessage: `Guard hook "${hook}" crashed and did not run: ${String(error?.message ?? error)}. Fix .claude/hooks/${hook}.mjs. The git hooks and CI still apply.`,
    });
  });
}

/**
 * @param {string} command
 * @param {string[]} args
 * @param {{ timeoutMs?: number, cwd?: string }} [options]
 */
export function run(command, args, { timeoutMs = 60_000, cwd = REPO_ROOT } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    timeout: timeoutMs,
    shell: false,
    windowsHide: true,
  });
  return {
    ok: result.status === 0,
    status: result.status,
    timedOut: result.error?.code === 'ETIMEDOUT',
    missing: result.error?.code === 'ENOENT',
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim(),
  };
}

/** Path to a locally installed CLI entry point, or null if dependencies are not installed. */
export function localBin(...segments) {
  const path = join(REPO_ROOT, 'node_modules', ...segments);
  return existsSync(path) ? path : null;
}

/** @param {string} name @param {unknown} fallback */
export function readState(name, fallback) {
  try {
    return JSON.parse(readFileSync(join(STATE_DIR, name), 'utf8'));
  } catch {
    return fallback;
  }
}

/** @param {string} name @param {unknown} value */
export function writeState(name, value) {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(join(STATE_DIR, name), JSON.stringify(value, null, 2));
}

/** @param {string} text @param {number} max */
export function tail(text, max = 3500) {
  return text.length <= max ? text : `…\n${text.slice(-max)}`;
}

export const EXCEPTION_HINT =
  'Do not work around this guard. Either write the compliant version, or, if Agustín decides the rule should not apply here, use the request-exception skill so he can accept a record in docs/exceptions/.';
