import router from './organization.routes';

export const organizationModule = {
  name: 'organization',
  mounts: [
    {
      path: 'organizations',
      router,
      method: 'POST',
      summary: 'Create and manage LRMC organizations',
      permissions: ['founder'],
      zone: 'global',
      auth: 'required',

      // ⭐ REQUIRED BY LRMC BLUEPRINT
      requestBody: {
        name: 'string',
        country: 'string'
      },

      responseShape: {
        success: 'boolean',
        data: 'Organization'
      },

      surface: 'api'
    }
  ]
};

export default organizationModule;
