import { Organization } from '../../models/Organization.js';

export const OrganizationService = {
  async create(data: any) {
    return Organization.create(data);
  }
};
