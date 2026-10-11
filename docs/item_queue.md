# Item Queue

The `ItemQueue` accepts a single processor function and allows you to queue individual items that will be sent to that processor.

```ts
import { ItemQueue } from '@baileyherbert/queue';

const queue = new ItemQueue(function(str) {
    console.log(str);
});

queue.push('Do some work!');
queue.push('Do some more work!');
```

The processor can be synchronous, or return a promise. The queue waits for the promise to settle before the item's slot is freed.

# API

## Constructor

Create a new queue using the class constructor, with the processor function and an optional object of options.

```ts
new ItemQueue(processor, options);
```

All available options, along with their defaults, are shown below.

```ts
new ItemQueue(
    function(item) {
        // Process `item` here
    },
    {
        // Automatically start the queue after adding tasks
        autoStart: true,

        // Number of tasks that can run concurrently
        maxConcurrentTasks: 1,

        // Number of milliseconds to wait for tasks (0 to disable)
        defaultTimeout: 0,

        // Milliseconds to run tasks back-to-back before yielding to the event loop
        // Yielding lets promises settle and keeps your app responsive
        // 0 yields after every task, and false never yields
        // Defaults to 1 in Node and Bun, and 5 in browsers and Deno
        yieldInterval: 1
    }
);
```

In TypeScript, you can set the type of the items with a type parameter, such as `new ItemQueue<string>(...)`.

## Properties

### `ItemQueue.length`

**Type:** `Number`\
**Description:** The total number of active and pending tasks in the queue.

### `ItemQueue.active`

**Type:** `Boolean`\
**Description:** Whether or not this queue is currently running.

### `ItemQueue.options`

**Type:** `QueueOptions` (see constructor above)\
**Description:** The options for this queue. Changes to these options take effect for tasks that start afterwards.

### `ItemQueue.processor`

**Type:** `(item: T) => any`\
**Description:** The processor function for this queue. It can be replaced at any time, and the new processor will be used for items that start afterwards.

## Methods

### `ItemQueue.push(item, [options])`

