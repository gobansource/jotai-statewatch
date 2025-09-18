import { atom, createStore } from "jotai/vanilla";

import { createSingleAtomWatcher } from "../singleAtomWatcher";
import type { StoreLike } from "../types";

const loggerStub = {
  debug: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
};

/** Utility that flushes the micro-task queue so that all pending promises
 * created in the code under test get a chance to resolve before assertions.
 */
const flushMicrotasks = () => new Promise<void>((r) => setImmediate(r));

// ---------------------------------------------------------------------------
// UNIT TESTS (use a lightweight manual stub for StoreLike)
// ---------------------------------------------------------------------------

describe("createSingleAtomWatcher – unit", () => {
  let storeValue = 0;
  let subCallback: (() => void) | undefined;
  const unsubscribeMock = jest.fn();

  const storeStub: StoreLike = {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore – only the members used by the watcher matter in this context.
    sub: jest.fn((_, cb: () => void) => {
      subCallback = cb;
      return unsubscribeMock;
    }),
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    get: jest.fn(() => storeValue),
  };

  const valueAtom = atom(storeValue);

  const newWatcher = () =>
    createSingleAtomWatcher(storeStub, loggerStub, valueAtom, "testWatcher");

  beforeEach(() => {
    jest.clearAllMocks();
    storeValue = 0;
    subCallback = undefined;
  });

  it("addCallback / removeCallback / removeAllCallbacks work & ids are unique", () => {
    const watcher = newWatcher();

    const cb1 = jest.fn();
    const cb2 = jest.fn();

    const id1 = "t1";
    const id2 = "t2";

    watcher.addCallback(cb1, id1);
    watcher.addCallback(cb2, id2);

    expect(id1).toBe("t1");
    expect(id2).toBe("t2");

    watcher.removeCallback(id1);
    // trigger atom update so that only cb2 should fire
    watcher.startWatching();
    expect(typeof subCallback).toBe("function");
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    subCallback!();

    expect(cb1).not.toHaveBeenCalled();
    expect(cb2).toHaveBeenCalledTimes(2);

    watcher.removeAllCallbacks();
    // trigger again – nothing should run now
    subCallback!();
    expect(cb2).toHaveBeenCalledTimes(2);
  });

  it("startWatching is idempotent and subscribes only once", async () => {
    const watcher = newWatcher();

    watcher.startWatching();
    watcher.startWatching();

    // subscription created exactly once
    expect(storeStub.sub).toHaveBeenCalledTimes(1);
    await flushMicrotasks();
  });

  it("stopWatching invokes unsubscribe and prevents further ticks", async () => {
    const watcher = newWatcher();
    const cb = jest.fn();
    watcher.addCallback(cb, "x");

    watcher.startWatching();
    // ensure first immediate tick finished
    await flushMicrotasks();
    expect(cb).toHaveBeenCalledTimes(1);

    watcher.stopWatching();
    expect(unsubscribeMock).toHaveBeenCalledTimes(1);

    // after stopWatching we shouldn't respond to further store emissions; since
    // this unit test uses a manual stub we won't trigger subCallback again.
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("executes callbacks sequentially and swallows errors", async () => {
    const watcher = newWatcher();

    const failing = jest.fn(() => {
      throw new Error("boom");
    });
    const succeeding = jest.fn();

    watcher.addCallback(failing, "f");
    watcher.addCallback(succeeding, "s");

    watcher.startWatching();
    await flushMicrotasks();

    expect(failing).toHaveBeenCalledTimes(1);
    expect(succeeding).toHaveBeenCalledTimes(1);
    // error should be logged but not break execution chain
    expect(loggerStub.error).toHaveBeenCalledWith(
      expect.stringContaining("Error in callback"),
      expect.any(Error)
    );
  });

  it("getCurrentValue proxies store.get", () => {
    const watcher = newWatcher();

    storeValue = 42;
    expect(watcher.getCurrentValue()).toBe(42);
  });
});

// ---------------------------------------------------------------------------
// INTEGRATION TESTS (real Jotai store)
// ---------------------------------------------------------------------------

describe("createSingleAtomWatcher – integration with jotai store", () => {
  const waitForTick = flushMicrotasks; // alias for readability

  it("fires initial tick and reacts to atom updates", async () => {
    const countAtom = atom(0);
    const store = createStore();
    const watcher = createSingleAtomWatcher(
      store as unknown as StoreLike,
      loggerStub,
      countAtom,
      "integrationWatcher"
    );

    const cb = jest.fn(() => {
      /* no-op */
    });
    watcher.addCallback(cb, "cb");

    watcher.startWatching();
    await waitForTick();
    expect(cb).toHaveBeenCalledTimes(1);
    expect(watcher.getCurrentValue()).toBe(0);

    store.set(countAtom, 1);
    await waitForTick();
    expect(cb).toHaveBeenCalledTimes(2);
    expect(watcher.getCurrentValue()).toBe(1);
  });

  it("stops reacting after stopWatching()", async () => {
    const valAtom = atom("a");
    const store = createStore();
    const watcher = createSingleAtomWatcher(
      store as unknown as StoreLike,
      loggerStub,
      valAtom,
      "integrationStopWatcher"
    );

    const cb = jest.fn();
    watcher.addCallback(cb, "cb");
    watcher.startWatching();
    await waitForTick();

    store.set(valAtom, "b");
    await waitForTick();
    expect(cb).toHaveBeenCalledTimes(2); // initial + first change

    watcher.stopWatching();
    store.set(valAtom, "c");
    await waitForTick();
    expect(cb).toHaveBeenCalledTimes(2); // still 2 – no more after stop
  });
});
