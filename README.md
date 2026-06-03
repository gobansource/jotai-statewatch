# jotai-statewatch

[![npm](https://img.shields.io/npm/v/jotai-statewatch.svg)](https://www.npmjs.com/package/jotai-statewatch)

**npm:** [jotai-statewatch](https://www.npmjs.com/package/jotai-statewatch)

Lightweight, type‑safe watcher + callback orchestration utilities for [Jotai](https://github.com/pmndrs/jotai) stores. It helps you declaratively wire side‑effects to atom state transitions (including multi‑atom fan‑in conditions, debounced reactions, periodic intervals gated by state, and lifecycle teardown) without scattering ad‑hoc `useEffect` logic across your app.

> ESM‑only. Requires Node >=16 (or a modern bundler / React Native Metro). Ships pure, tree‑shakable code + TypeScript declarations.

---

## ✨ Features

- **Deterministic watcher layer** – Wraps atoms and tracks current/previous values & change flags.
- **Multi‑atom callbacks** – React to _combinations_ of atom changes in a single cohesive function.
- **Interval helpers** – Run gated periodic tasks only when conditions are met; auto‑suspend when not.
- **Fan‑in aggregators** – Consolidate multiple watcher events into a single typed event object.
- **Typed IDs / config map** – Compile‑time safety for watcher identifiers and callback wiring.
- **Explicit teardown** – Cleanly stop intervals, release resources, or unsubscribe.
- **Debounce / mutex friendly** – Designed to play nicely with lightweight locks like `nano-mutex`.
- **No runtime dependency on React** – Works with Jotai store instances anywhere (web, RN, server scripts for pre‑warming, etc.).

---

## 📦 Installation

```bash
npm install jotai-statewatch
# or
pnpm add jotai-statewatch
# or
yarn add jotai-statewatch
```

Peer dependency:

```json
"peerDependencies": { "jotai": "^2.4.0" }
```

If you are in a CommonJS environment and see `ERR_REQUIRE_ESM`, switch to dynamic import:

```js
const mod = await import("jotai-statewatch");
```

---

## 🧠 Core Concepts

| Concept           | Description                                                                                                    |
| ----------------- | -------------------------------------------------------------------------------------------------------------- |
| Watcher           | A wrapped atom that exposes `{ current, previous, isChanged }`.                                                |
| Watcher Map       | Object literal mapping stable watcher IDs → source atoms. Generates types.                                     |
| Callback Config   | Declarative description: which watcher IDs it cares about, the async callback, optional teardown, description. |
| Interval Callback | Utility that produces a watcher callback driven by a condition + periodic action.                              |
| Watcher Manager   | Orchestrates registering / deregistering callbacks and dispatching events.                                     |

---

## 🚀 Quick Start

```ts
import { atom } from "jotai";
import {
  defineWatchers,
  defineWatcherCallback,
  createWatcherManager,
} from "jotai-statewatch";

// 1. Define atoms
const countAtom = atom(0);
const thresholdAtom = atom(10);

// 2. Build typed watcher map
const watcherMap = {
  countWatcher: countAtom,
  thresholdWatcher: thresholdAtom,
} as const;

const { create: createWatchers, WatcherIds } = defineWatchers(watcherMap);

// 3. Define callback reacting to both atoms
const logWhenExceeded = defineWatcherCallback({
  watchers: [WatcherIds.countWatcher, WatcherIds.thresholdWatcher] as const,
  description: "Logs when count surpasses threshold",
  async callback(events) {
    const { countWatcher, thresholdWatcher } = events;
    if (!countWatcher.isChanged) return; // Only act on count change
    if (countWatcher.current > thresholdWatcher.current) {
      console.log("Threshold exceeded!", {
        count: countWatcher.current,
        threshold: thresholdWatcher.current,
      });
    }
  },
});

// 4. Create runtime watchers + manager
const runtimeWatchers = createWatchers();
const manager = createWatcherManager(runtimeWatchers, [logWhenExceeded]);

// 5. Wire to a jotai store (root store or derived)
import { unstable_createStore } from "jotai";
const store = unstable_createStore();
manager.start(store); // begins listening

// Later: manager.stop(); // invokes teardowns
```

---

## 🧩 API Overview

### `defineWatchers(watcherMap)`

Creates a factory + strongly typed `WatcherIds` enum‐like object.

```ts
const { create, WatcherIds } = defineWatchers({
  fooWatcher: fooAtom,
  barWatcher: barAtom,
} as const);
const runtimeWatchers = create();
```

### `defineWatcherCallback(config)`

Defines a callback tied to one or more watcher IDs.

```ts
const cb = defineWatcherCallback({
  watchers: [WatcherIds.fooWatcher] as const,
  description: "Do something when foo changes",
  async callback(events) {
    if (events.fooWatcher.isChanged) {
      // ...
    }
  },
  teardown: () => {
    /* optional cleanup */
  },
});
```

Event object shape (per watcher):

```ts
interface WatcherEvent<T> {
  current: T;
  previous: T | undefined;
  isChanged: boolean; // strict referential or primitive change
}
```

### `createIntervalCallback({ condition, action, intervalMs, runOnSetup, logger })`

Utility that yields `{ callback, cleanup }` so you can wrap it with `defineWatcherCallback`.

- `condition(events) => boolean | Promise<boolean>` determines whether the interval should (continue to) run.
- `action()` executes each tick when condition holds.
- Auto‑pauses when condition returns false.

### `createFanInAggregator(watchers, handler)` (if exported in your build)

Combine multiple watchers into a synthesized event; useful for advanced dedupe or state gating.

### `registerCallbacks(manager, callbacks)`

Batch registration helper (your internal wiring may already abstract this).

### `createSingleAtomWatcher(atom, id?)`

Ad hoc wrapper when you do not need the full map pattern.

---

## ⏱ Interval Example

```ts
import {
  createIntervalCallback,
  defineWatcherCallback,
} from "jotai-statewatch";

const intervalResult = createIntervalCallback({
  watchers: undefined, // Provided when wrapping with defineWatcherCallback
  condition: async (events) => events.sessionWatcher.current.isActive,
  action: async () => syncHeartbeat(),
  intervalMs: 15_000,
  runOnSetup: false,
  logger: console,
});

export const heartbeatCallback = defineWatcherCallback({
  watchers: [WatcherIds.sessionWatcher] as const,
  description: "Heartbeat while session active",
  callback: intervalResult.callback,
  teardown: intervalResult.cleanup,
});
```

---

## 🔒 Concurrency (using `nano-mutex`)

For idempotent critical sections:

```ts
import { createMutex } from "nano-mutex";
const mutex = createMutex();

const guarded = defineWatcherCallback({
  watchers: [WatcherIds.fooWatcher] as const,
  async callback(events) {
    const release = await mutex.acquire();
    try {
      // perform serialized operations
    } finally {
      release();
    }
  },
});
```

---

## 🛡 Change Detection Semantics

- Primitive values: strict `!==` comparison.
- Objects / arrays: referential change only (same as `===` identity). If you mutate in place, the watcher will report `isChanged: false`; prefer immutable updates.

---

## 🧪 Testing Patterns

Because callbacks are plain functions, you can unit test them directly:

```ts
test("fires when count changes", async () => {
  const cb = defineWatcherCallback({
    watchers: [WatcherIds.countWatcher] as const,
    async callback(events) {
      expect(events.countWatcher.isChanged).toBe(true);
      expect(events.countWatcher.current).toBe(2);
    },
  });
  // Simulate dispatch: feed synthetic events object
  await cb.callback({
    countWatcher: { current: 2, previous: 1, isChanged: true },
  } as any);
});
```

---

## 🧷 Lifecycle

1. `createWatchers()` creates internal bookkeeping wrappers (lazy, cheap).
2. `manager.start(store)` subscribes to underlying atoms and begins diff propagation.
3. Each atom commit triggers event fan‑out; relevant callbacks receive a _snapshot_ of all watched IDs.
4. `manager.stop()` unsubscribes & invokes callback teardowns (interval cleanup, etc.).

---

## ⚙️ Performance Notes

- Minimal overhead: only watched atoms are subscribed; unchanged atoms do not trigger deep computations.
- Event object is allocated once per callback dispatch. Keep callbacks lean & defer heavier work.
- Debounce bursts with timers or queues inside your callback (pattern shown in repo access sync example in the consuming app).

---

## 🧭 Comparison

| Approach                    | Pros                         | Cons                                             |
| --------------------------- | ---------------------------- | ------------------------------------------------ |
| Scattered `useEffect` hooks | Familiar                     | Hard to coordinate multi‑atom logic; duplication |
| Derived atoms only          | Pure & compositional         | Side effects still need orchestration layer      |
| jotai-statewatch            | Centralized, typed, testable | Additional abstraction layer                     |

---

## 🔍 Troubleshooting

| Symptom                  | Possible Cause                 | Fix                                             |
| ------------------------ | ------------------------------ | ----------------------------------------------- |
| Callback never fires     | Wrong watcher ID list          | Ensure `as const` on `watchers` array           |
| `isChanged` always false | In-place mutation              | Use immutable updates / new references          |
| Interval never runs      | `condition` never returns true | Log inputs; verify dependency watchers          |
| ESM import error         | CommonJS runtime               | Use dynamic `import()` or enable ESM in project |

---

## 📑 Type Reference (Condensed)

```ts
interface WatcherEvent<T> {
  current: T;
  previous: T | undefined;
  isChanged: boolean;
}

type WatcherEventsMap<Ids extends readonly string[]> = Record<
  Ids[number],
  WatcherEvent<any>
>;

interface WatcherCallbackConfig<Ids extends readonly string[], Events> {
  watchers: Ids;
  description?: string;
  callback: (events: Events) => void | Promise<void>;
  teardown?: () => void | Promise<void>;
}
```

(Exact generics may differ slightly; see emitted `.d.ts` files for authoritative signatures.)

---

## 🗺 Suggested Project Structure (Example)

```
statewatch/
  src/
    index.ts
    defineWatchers.ts
    defineWatcherCallback.ts
    createIntervalCallback.ts
    ...
  __tests__/
```

---

## 🔐 Sustainability & Versioning

- Follows SemVer (`MAJOR.MINOR.PATCH`).
- Breaking API changes will increment MAJOR.
- Minor adds new APIs, patch fixes bugs / types.

---

## 🤝 Contributing

1. Clone / enable pnpm or npm
2. Run tests: `npm test`
3. Add / adjust code + tests
4. Submit PR with clear description / rationale

Please keep changes small & focused. Add tests for new behavior.

---

## Used By

- [PushToDisplay](https://pushtodisplay.com) — an API-first real-time display board platform that pushes content to any screen via REST API, CLI, or MCP server. Uses jotai-statewatch to orchestrate all reactive state and side-effect logic in its React Native app, replacing `useEffect` with deterministic watcher callbacks.

## 📝 License

MIT © Goban Source

---

## 📬 Feedback / Issues

Open an issue: https://github.com/gobansource/jotai-statewatch/issues

---

```
[![npm version](https://img.shields.io/npm/v/jotai-statewatch.svg)](https://www.npmjs.com/package/jotai-statewatch)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
```

---

Happy watching!
