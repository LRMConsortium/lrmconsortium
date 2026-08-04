/**
 * Gate 1½ — presence.
 *
 * The three original gates answer questions about the *account*: which surface
 * it may touch, what it may do, which rows are its own. All three are satisfied
 * by holding a token. None of them can tell whether the person the token
 * belongs to is the one currently using it.
 *
 * That distinction is the whole reason the Founder Authorisation Code exists.
 * A founder holds the role permanently — through a stolen session, an
 * unattended laptop, a coerced login. The code is a claim about *now*: someone
 * who knows six digits that are not stored anywhere recoverable typed them in
 * the last thirty minutes.
 *
 * Until this middleware existed the check lived only in the console. The server
 * computed a clearance, reported it, and then let every Zone A request through
 * regardless. Anyone holding a founder token could bypass the code entirely by
 * calling the API directly — the security was in the user interface, which is
 * to say it was in the one place an attacker never has to visit.
 *
 * The decision itself is in `facRules.clearanceGate`, which is pure and tested
 * without a database. This file does the two lookups and translates.
 */

import type { RequestHandler } from 'express';

import { logger } from '../config/logger.js';
import { FacClearance, FacCode } from '../modules/fac/fac.model.js';
import { clearanceState } from '../modules/fac/attempts.js';
import { clearanceGate, describeGate, gateAllows } from '../modules/fac/facRules.js';
import { ApiError } from '../shared/ApiError.js';

export interface RequireClearanceOptions {
  /**
   * Set on the code-issuance route and nowhere else.
   *
   * Issuing the first code is a Zone A operation, so without this the platform
   * ships in a state no founder can ever leave: a code is needed to enter the
   * room where codes are made. The exemption only bites while *no* code is in
   * force, so it seals itself the moment the first one is issued.
   */
  bootstrap?: boolean;
}

/**
 * Require a live FAC clearance.
 *
 * Sits directly after `enterZone` so the ordering of refusals stays honest: a
 * back-office clerk who wanders into a Zone A URL is told they do not belong
 * here, not asked for a code they could never obtain. Only actors who have
 * already cleared the zone gate are ever prompted.
 */
export function requireClearance(options: RequireClearanceOptions = {}): RequestHandler {
  const bootstrapExempt = options.bootstrap === true;

  return (req, _res, next) => {
    void (async () => {
      try {
        const actor = req.actor;
        if (!actor) return next(ApiError.unauthenticated());

        const now = new Date();

        const [clearanceRow, activeCode] = await Promise.all([
          FacClearance.findOne({
            actor: actor.userId,
            revokedAt: null,
            expiresAt: { $gt: now },
          })
            .sort('-grantedAt')
            .lean()
            .exec(),
          FacCode.findOne({ status: 'active' }).select('_id generation').lean().exec(),
        ]);

        // Recomputed from the grant instant rather than trusted from a stored
        // flag: a clearance must be able to lapse without anything running.
        const clearance = clearanceState(clearanceRow?.grantedAt ?? null, now);

        const decision = clearanceGate({
          clearanceActive: clearance.active,
          hasActiveCode: Boolean(activeCode),
          bootstrapExempt,
        });

        if (gateAllows(decision)) {
          // Worth a line in the log every time, because it is the one path
          // into Zone A that no code defended.
          if (decision === 'allow-bootstrap') {
            logger.warn('FAC bootstrap exemption used', {
              userId: actor.userId,
              roles: actor.roles,
              path: req.originalUrl,
              note: 'no active FAC code existed; first issuance permitted without clearance',
            });
          }
          req.facDecision = decision;
          return next();
        }

        logger.warn('Zone A refused — no clearance', {
          userId: actor.userId,
          roles: actor.roles,
          path: req.originalUrl,
          decision,
        });

        return next(
          ApiError.clearanceRequired(
            describeGate(decision),
            decision === 'deny-no-code' ? 'noActiveCode' : 'clearanceRequired',
          ),
        );
      } catch (error) {
        // A failed lookup must not become an open door. Anything unexpected
        // here refuses the request rather than falling through to the handler.
        return next(error);
      }
    })();
  };
}
