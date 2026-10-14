// Prompt rules: detect a request to deviate from the standard (English and Spanish).
// This is a heuristic nudge, not a control. The real controls are the gates and the other guards.

const DEVIATIONS = [
  {
    id: 'skip-tests',
    pattern:
      /\b(skip|without|no|drop|omit|forget|ignore)\s+(the\s+|any\s+)?(unit\s+|integration\s+)?tests?\b|\b(sin|saltea\w*|omit\w*|olvid\w*|ignor\w*|despu[eé]s\s+(hacemos|vemos)\s+los)\s+(los\s+|las\s+)?(tests?|pruebas)\b|tests?\s+(later|after|despu[eé]s|m[aá]s\s+tarde)/i,
    rule: 'Every use case needs tests for success, invalid input and failure paths (§10.2).',
  },
  {
    id: 'disable-gates',
    pattern:
      /\b(disable|turn\s+off|bypass|skip|ignore|remove|desactiv\w*|deshabilit\w*|sac[aáo]\w*|quit[aáo]\w*|salte[aáo]\w*)(?![a-z]).{0,30}\b(lint\w*|eslint|type\s?-?check\w*|strict|hooks?|husky|ci|pipeline|guard\w*|validaci[oó]n|validation|verify)\b|--no-verify/i,
    rule: 'Quality gates are fixed, not bypassed (§10.3, §10.4).',
  },
  {
    id: 'use-any',
    pattern: /\b(use|usa\w*|pon\w*|put|cast)\b.{0,20}\bany\b|@ts-ignore|ts-nocheck/i,
    rule: '`any` and `@ts-ignore` are not allowed (§5.1).',
  },
  {
    id: 'just-make-it-work',
    pattern:
      /\b(just|only)\s+(make\s+it\s+work|get\s+it\s+working|hack|ship\s+it)\b|quick\s+(and\s+dirty|hack|fix)|\b(hac[eé]lo|hazlo|que)\s+(ande|funcione)\s+(y\s+listo|como\s+sea|nom[aá]s)\b|as[ií]\s+nom[aá]s|a\s+las\s+apuradas|r[aá]pido\s+y\s+sucio/i,
    rule: 'Smallest change that still preserves security, integrity and maintainability (§0.1).',
  },
  {
    id: 'skip-validation-or-auth',
    pattern:
      /\b(skip|without|no|remove|sin|sac[aáo]\w*|quit[aáo]\w*)(?![a-z]).{0,25}\b(validat\w*|validaci[oó]n|sanitiz\w*|authori[sz]ation|autorizaci[oó]n|rate\s?limit\w*)\b|trust\s+the\s+(client|frontend)|conf[ií]a\w*\s+en\s+el\s+(cliente|frontend)/i,
    rule: 'Validate at every trust boundary; the server is the authority (§5.2, §8.1, §8.2).',
  },
  {
    id: 'logic-in-wrong-layer',
    pattern:
      /\b(put|pon\w*|met[eé]\w*|write|escrib\w*)\b.{0,40}\b(logic|l[oó]gica|query|consulta)\b.{0,30}\b(controller|controlador|component\w*)\b|directly\s+(in|from)\s+the\s+(controller|component)|direct\w*\s+(en|desde)\s+el\s+(controlador|componente)/i,
    rule: 'Business rules live in services and the domain, not in controllers or components (§1.1).',
  },
  {
    id: 'commit-secrets-or-main',
    pattern:
      /\b(commit|push|sub[ií]\w*)\b.{0,30}\b(\.env|secret\w*|password|contrase[nñ]a|directly\s+to\s+main|direct\w*\s+a\s+main)\b|\bforce\s+push\b/i,
    rule: 'Secrets stay out of git; main changes only through pull requests (§6.5, §12.1).',
  },
  {
    id: 'unjustified-architecture',
    pattern: /\b(microservic\w+|event\s+sourcing|cqrs|ngrx|redis|kafka|graphql|rabbitmq)\b/i,
    rule: 'New platforms and patterns need a demonstrated need and an ADR (§1.2, §2.2).',
  },
];

export const PUSHBACK_PROTOCOL = `The request above may conflict with the engineering standard. Apply the pushback protocol before doing anything:
1. Name the rule and its section in docs/standards/mean-engineering-standard.md.
2. Explain, in plain language for someone new to this stack, the concrete problem it would cause.
3. Offer the compliant way to reach the same goal, and estimate its extra cost honestly.
4. Do not comply silently and do not weaken a gate. If Agustín still wants to deviate, the only path is the request-exception skill, which writes docs/exceptions/EXC-NNNN for him to accept.
If, after reading it properly, the request does not actually conflict with the standard, say so in one line and continue.`;

/**
 * @param {string} prompt
 * @returns {{ id: string, rule: string }[]}
 */
export function checkPrompt(prompt) {
  return DEVIATIONS.filter((item) => item.pattern.test(prompt)).map(({ id, rule }) => ({
    id,
    rule,
  }));
}
