import type { Atom } from "jotai";

import {
  createWatchersFromMap,
  WatchersFromMap,
} from "./createWatchersFromMap";
import type { StoreLike, LoggerLike } from "./types";

/**
 * Binds an atom map to helper utilities so application code only needs to
 * declare the map itself. Returns a strongly-typed object exposing:
 *   – `create(store, logger)` → instantiates the watchers
 *   – `WatcherIds` → runtime enum-like helper of the atom keys
 *
 * Example usage:
 * ```ts
 * const {
 *   create: createAtomWatchers,
 *   WatcherIds,
 * } = defineWatchers({
 *   authWatcher: isAuthenticatedUserAtom,
 *   // …
 * });
 * ```
 */
export const defineWatchers = <M extends Record<string, Atom<unknown>>>(
  atomMap: M
) => {
  const WatcherIds = Object.keys(atomMap).reduce((acc, key) => {
    (acc as Record<keyof M, keyof M>)[key as keyof M] = key as keyof M;
    return acc;
  }, {} as Record<keyof M, keyof M>) as { readonly [K in keyof M]: K };

  const create = (store: StoreLike, logger: LoggerLike): WatchersFromMap<M> =>
    createWatchersFromMap(atomMap, store, logger);

  return {
    create,
    WatcherIds,
  } as const;
};
