// Content rules: patterns that must not appear in source files.
// Each rule cites the section of docs/standards/mean-engineering-standard.md it enforces.
// These are fast, line-based checks. ESLint, tsc and dependency-cruiser remain the
// precise authority; these rules exist to stop a violation before it is written.
import { citesAcceptedException } from './exceptions.mjs';

const TS = /\.(ts|mts|cts)$/;
const TS_OR_JS = /\.(ts|mts|cts|js|mjs|cjs)$/;
const PY = /\.py$/;
const SPEC = /\.(spec|test)\.(ts|mts|js|mjs)$|(^|\/)tests?\/.*\.py$|(^|\/)test_[^/]*\.py$/;
const API_SRC = /^apps\/api\/src\//;
const WEB_SRC = /^apps\/web\/src\//;
const ASSISTANT = /^apps\/assistant\//;

/**
 * @typedef {object} Rule
 * @property {string} id
 * @property {string} section standard section
 * @property {RegExp} pattern tested against each line
 * @property {(path: string) => boolean} appliesTo
 * @property {string} message what is wrong and what to do instead
 * @property {boolean} [waivable] false = cannot be waived by an exception record
 */

/** @type {Rule[]} */
export const CONTENT_RULES = [
  {
    id: 'no-explicit-any',
    section: '§3, §5.1',
    pattern: /(:\s*any\b|\bas\s+any\b|<any>|\bany\[\]|Array<any>|Record<[^>]*,\s*any>)/,
    appliesTo: (p) => TS.test(p) && !p.endsWith('.d.ts'),
    message:
      '`any` switches the type checker off. Use a concrete type, or `unknown` at a trust boundary and narrow it with a Zod schema.',
  },
  {
    id: 'no-double-cast',
    section: '§5.1',
    pattern: /\bas\s+unknown\s+as\b/,
    appliesTo: (p) => TS.test(p),
    message:
      'A double cast (`as unknown as X`) hides a type error. Fix the types or validate the value at runtime.',
  },
  {
    id: 'no-ts-ignore',
    section: '§5.1',
    pattern: /@ts-ignore|@ts-nocheck/,
    appliesTo: (p) => TS_OR_JS.test(p),
    message:
      '`@ts-ignore` / `@ts-nocheck` silence errors forever. Fix the cause. If it is truly unavoidable use `@ts-expect-error` with an EXC id.',
    waivable: false,
  },
  {
    id: 'suppression-needs-exception',
    section: '§0.2, §5.1',
    pattern: /eslint-disable|@ts-expect-error|#\s*type:\s*ignore|#\s*noqa\b|#\s*nosec\b/,
    appliesTo: (p) => TS_OR_JS.test(p) || PY.test(p) || p.endsWith('.html'),
    message:
      'A lint/type suppression is an exception to a mandatory rule. It must cite an accepted record, e.g. `// EXC-0003`. Use the request-exception skill.',
  },
  {
    id: 'env-only-in-config',
    section: '§6.5',
    pattern: /\bprocess\.env\b/,
    appliesTo: (p) => API_SRC.test(p) && !p.startsWith('apps/api/src/config/'),
    message:
      'Read configuration from the validated `config` object (apps/api/src/config/env.ts), never from `process.env` directly.',
  },
  {
    id: 'domain-is-framework-free',
    section: '§1.1, §3 (D)',
    pattern: /from\s+['"](express|mongoose|mongodb)(\/[^'"]*)?['"]/,
    appliesTo: (p) => /\.domain\.ts$/.test(p),
    message:
      'Domain code must not depend on Express, Mongoose or MongoDB. Keep rules pure; persistence belongs in the repository.',
  },
  {
    id: 'service-is-http-and-orm-free',
    section: '§1.1, §6.2',
    pattern: /from\s+['"](express|mongoose|mongodb)(\/[^'"]*)?['"]/,
    appliesTo: (p) => /\.service\.ts$/.test(p),
    message:
      'Application services must not import Express or Mongoose. Take plain inputs, depend on a repository interface.',
  },
  {
    id: 'controller-has-no-persistence',
    section: '§6.2',
    pattern:
      /from\s+['"](mongoose|mongodb)(\/[^'"]*)?['"]|from\s+['"][^'"]*\.repository(\.js)?['"]/,
    appliesTo: (p) => /\.(controller|routes)\.ts$/.test(p),
    message:
      'Controllers and routes translate HTTP only. Call the service; do not query MongoDB or import a repository here.',
  },
  {
    id: 'no-mass-assignment',
    section: '§8.2',
    pattern:
      /(\bnew\s+\w+\s*\(|\.(create|insertOne|insertMany|updateOne|updateMany|replaceOne|findOneAndUpdate|findByIdAndUpdate|find|findOne|deleteMany|deleteOne)\s*\(|Object\.assign\s*\()[^;]*\breq\.(body|query|params)\b/,
    appliesTo: (p) => API_SRC.test(p),
    message:
      'Never pass `req.body`/`req.query`/`req.params` into a model or query. Parse it with a Zod schema and build the document from named, validated fields.',
  },
  {
    id: 'no-unsafe-mongo-operators',
    section: '§4.5, §8.2',
    pattern: /['"`]?\$(where|function|accumulator)['"`]?\s*:|\.mapReduce\s*\(/,
    appliesTo: (p) => TS_OR_JS.test(p),
    message:
      '`$where`, `$function`, `$accumulator` and mapReduce run JavaScript inside MongoDB and enable injection. Use typed query operators.',
    waivable: false,
  },
  {
    id: 'no-dynamic-code',
    section: '§8.2',
    pattern: /(^|[^.\w])eval\s*\(|\bnew\s+Function\s*\(/,
    appliesTo: (p) => TS_OR_JS.test(p),
    message: '`eval` and `new Function` execute arbitrary code. There is always a safer design.',
    waivable: false,
  },
  {
    id: 'no-focused-or-skipped-tests',
    section: '§10.3',
    pattern: /\b(describe|it|test)\.(only|skip)\s*\(|\b[xf](it|describe)\s*\(|@pytest\.mark\.skip/,
    appliesTo: (p) => SPEC.test(p),
    message:
      'Focused (`.only`) or skipped tests hide failures. Fix the test or the code; never disable a test to get a green run.',
  },
  {
    id: 'no-sanitizer-bypass',
    section: '§9.4',
    pattern: /bypassSecurityTrust(Html|Script|Style|Url|ResourceUrl)/,
    appliesTo: (p) => WEB_SRC.test(p),
    message:
      'Angular sanitizes values to prevent XSS. Bypassing it needs a reviewed, documented exception with a validated source.',
  },
  {
    id: 'no-raw-dom-html',
    section: '§8.2, §9.4',
    pattern: /\.(innerHTML|outerHTML)\s*=|\.insertAdjacentHTML\s*\(|document\.write\s*\(/,
    appliesTo: (p) => WEB_SRC.test(p),
    message:
      'Writing HTML straight into the DOM skips Angular sanitization. Use template bindings instead.',
  },
  {
    id: 'no-credentials-in-web-storage',
    section: '§8.1',
    pattern:
      /(localStorage|sessionStorage)\.setItem\s*\([^)]*(token|jwt|secret|password|credential)/i,
    appliesTo: (p) => WEB_SRC.test(p),
    message:
      'Credentials in web storage are readable by any injected script. Decide the session mechanism with the architect agent first.',
  },
  {
    id: 'assistant-never-touches-mongo',
    section: 'ADR-0004',
    pattern: /^\s*(import|from)\s+(pymongo|motor|mongoengine|beanie)\b/,
    appliesTo: (p) => ASSISTANT.test(p) && PY.test(p),
    message:
      'The assistant reaches data only through the Express API, so every request passes the same validation and rules. No MongoDB drivers here.',
    waivable: false,
  },
  {
    id: 'assistant-env-only-in-config',
    section: '§6.5',
    pattern: /\bos\.(environ|getenv)\b/,
    appliesTo: (p) => ASSISTANT.test(p) && PY.test(p) && !p.endsWith('/config.py'),
    message: 'Read settings from `assistant.config.Settings`, not from `os.environ`.',
  },
  {
    id: 'no-tls-verification-off',
    section: '§8.3',
    pattern: /verify\s*=\s*False|rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED/,
    appliesTo: (p) => TS_OR_JS.test(p) || PY.test(p),
    message: 'Disabling TLS certificate verification exposes traffic to interception.',
    waivable: false,
  },
];

/** @type {{ id: string, pattern: RegExp, message: string }[]} */
export const SECRET_RULES = [
  {
    id: 'secret-private-key',
    pattern: /-----BEGIN (RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/,
    message: 'Private key material.',
  },
  { id: 'secret-aws-key', pattern: /\bAKIA[0-9A-Z]{16}\b/, message: 'AWS access key id.' },
  {
    id: 'secret-token',
    pattern:
      /\b(ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{60,}|sk-[A-Za-z0-9_-]{32,}|xox[baprs]-[A-Za-z0-9-]{10,})\b/,
    message: 'Provider access token.',
  },
  {
    id: 'secret-uri-credentials',
    pattern: /\b(mongodb(\+srv)?|postgres(ql)?|mysql|redis|amqp):\/\/[^\s:/@'"]+:[^\s@'"]{3,}@/,
    message: 'Connection string with an embedded password.',
  },
  {
    id: 'secret-assignment',
    pattern:
      /\b(api[_-]?key|secret|passwd|password|private[_-]?key|access[_-]?token|auth[_-]?token)\b['"]?\s*[:=]\s*['"][A-Za-z0-9+/_=-]{20,}['"]/i,
    message: 'Hard-coded credential.',
  },
];

const COMMENT_ONLY = /^\s*(\/\/|\*|\/\*|<!--)/;
// The guard rails and their documentation necessarily contain the banned patterns as data.
// Secret rules still apply to these paths.
const CONTENT_EXEMPT = /^(scripts\/ai\/|\.claude\/|\.opencode\/|docs\/)/;

/**
 * @param {object} input
 * @param {string} input.path repo-relative path with forward slashes
 * @param {string} input.content text to check (a whole file or the fragment being written)
 * @param {Set<string>} [input.accepted] accepted exception ids
 * @returns {{ rule: string, section: string, line: number, excerpt: string, message: string }[]}
 */
export function checkContent({ path, content, accepted = new Set() }) {
  const violations = [];
  const rules = CONTENT_EXEMPT.test(path)
    ? []
    : CONTENT_RULES.filter((rule) => rule.appliesTo(path));
  const lines = content.split(/\r?\n/);

  lines.forEach((line, index) => {
    const report = (rule, section, message) =>
      violations.push({
        rule,
        section,
        line: index + 1,
        excerpt: line.trim().slice(0, 140),
        message,
      });

    for (const secret of SECRET_RULES) {
      if (secret.pattern.test(line)) {
        report(
          secret.id,
          '§6.5, §8.4',
          `${secret.message} Secrets never go in source control; put them in .env and read them through the config module.`,
        );
      }
    }

    for (const rule of rules) {
      if (!rule.pattern.test(line)) continue;
      // Prose in a comment may mention a banned construct; suppression markers are the exception
      // because they only ever appear in comments.
      const isSuppression = rule.id === 'suppression-needs-exception' || rule.id === 'no-ts-ignore';
      if (COMMENT_ONLY.test(line) && !isSuppression) continue;
      if (rule.waivable !== false && citesAcceptedException(line, accepted)) continue;
      report(rule.id, rule.section, rule.message);
    }
  });

  return violations;
}
