import type {
  WatcherCallbackConfig,
  WatchersMap,
  LoggerLike,
  WatcherEvent,
  SingleAtomCallback,
  EventsFor,
} from "./types";

/**
 * Builds a fan-in aggregation layer for a single user-supplied callback.
 *
 * It collects single-atom watcher events, deduplicates them per micro-task,
 * synthesises "no-change" events for atoms that did not emit, and finally
 * invokes the original user callback with an aggregated events object.
 *
 * The caller receives:
 *   • `fanIn`   – a `SingleAtomCallback` to register with every watched atom.
 *   • `dispose` – flushes any queued events and clears internal state. Call
 *                 this before removing the callback from the watchers to make
 *                 sure the last batch is delivered.
 */
export const createFanInAggregator = <M extends WatchersMap>(
  cfgKey: string,
  cfg: WatcherCallbackConfig<M>,
  watchers: M,
  logger: LoggerLike
): { fanIn: SingleAtomCallback; dispose: () => void } => {
  const name = cfgKey;

  // Fan-in aggregation state
  const queued = new Map<string, WatcherEvent>();
  // keep last seen value per watcher to populate `previous` on synthetic events
  const lastValues = new Map<string, unknown>();
  let flushScheduled = false;

  const flush = () => {
    flushScheduled = false;

    const eventsObject: Record<string, WatcherEvent> = {};

    (cfg.watchers as (keyof M)[]).forEach((key) => {
      const k = key as string;
      const queuedEvent = queued.get(k);

      if (queuedEvent) {
        eventsObject[k] = queuedEvent;
        lastValues.set(k, queuedEvent.current);
      } else {
        // synthesise noop event so users always receive a complete object
        const current = watchers[key].getCurrentValue();
        eventsObject[k] = {
          id: k,
          current,
          previous: lastValues.get(k),
          isInitial: false,
          isChanged: false,
        } as WatcherEvent;
        lastValues.set(k, current);
      }
    });

    queued.clear();
    logger.info(`Executing user callback ${name}`);
    logger.debug(`Executing user callback ${name}`, { eventsObject });

    Promise.resolve(
      cfg.callback(eventsObject as EventsFor<M, typeof cfg.watchers>)
    ).catch((err) =>
      logger.error(`Error executing user callback ${name}`, err)
    );
  };

  const fanIn: SingleAtomCallback = (event) => {
    queued.set(event.id, event);
    lastValues.set(event.id, event.current);

    if (!flushScheduled) {
      flushScheduled = true;
      queueMicrotask(flush);
    }
  };

  const dispose = () => {
    // force a flush if something is still queued
    if (flushScheduled) {
      flush();
    }
    queued.clear();
    lastValues.clear();
  };

  return { fanIn, dispose };
};
