import { register } from "node:module";
// Extensionless relative imports resolve to .ts or a folder's index.ts (as in Vite). JSON imports need no attribute. Image (and audio) imports become their file URL, the way Vite
// turns an imported asset into a URL string, so modules that import bundled images (seed data) load in Node.
register("data:text/javascript," + encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  try { return await next(spec, ctx); } catch (e) {
    if (!spec.startsWith(".") || /\\.[a-z]+$/.test(spec)) throw e;
    try { return await next(spec + ".ts", ctx); } catch { return next(spec + "/index.ts", ctx); }
  }
}
export async function load(url, ctx, next) {
  if (/\\.(svg|png|jpe?g|webp|mp3|m4a|wav)$/.test(url)) return { format: "module", source: "export default " + JSON.stringify(url), shortCircuit: true };
  // JSON data files (src/data/songs.json) import without an attribute, as in Vite.
  if (/\\.json$/.test(url)) return next(url, { ...ctx, importAttributes: { ...ctx.importAttributes, type: "json" } });
  return next(url, ctx);
}`));
