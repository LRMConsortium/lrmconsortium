import { Schema, model, type Types } from 'mongoose';
import { ROLES, type Role } from '../config/roles.js';
import { HQ_ZONES } from '../config/hqZones.js';

/**
 * Append-only. Updates and deletes are blocked at the schema level so the
 * Founder Command Center reads a trail nobody has edited.
 */
export interface IAuditLog {
  _id: Types.ObjectId;
  actor?: Types.ObjectId;
  actorEmail?: string;
  actorRoles: Role[];
  action: string;
  resource: string;
  resourceId?: string;
  zone?: string;
  method: string;
  path: string;
  statusCode: number;
  requestId?: string;
  ip?: string;
  userAgent?: string;
  before?: unknown;
  after?: unknown;
  createdAt: Date;
}

const auditLogSchema = new Schema<IAuditLog>(
  {
    actor: { type: Schema.Types.ObjectId, ref: 'User'},
    actorEmail: { type: String, trim: true },
    actorRoles: { type: [String], enum: ROLES, default: [] },
    action: { type: String, required: true },
    resource: { type: String, required: true },
    resourceId: { type: String },
    zone: { type: String, enum: HQ_ZONES },
    method: { type: String, required: true },
    path: { type: String, required: true },
    statusCode: { type: Number, required: true },
    requestId: { type: String },
    ip: { type: String },
    userAgent: { type: String },
    before: { type: Schema.Types.Mixed },
    after: { type: Schema.Types.Mixed },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    collection: 'audit_logs',
    versionKey: false,
  },
);

auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ resource: 1, createdAt: -1 });

const blockMutation = function blockMutation(next: (err?: Error) => void): void {
  next(new Error('Audit log entries are immutable'));
};

auditLogSchema.pre('updateOne', blockMutation);
auditLogSchema.pre('updateMany', blockMutation);
auditLogSchema.pre('findOneAndUpdate', blockMutation);
auditLogSchema.pre('deleteOne', blockMutation);
auditLogSchema.pre('deleteMany', blockMutation);

export const AuditLog = model<IAuditLog>('AuditLog', auditLogSchema);
