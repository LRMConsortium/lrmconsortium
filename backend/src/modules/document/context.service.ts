/**
 * Loading the world a compliance rule needs to judge a document.
 *
 * `compliance.ts` is pure on purpose — every rule takes a context object and
 * never touches a model, so the rules are assertable against fixtures. That
 * leaves someone to actually go and fetch the property, the lease, the landlord
 * and the profile, and this is that someone.
 *
 * The split is worth the extra file: the loader can be wrong about *which*
 * record to fetch without any risk of it being wrong about what agreement
 * means, and a rule can be tightened without touching a database query.
 *
 * Anything that cannot be found stays `null`, which the rules report as
 * `skipped` rather than `passed`. A missing context degrades confidence; it
 * never manufactures it.
 */

import { Lease } from '../lease/lease.model.js';
import { LandlordProfile } from '../landlord/landlord.model.js';
import { TenantProfile } from '../tenant/tenant.model.js';
import { Property } from '../property/property.model.js';
import { CommercialClient } from '../commercialClient/commercialClient.model.js';
import { DriverProfile } from '../driver/driver.model.js';
import { RiderProfile } from '../rider/rider.model.js';
import { User } from '../../models/User.js';
import type { ComplianceContext } from './compliance.js';
import type { DocumentType, FieldBag } from './documentRules.js';

export interface ContextRequest {
  type: DocumentType;
  owner: string;
  subjectKind?: string;
  subject?: string;
  fields: FieldBag;
}

/**
 * Which slots each document type's rule actually reads.
 *
 * Declared rather than inferred so the loader does exactly the queries the rule
 * will consult — a compliance check should not cost six collection reads
 * because the loader hydrated everything just in case.
 */
const CONTEXT_NEEDS: Record<DocumentType, readonly string[]> = {
  identity: ['profile'],
  proofOfResidency: ['property'],
  hostConfirmation: ['landlord'],
  rentalAgreement: ['lease'],
  tenantIntake: ['profile'],
  propertyOwnership: ['commercialClient'],
  employmentVerification: ['employer'],
  incomeProof: [],
  maritalStatus: ['household'],
  birthRecord: ['dependent'],
  criminalBackground: ['eligibility'],
  driverLicence: [],
  vehicleInsurance: [],
  roadworthiness: [],
  businessRegistration: [],
  taxClearance: [],
};

export function contextNeedsFor(type: DocumentType): readonly string[] {
  return CONTEXT_NEEDS[type] ?? [];
}

/** The profile behind an account, whichever kind it is. */
async function profileFor(userId: string): Promise<ComplianceContext['profile']> {
  const tenant = await TenantProfile.findOne({ user: userId, deletedAt: null })
    .select('fullName dateOfBirth IDNumber user')
    .lean()
    .exec();
  if (tenant) {
    return {
      id: String(tenant._id),
      fullName: tenant.fullName,
      dateOfBirth: tenant.dateOfBirth,
      IDNumber: tenant.IDNumber,
      user: String(tenant.user),
    };
  }

  const account = await User.findOne({ _id: userId, deletedAt: null })
    .select('fullName email')
    .lean()
    .exec();
  return account ? { id: String(account._id), fullName: account.fullName, user: String(account._id) } : null;
}

