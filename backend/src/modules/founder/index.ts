import router from './founder.routes.js';

export const founderModule = {
  collectionPath: 'founder',
  mounts: [
    { path: 'founder', router }
  ],
};
