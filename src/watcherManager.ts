import type {
  LoggerLike,
  WatchersMap,
  CallbackConfigs,
  WatcherManager,
} from "./types";
import { registerCallbacks } from "./registerCallbacks";

/**
 * Creates a lightweight manager that wires callbacks and controls the lifecycle
 * (start/stop) of a group of watchers.
 */
export const createWatcherManager = <M extends WatchersMap>(
  watchers: M,
  callbackConfigs: CallbackConfigs<M>,
  logger: LoggerLike
): WatcherManager => {
  let deregister: (() => void) | null = null;

  return {
    startAll: () => {
      logger.debug("WatcherManager: startAll");

      // If we were already started, clean up first.
      if (deregister) {
        deregister();
        deregister = null;
      }

      deregister = registerCallbacks(watchers, callbackConfigs, logger);
      Object.values(watchers).forEach((w) => w.startWatching());
    },

    stopAll: () => {
      logger.debug("WatcherManager: stopAll");
      if (deregister) {
        deregister();
        deregister = null;
      }
      Object.values(watchers).forEach((w) => w.stopWatching());
    },
  };
};
