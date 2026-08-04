import type { Router } from 'express';
import { API_BLUEPRINT, type HttpMethod } from '../config/apiBlueprint.js';
import { logger } from '../config/logger.js';

/**
 * Drift detector.
 *
 * `config/apiBlueprint.ts` is a *declaration*; the routers are the truth. This
 * walks what Express actually mounted and diffs it against the declaration, so a
 * route added without a blueprint entry (or a blueprint entry whose route was
 * renamed) surfaces on the next `npm run dev` rather than in a frontend bug
 * report three weeks later.
 *
 * Non-fatal by design: Express's `router.stack` is internal, and a quirk in how
 * it exposes a layer should never stop the API from booting. The hard assertions
 * live in `npm run verify`, which asserts against the declaration directly.
 */

interface MountedRoute {
  method: HttpMethod;
  path: string;
}

interface LayerLike {
  route?: {
    path?: unknown;
    methods?: Record<string, boolean>;
  };
}

function joinPath(prefix: string, routePath: string): string {
  const base = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
  if (routePath === '/' || routePath === '') return base || '/';
  return `${base}${routePath.startsWith('/') ? '' : '/'}${routePath}`;
}

/** Read one router's own layers. Nested routers are walked by the caller. */
function collect(prefix: string, router: Router): MountedRoute[] {
  const stack = (router as unknown as { stack?: LayerLike[] }).stack;
  if (!Array.isArray(stack)) return [];

  const found: MountedRoute[] = [];
  for (const layer of stack) {
    const route = layer.route;
    if (!route || typeof route.path !== 'string' || !route.methods) continue;
    for (const [method, enabled] of Object.entries(route.methods)) {
      if (!enabled || method === '_all') continue;
      found.push({
        method: method.toUpperCase() as HttpMethod,
        path: joinPath(prefix, route.path),
      });
    }
  }
  return found;
}

export interface BlueprintDiff {
  mounted: number;
  declared: number;
  /** Declared in the blueprint but not mounted by any router. */
  missing: string[];
  /** Mounted but absent from the blueprint. */
  undeclared: string[];
}

export function diffBlueprint(
  mounts: { path: string; router: Router }[],
  extra: MountedRoute[] = [],
): BlueprintDiff {
  const mounted = new Set<string>();
  for (const { path, router } of mounts) {
    for (const r of collect(`/${path}`, router)) mounted.add(`${r.method} ${r.path}`);
  }
  for (const r of extra) mounted.add(`${r.method} ${r.path}`);

  const declared = new Set(API_BLUEPRINT.map((e) => `${e.method} ${e.path}`));

  return {
    mounted: mounted.size,
    declared: declared.size,
    missing: [...declared].filter((k) => !mounted.has(k)).sort(),
    undeclared: [...mounted].filter((k) => !declared.has(k)).sort(),
  };
}

export function assertBlueprintMatchesRouters(
  mounts: { path: string; router: Router }[],
  extra: MountedRoute[] = [],
): BlueprintDiff {
  let diff: BlueprintDiff;
  try {
    diff = diffBlueprint(mounts, extra);
  } catch (err) {
    logger.warn('Blueprint drift check could not run', { error: String(err) });
    return { mounted: 0, declared: API_BLUEPRINT.length, missing: [], undeclared: [] };
  }

  if (diff.missing.length === 0 && diff.undeclared.length === 0) {
    logger.info('API blueprint matches mounted routes', { routes: diff.mounted });
    return diff;
  }

  logger.warn('API blueprint has drifted from the mounted routes', {
    mounted: diff.mounted,
    declared: diff.declared,
    declaredButNotMounted: diff.missing,
    mountedButNotDeclared: diff.undeclared,
  });
  return diff;
}