export async function loadComplianceContext(request: ContextRequest): Promise<ComplianceContext> {
  const needs = contextNeedsFor(request.type);
  const ctx: ComplianceContext = {};
  if (needs.length === 0) return ctx;

  if (needs.includes('profile')) {
    ctx.profile = await profileFor(request.owner);
  }

  if (needs.includes('property') && request.subject) {
    const property = await Property.findOne({ _id: request.subject, deletedAt: null })
      .select('address city region owner ownerKind')
      .lean()
      .exec();
    ctx.property = property
      ? {
          id: String(property._id),
          address: property.address,
          city: property.city,
          region: property.region,
          owner: property.owner ? String(property.owner) : undefined,
          ownerKind: property.ownerKind,
        }
      : null;
  }

  if (needs.includes('landlord')) {
    // Prefer the landlord named by the subject; fall back to the one on the
    // lease the document hangs off, so a host letter attached to a tenancy
    // still finds its counterparty.
    const direct = request.subjectKind === 'LandlordProfile' && request.subject
      ? await LandlordProfile.findOne({ _id: request.subject, deletedAt: null }).select('fullName user').lean().exec()
      : null;
    if (direct) {
      ctx.landlord = { id: String(direct._id), fullName: direct.fullName, user: String(direct.user) };
    } else {
      const lease = await Lease.findOne({ tenant: request.subject, deletedAt: null })
        .select('landlord')
        .lean()
        .exec();
      const landlord = lease?.landlord
        ? await LandlordProfile.findOne({ _id: lease.landlord, deletedAt: null }).select('fullName user').lean().exec()
        : null;
      ctx.landlord = landlord
        ? { id: String(landlord._id), fullName: landlord.fullName, user: String(landlord.user) }
        : null;
    }
  }

  if (needs.includes('lease') && request.subject) {
    const lease = await Lease.findOne({ _id: request.subject, deletedAt: null })
      .select('landlord tenant property monthlyRent currency leaseStart leaseEnd')
      .lean()
      .exec();
    ctx.lease = lease
      ? {
          id: String(lease._id),
          landlord: String(lease.landlord),
          tenant: String(lease.tenant),
          property: String(lease.property),
          monthlyRent: lease.monthlyRent,
          currency: lease.currency,
          leaseStart: lease.leaseStart,
          leaseEnd: lease.leaseEnd,
        }
      : null;
  }

  if (needs.includes('commercialClient')) {
    const client =
      request.subjectKind === 'CommercialClient' && request.subject
        ? await CommercialClient.findOne({ _id: request.subject, deletedAt: null })
            .select('clientName linkedProperties')
            .lean()
            .exec()
        : await CommercialClient.findOne({ user: request.owner, deletedAt: null })
            .select('clientName linkedProperties')
            .lean()
            .exec();
    ctx.commercialClient = client
      ? {
          id: String(client._id),
          clientName: client.clientName,
          linkedProperties: (client.linkedProperties ?? []).map(String),
        }
      : null;
  }

  if (needs.includes('employer')) {
    // No employer directory exists yet, so the rule is fed what the tenant
    // profile already claims. Stated plainly rather than faked: when the
    // profile says nothing, the check reports `skipped`, not `passed`.
    const tenant = await TenantProfile.findOne({ user: request.owner, deletedAt: null })
      .select('employerName employmentStatus')
      .lean()
      .exec();
    ctx.employer = tenant?.employerName
      ? { name: tenant.employerName, verified: tenant.employmentStatus === 'employed' }
      : null;
  }

  if (needs.includes('household')) {
    const tenant = await TenantProfile.findOne({ user: request.owner, deletedAt: null })
      .select('maritalStatus')
      .lean()
      .exec();
    ctx.household = tenant
      ? { maritalStatus: (tenant as { maritalStatus?: string }).maritalStatus }
      : null;
  }

  if (needs.includes('dependent')) {
    // Dependents are declared on the document itself until a household register
    // exists; the rule compares the certificate against what was declared.
    const name = request.fields.holderName;
    ctx.dependent = name
      ? {
          name: String(name),
          dateOfBirth: request.fields.dateOfBirth as Date | string | undefined,
          relationship: request.fields.relationship as string | undefined,
        }
      : null;
  }

  if (needs.includes('eligibility')) {
    const driver = await DriverProfile.findOne({ user: request.owner, deletedAt: null })
      .select('verificationStatus status')
      .lean()
      .exec();
    if (driver) {
      ctx.eligibility = {
        role: 'driver',
        verificationStatus: driver.verificationStatus,
        suspended: driver.status === 'suspended',
      };
    } else {
      const rider = await RiderProfile.findOne({ user: request.owner, deletedAt: null })
        .select('verificationStatus status')
        .lean()
        .exec();
      ctx.eligibility = rider
        ? {
            role: 'rider',
            verificationStatus: rider.verificationStatus,
            suspended: rider.status === 'suspended',
          }
        : null;
    }
  }

  return ctx;
}
