import type { WatcherCallbackConfig, WatchersMap, LoggerLike } from "./types";
import { createFanInAggregator } from "./createFanInAggregator";

/**
 * Wires callback functions to one or more watchers and returns a function that
 * cleans up all the registrations.
 */
export const registerCallbacks = <M extends WatchersMap>(
  watchers: M,
  callbackConfigs: Record<string, WatcherCallbackConfig<M>>,
  logger: LoggerLike
) => {
  // Keep disposer for each callback key to handle pending flushes during cleanup
  const aggregatorDisposers = new Map<string, () => void>();

  // helper to build deterministic callback id
  const makeId = (callbackName: string, key: keyof M) =>
    `${callbackName}_${String(key)}`;

  Object.entries(callbackConfigs).forEach(([cfgKey, cfg]) => {
    const callbackName = cfgKey;
    
    cfg.setup?.();

    // Fan-in aggregation extracted to separate module
    const { fanIn, dispose: disposeAggregator } = createFanInAggregator(
      callbackName,
      cfg,
      watchers,
      logger
    );

    cfg.watchers.forEach((key) => {
      const id = makeId(callbackName, key);
      watchers[key].addCallback(fanIn, id);
      logger.debug(`Registered ${callbackName} with ${String(key)} (${id})`);
    });

    // keep disposer to call later
    aggregatorDisposers.set(callbackName, disposeAggregator);
  });

  // Return cleanup function.
  return () => {
    Object.entries(callbackConfigs).forEach(([cfgKey, cfg]) => {
      const name = cfgKey;

      cfg.watchers.forEach((key) => {
        const id = makeId(name, key);
        watchers[key].removeCallback(id);
        logger.debug(`Removed ${name} from ${String(key)} (${id})`);
      });

      // flush any remaining queued events and clear aggregator state
      const disposeAggregator = aggregatorDisposers.get(name);
      disposeAggregator?.();

      cfg.teardown?.();
    });
  };
};
