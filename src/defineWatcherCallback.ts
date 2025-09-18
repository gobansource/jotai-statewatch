import type { WatchersMap, WatcherCallbackConfig } from "./types";

/**
 * Helper for authoring strongly-typed callback configurations without
 * juggling generics or `satisfies` in every call-site.
 */
export function defineWatcherCallback<
  M extends WatchersMap,
  const KS extends readonly (keyof M)[]
>(cfg: WatcherCallbackConfig<M, KS>): WatcherCallbackConfig<M, KS> {
  return cfg;
}
