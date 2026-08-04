/**
 * Renders `docs/openapi.json` and `docs/openapi.yaml`.
 *
 *   npm run openapi
 *
 * Generated from `config/apiBlueprint.ts` + `config/openapiSchemas.ts`, for the
 * same reason the markdown reference is: a spec that disagrees with the server
 * is worse than no spec, because a generated client compiles against the lie.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { buildOpenApiDocument, danglingRefs } from '../config/openapi.js';
import { resolveBlueprint } from '../config/apiBlueprint.js';

/**
 * Minimal deterministic YAML emitter for plain JSON data.
 *
 * Hand-rolled because the build sandbox cannot install `yaml`, and because the
 * input is known to be plain data — no anchors, no cycles, no dates. Quotes
 * anything that could otherwise be reinterpreted as a bool, null or number.
 */
function toYaml(value: unknown, indent = 0): string {
  const pad = '  '.repeat(indent);

  if (value === null) return 'null';
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);

  if (typeof value === 'string') {
    if (value === '') return "''";
    if (value.includes('\n')) {
      const lines = value.split('\n').map((l) => (l ? `${pad}  ${l}` : ''));
      return `|-\n${lines.join('\n')}`;
    }
    const needsQuote =
      /^[\s>|@`%&*!?{}[\],#-]/.test(value) ||
      /[:#]\s/.test(value) ||
      /\s$/.test(value) ||
      /^(true|false|null|yes|no|on|off|~)$/i.test(value) ||
      /^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(value);
    return needsQuote ? `'${value.replace(/'/g, "''")}'` : value;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    return value
      .map((item) => {
        const rendered = toYaml(item, indent + 1);
        if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
          // Object entries hang off the dash on the same line.
          return `${pad}- ${rendered.slice((indent + 1) * 2)}`;
        }
        return `${pad}- ${rendered}`;
      })
      .join('\n');
  }

  const entries = Object.entries(value as Record<string, unknown>).filter(
    ([, v]) => v !== undefined,
  );
  if (entries.length === 0) return '{}';

  return entries
    .map(([key, v]) => {
      const k = /^[A-Za-z_][A-Za-z0-9_.-]*$/.test(key) ? key : `'${key.replace(/'/g, "''")}'`;
      if (v === null || typeof v !== 'object') return `${pad}${k}: ${toYaml(v, indent)}`;
      if (Array.isArray(v)) {
        return v.length === 0 ? `${pad}${k}: []` : `${pad}${k}:\n${toYaml(v, indent + 1)}`;
      }
      const nested = toYaml(v, indent + 1);
      return nested === '{}' ? `${pad}${k}: {}` : `${pad}${k}:\n${nested}`;
    })
    .join('\n');
}

const doc = buildOpenApiDocument();
const dangling = danglingRefs(doc);

const jsonOut = resolve(process.cwd(), 'docs/openapi.json');
const yamlOut = resolve(process.cwd(), 'docs/openapi.yaml');
mkdirSync(dirname(jsonOut), { recursive: true });

writeFileSync(jsonOut, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
writeFileSync(yamlOut, `${toYaml(doc)}\n`, 'utf8');

const pathMap = (doc.paths ?? {}) as Record<string, unknown>;
const components = (doc.components ?? {}) as { schemas?: Record<string, unknown> };
const paths = Object.keys(pathMap).length;
const operations = resolveBlueprint().length;
const schemas = Object.keys(components.schemas ?? {}).length;

console.log(`Wrote ${jsonOut}`);
console.log(`Wrote ${yamlOut}`);
console.log(`  OpenAPI ${String(doc.openapi)} — ${paths} paths, ${operations} operations, ${schemas} schemas`);
console.log(`  dangling $refs: ${dangling.length}`);

if (dangling.length > 0) {
  for (const r of dangling) console.log(`    ! ${r}`);
  process.exit(1);
}
