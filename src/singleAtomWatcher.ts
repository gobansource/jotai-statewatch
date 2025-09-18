import type { Atom } from "jotai";
import type {
  StoreLike,
  LoggerLike,
  SingleAtomCallback,
  SingleAtomWatcher,
  WatcherEvent,
} from "./types";

/**
 * Creates a watcher around a single Jotai atom. The watcher maintains a list
 * of callbacks which are invoked whenever the atom's value changes.
 */
export const createSingleAtomWatcher = <T>(
  store: StoreLike,
  logger: LoggerLike,
  atom: Atom<T>,
  watcherId: string
): SingleAtomWatcher<T> => {
  // Stores callback functions keyed by caller-supplied id.
  const callbacks: Map<string, SingleAtomCallback<T>> = new Map();

  let unsubscribe: (() => void) | null = null;

  // Helper to dispatch an event to all registered callbacks sequentially;
  // errors in one callback are caught so others still run.
  const dispatchEvent = async (event: WatcherEvent<T>) => {
    logger.debug(`Dispatching event for watcher ${watcherId}`, {
      callbacks: callbacks.size,
      isInitial: event.isInitial,
      isChanged: event.isChanged,
      current: event.current,
      previous: event.previous,
    });

    for (const [id, cb] of callbacks.entries()) {
      try {
        //logger.debug(`Executing callback ${id} for watcher ${watcherId}`);
        await cb(event);
      } catch (err) {
        logger.error(`Error in callback ${id}:`, err);
      }
    }
  };

  const service: SingleAtomWatcher<T> = {
    addCallback: (cb: SingleAtomCallback<T>, id: string) => {
      callbacks.set(id, cb);
      logger.debug(`Added callback ${id} to watcher ${watcherId}`);
    },

    removeCallback: (id: string) => callbacks.delete(id),

    removeAllCallbacks: () => callbacks.clear(),

    startWatching: () => {
      if (unsubscribe) return; // already watching

      // Previous value tracking
      let previousValue: T | undefined = undefined;

      const makeEvent = (current: T, isInitial: boolean): WatcherEvent<T> => ({
        id: watcherId,
        current,
        previous: previousValue,
        isInitial,
        isChanged: true,
      });

      unsubscribe = store.sub(atom, () => {
        const currentValue = store.get(atom);
        const event = makeEvent(currentValue, false);
        previousValue = currentValue;

        dispatchEvent(event);
      });

      // Execute once immediately so consumers get an initial tick.
      const initialValue = store.get(atom);
      previousValue = initialValue;
      const initialEvent = makeEvent(initialValue, true);

      dispatchEvent(initialEvent);
    },

    stopWatching: () => {
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }
    },

    getCurrentValue: () => store.get(atom),
  };

  return service;
};
