import {
  IntervalCallbackOptions,
  IntervalCallbackResult,
  EventsFor,
  WatchersMap,
} from "./types";
import { createMutex } from "nano-mutex";

/**
 * Creates a callback that sets up (and tears down) a background interval based
 * on a dynamic condition. The generated callback can be attached to a watcher;
 * every time it is invoked, the helper evaluates the condition and
 * re-initialises the interval loop if necessary.
 */
export const createIntervalCallback = <
  M extends WatchersMap,
  KS extends readonly (keyof M)[]
>(
  options: IntervalCallbackOptions<M, KS>
): IntervalCallbackResult<M, KS> => {
  let interval: NodeJS.Timeout | null = null;

  const mutex = createMutex();

  const callback = async (events: EventsFor<M, KS>) => {
    // Ensure only one execution of the callback body at a time
    const release = await mutex.acquire();
    try {
      options.logger.debug("Interval callback executed");

      if (await options.condition(events)) {
        // Clear any existing interval first
        if (interval) {
          clearInterval(interval);
          interval = null;
        }

        if (options.runOnSetup !== false) {
          // Run the action immediately
          try {
            await options.action();
          } catch (err) {
            options.logger.error("Error executing interval action", err);
          }
        }
        // Schedule future ticks
        interval = setInterval(async () => {
          try {
            await options.action();
          } catch (err) {
            options.logger.error("Error executing interval action", err);
          }
        }, options.intervalMs);
      } else if (interval) {
        // Condition failed – ensure any existing interval is cleared
        options.logger.debug("Condition failed - clearing interval");
        clearInterval(interval);
        interval = null;
      }
    } finally {
      release();
    }
  };

  const cleanup = () => {
    if (interval) {
      options.logger.debug("Cleaning up interval");
      clearInterval(interval);
      interval = null;
    }
  };

  return {
    callback: callback as (events: EventsFor<M, KS>) => Promise<void>,
    cleanup,
  };
};