**Returns:** `void`\
**Parameters:**
- `item: T` – The item to process.
- `options?: TaskOptions` – Optional object with custom options for this task (see [task options](#task-options)).
  - `timeout` (number) – Sets the timeout for this specific task.
  - `runImmediately` (boolean) – If true, the task starts right away, even if every slot is busy.

**Description:** Adds an item to the queue. If `autoStart` is enabled in the queue options, the queue will be started automatically.

### `ItemQueue.pushAsync(item, [options])`

**Returns:** `Promise<void>`\
**Parameters:**
- `item: T` – The item to process.
- `options?: TaskOptions` – Optional object with custom options for this task (see [task options](#task-options)).
  - `timeout` (number) – Sets the timeout for this specific task.
  - `runImmediately` (boolean) – If true, the task starts right away, even if every slot is busy.

**Description:** Adds an item to the queue. If `autoStart` is enabled in the queue options, the queue will be started automatically. Returns a promise which resolves once the item has been processed, and rejects with an `Error` if processing times out or fails. If the processor throws or rejects with something other than an `Error` (including `undefined`), the promise rejects with an `Error` that keeps the original value as its `cause`.

### `ItemQueue.start()`

**Returns:** `void`\
**Description:** Manually starts the queue, running up to `maxConcurrentTasks` tasks at once. This is not required if `autoStart` is set to true in the queue options. If the queue is stopping, the stop is cancelled and the queue keeps processing tasks.

### `ItemQueue.startAsync()`

**Returns:** `Promise<void>`\
**Description:** Manually starts the queue, and returns a promise which resolves once the queue has stopped. If the queue is already running, it returns a promise that resolves the next time the queue stops. If the queue isn't running and has no tasks, the promise resolves immediately. Like `start()`, this cancels a pending stop.

### `ItemQueue.stop()`

**Returns**: `void`\
**Description:** Gracefully stops the queue. Every running task is allowed to finish, but no new tasks will be started, even if they're pushed while the queue is stopping (including tasks pushed with `runImmediately`). The `stopped` event is emitted once the last running task finishes. Pending items stay in the queue until it's started again.

### `ItemQueue.stopAsync()`

**Returns:** `Promise<void>`\
**Description:** Gracefully stops the queue like `stop()`, and returns a promise which resolves once every running task has finished. If the queue isn't running, the promise resolves immediately.

### `ItemQueue.createGroup()`

**Returns:** [`QueueGroup<T>`](groups.md)\
**Description:** Creates and returns a new task group which uses this queue as its underlying processor. You can use task groups to work with and track separate groups of items while using the same underlying queue to process them.

### `ItemQueue.getCompletionPromise()`

**Returns:** `Promise<void>`\
**Description:** Returns a `Promise` which resolves once all tasks in the queue are completed. If the queue does not have any tasks, the promise will be resolved immediately.

### `ItemQueue.on(event, listener)` and `ItemQueue.once(event, listener)`

**Returns:** `this`\
**Description:** Listens for an [event](#events). Listeners added with `once` are removed after they're called for the first time.

### `ItemQueue.removeListener(event, listener)`

**Returns:** `void`\
**Description:** Removes a listener that was added with `on` or `once`.

### `ItemQueue.removeAllListeners([event])`

**Returns:** `void`\
**Description:** Removes every listener for the given event, or every listener for every event if no event is given.

## Task options

### Timeouts

When processing an item takes longer than its timeout (`timeout` in the task options, or `defaultTimeout` in the queue options), the queue emits `taskTimedOut`, rejects the task's promise with an `Error`, and frees its slot so the next item can start. The processor can't be interrupted, so it keeps running in the background, but its result is ignored.

### Running immediately

Items pushed with `runImmediately` start right away, ahead of other pending items, even if every slot is busy. If several of them are waiting (such as when `autoStart` is disabled), they start in the order they were pushed. While the queue is stopping, they wait like any other item.

## Yielding to the event loop

To keep your app responsive, the queue runs tasks back-to-back for up to `yieldInterval` milliseconds, and then yields to the event loop before continuing. This lets timers, I/O, and other code run while the queue works through many items, even when the processor is synchronous.

- `0` yields after every task, so each task's promise settles before the next task starts.
- A positive number of milliseconds runs tasks back-to-back until that much time has passed, and then yields once.
- `false` (or `Infinity`) never yields. This is the fastest, but the queue blocks the event loop until it's empty, and a task's promise might settle after the next task starts.

The default is `1` in Node and Bun, where yielding is very cheap, and `5` in browsers and Deno.

## Events

The following snippet is a list of events and their typed parameters.

```ts
interface Events {
    /**
     * Emitted when an item is added to the queue.
     */
    taskAdded: [item: T];

    /**
     * Emitted when the queue starts processing an item.
     */
    taskStarted: [item: T];

    /**
     * Emitted when an item is processed successfully.
     */
    taskCompleted: [item: T];

    /**
     * Emitted when processing an item timed out and it was
     * dropped from the queue.
     */
    taskTimedOut: [item: T];

    /**
     * Emitted when the processor threw an error or rejected.
     */
    taskFailed: [error: Error, item: T];

    /**
     * Emitted when an item has finished. If processing timed
     * out or failed, the error will be provided as the first
     * parameter.
     */
    taskFinished: [error: Error | undefined, item: T];

    /**
     * Emitted when the queue is started. If `autoStart` is
     * enabled, this means the queue has started processing new
     * data.
     */
    started: [];

    /**
     * Emitted when the queue is stopped, either manually or
     * because it has finished processing all tasks.
     */
    stopped: [];

    /**
     * Emitted when the queue has finished processing all tasks.
     * The `stopped` event will also be emitted after this.
     */
    finished: [];
};
```

You can listen for these events using the `on` and `once` methods. For example:

```ts
queue.on('started', function() {
    console.log('The queue has started.');
});

queue.on('taskFinished', function(error, item) {
    if (error) {
        console.error('Item failed:', error);
    }
    else {
        console.log('Item finished successfully!');
    }
});
```

If a listener throws an error, the queue and its other listeners carry on as normal. The error is rethrown asynchronously, so it's still reported as an uncaught exception.
