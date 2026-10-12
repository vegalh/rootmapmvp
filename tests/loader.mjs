import { register } from "node:module";
// Extensionless relative imports resolve to .ts or a folder's index.ts (as in Vite). Image imports become their file URL, the way Vite
// turns an imported asset into a URL string, so modules that import bundled images (seed data) load in Node.
register("data:text/javascript," + encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  try { return await next(spec, ctx); } catch (e) {
    if (!spec.startsWith(".") || /\\.[a-z]+$/.test(spec)) throw e;
    try { return await next(spec + ".ts", ctx); } catch { return next(spec + "/index.ts", ctx); }
  }
}
export async function load(url, ctx, next) {
  if (/\\.(svg|png|jpe?g|webp)$/.test(url)) return { format: "module", source: "export default " + JSON.stringify(url), shortCircuit: true };
  return next(url, ctx);
}`));
