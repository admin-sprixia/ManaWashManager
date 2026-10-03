// Provided by the Workers runtime under `nodejs_compat` (see wrangler.toml). Declared here rather
// than pulling in @types/node, whose globals clash with @cloudflare/workers-types.
declare module 'node:async_hooks' {
  export class AsyncLocalStorage<T> {
    getStore(): T | undefined;
    run<R>(store: T, callback: () => R): R;
  }
}
