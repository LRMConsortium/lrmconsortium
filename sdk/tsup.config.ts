import { defineConfig } from 'tsup';

/**
 * ESM + CJS + type declarations from one entry point.
 *
 * axios is marked external so a browser bundle never pulls it in — the dynamic
 * import in `axiosClient.ts` stays dynamic, and a bundler that cannot resolve it
 * leaves it alone rather than failing the build.
 */
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  splitting: false,
  minify: false,
  target: 'es2022',
  platform: 'neutral',
  external: ['axios'],
  outExtension({ format }) {
    return { js: format === 'cjs' ? '.cjs' : '.js' };
  },
});
