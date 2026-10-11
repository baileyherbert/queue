# Function Queue

The `FunctionQueue` allows you to queue individual functions that will run once a slot is available.

```ts
import { FunctionQueue } from '@baileyherbert/queue';

const queue = new FunctionQueue();

queue.push(() => console.log('Do some work!'));
queue.push(() => console.log('Do some more work!'));
```

Functions can be synchronous, or return a promise. The queue waits for the promise to settle before the function's slot is freed.

# API

## Constructor

Create a new queue using the class constructor. All available options, along with their defaults, are shown below.

```ts
new FunctionQueue({
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
});
```

## Properties

### `FunctionQueue.length`

**Type:** `Number`\
**Description:** The total number of active and pending tasks in the queue.

### `FunctionQueue.active`

**Type:** `Boolean`\
**Description:** Whether or not this queue is currently running.

### `FunctionQueue.options`

**Type:** `QueueOptions` (see constructor above)\
**Description:** The options for this queue. Changes to these options take effect for tasks that start afterwards.

## Methods

### `FunctionQueue.push(fn, [options])`

**Returns:** `void`\
**Parameters:**
- `fn: FunctionTask` – The function to execute.
- `options?: TaskOptions` – Optional object with custom options for this task (see [task options](#task-options)).
  - `timeout` (number) – Sets the timeout for this specific task.
  - `runImmediately` (boolean) – If true, the task starts right away, even if every slot is busy.

**Description:** Adds a task function to the queue. If `autoStart` is enabled in the queue options, the queue will be started automatically.

### `FunctionQueue.pushAsync(fn, [options])`

**Returns:** `Promise<void>`\
**Parameters:**
- `fn: FunctionTask` – The function to execute.
- `options?: TaskOptions` – Optional object with custom options for this task (see [task options](#task-options)).
  - `timeout` (number) – Sets the timeout for this specific task.
  - `runImmediately` (boolean) – If true, the task starts right away, even if every slot is busy.

**Description:** Adds a task function to the queue. If `autoStart` is enabled in the queue options, the queue will be started automatically. Returns a promise which resolves once the task has finished, and rejects with an `Error` if the task times out or fails. If the task throws or rejects with something other than an `Error` (including `undefined`), the promise rejects with an `Error` that keeps the original value as its `cause`.

### `FunctionQueue.start()`

**Returns:** `void`\
**Description:** Manually starts the queue, running up to `maxConcurrentTasks` tasks at once. This is not required if `autoStart` is set to true in the queue options. If the queue is stopping, the stop is cancelled and the queue keeps processing tasks.

### `FunctionQueue.startAsync()`

**Returns:** `Promise<void>`\
**Description:** Manually starts the queue, and returns a promise which resolves once the queue has stopped. If the queue is already running, it returns a promise that resolves the next time the queue stops. If the queue isn't running and has no tasks, the promise resolves immediately. Like `start()`, this cancels a pending stop.

### `FunctionQueue.stop()`

**Returns**: `void`\
**Description:** Gracefully stops the queue. Every running task is allowed to finish, but no new tasks will be started, even if they're pushed while the queue is stopping (including tasks pushed with `runImmediately`). The `stopped` event is emitted once the last running task finishes. Pending tasks stay in the queue until it's started again.

### `FunctionQueue.stopAsync()`

**Returns:** `Promise<void>`\
**Description:** Gracefully stops the queue like `stop()`, and returns a promise which resolves once every running task has finished. If the queue isn't running, the promise resolves immediately.

### `FunctionQueue.createGroup()`

**Returns:** [`QueueGroup<FunctionTask>`](groups.md)\
**Description:** Creates and returns a new task group which uses this queue as its underlying processor. You can use task groups to work with and track separate groups of tasks while using the same underlying queue to process them.

### `FunctionQueue.getCompletionPromise()`

**Returns:** `Promise<void>`\
**Description:** Returns a `Promise` which resolves once all tasks in the queue are completed. If the queue does not have any tasks, the promise will be resolved immediately.

### `FunctionQueue.on(event, listener)` and `FunctionQueue.once(event, listener)`

**Returns:** `this`\
**Description:** Listens for an [event](#events). Listeners added with `once` are removed after they're called for the first time.

### `FunctionQueue.removeListener(event, listener)`

**Returns:** `void`\
**Description:** Removes a listener that was added with `on` or `once`.

### `FunctionQueue.removeAllListeners([event])`

**Returns:** `void`\
**Description:** Removes every listener for the given event, or every listener for every event if no event is given.

## Task options

### Timeouts

When a task takes longer than its timeout (`timeout` in the task options, or `defaultTimeout` in the queue options), the queue emits `taskTimedOut`, rejects the task's promise with an `Error`, and frees its slot so the next task can start. The task's function can't be interrupted, so it keeps running in the background, but its result is ignored.

### Running immediately

Tasks pushed with `runImmediately` start right away, ahead of other pending tasks, even if every slot is busy. If several of them are waiting (such as when `autoStart` is disabled), they start in the order they were pushed. While the queue is stopping, they wait like any other task.

## Yielding to the event loop

To keep your app responsive, the queue runs tasks back-to-back for up to `yieldInterval` milliseconds, and then yields to the event loop before continuing. This lets timers, I/O, and other code run while the queue works through many tasks, even synchronous ones.

- `0` yields after every task, so each task's promise settles before the next task starts.
- A positive number of milliseconds runs tasks back-to-back until that much time has passed, and then yields once.
- `false` (or `Infinity`) never yields. This is the fastest, but the queue blocks the event loop until it's empty, and a task's promise might settle after the next task starts.

The default is `1` in Node and Bun, where yielding is very cheap, and `5` in browsers and Deno.

## Events

The following snippet is a list of events and their typed parameters.

```ts
interface Events {
    /**
     * Emitted when a task is added to the queue.
     */
    taskAdded: [task: FunctionTask];

    /**
     * Emitted when the queue starts running a task.
     */
    taskStarted: [task: FunctionTask];

    /**
     * Emitted when a task is completed successfully.
     */
    taskCompleted: [task: FunctionTask];

    /**
     * Emitted when a task timed out and was dropped
     * from the queue.
     */
    taskTimedOut: [task: FunctionTask];

    /**
     * Emitted when a task threw an error or rejected.
     */
    taskFailed: [error: Error, task: FunctionTask];

    /**
     * Emitted when a task has finished. If the task timed out
     * or failed, the error will be provided as the first
     * parameter.
     */
    taskFinished: [error: Error | undefined, task: FunctionTask];

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

queue.on('taskFinished', function(error, task) {
    if (error) {
        console.error('Task failed:', error);
    }
    else {
        console.log('Task finished successfully!');
    }
});
```

If a listener throws an error, the queue and its other listeners carry on as normal. The error is rethrown asynchronously, so it's still reported as an uncaught exception.
