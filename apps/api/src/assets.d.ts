/** Pictures bundled into the worker (wrangler.toml [[rules]] type "Data"): their bytes. */
declare module '*.jpg' {
  const bytes: ArrayBuffer;
  export default bytes;
}
