/**
 * Controller registry.
 *
 * Controllers in this platform are generated from `createCrudController` and
 * attached to their module's router, so this file exists to expose the factories
 * (for composing custom endpoints) rather than to hold hand-written handlers.
 */

export { createCrudController } from '../shared/BaseController.js';
export type { CrudController } from '../shared/BaseController.js';
export { createAdvertisingController } from '../modules/advertising/advertising.controller.js';
export { asyncHandler, ok, created, noContent, paginated, pageMeta } from '../shared/http.js';
export type { PageMeta } from '../shared/http.js';
