/**
 * Node's ESM resolver requires file extensions; the app source uses the
 * extensionless relative imports that Vite resolves. This hook bridges the two so
 * the same source runs under `node --test` without a bundler.
 */
export async function resolve(specifier, context, next) {
  if (specifier.startsWith(".") && !/\.[cm]?[jt]sx?$/.test(specifier)) {
    try {
      return await next(`${specifier}.ts`, context);
    } catch {
      try {
        return await next(`${specifier}.tsx`, context);
      } catch {
        /* fall through to the default resolution error */
      }
    }
  }
  return next(specifier, context);
}
