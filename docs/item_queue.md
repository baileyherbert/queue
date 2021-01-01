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

# API

## Constructor

Create a new queue using the class constructor. All available options, along with their defaults, are shown below.

```ts
new Queue(fn, options);
```

```ts
new Queue(
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

	    // Run tasks internally with a small delay
	    // This helps your app run smoothly with compute-heavy tasks
	    // It also makes promises and events work in reliable orders
	    useAsyncTicking: true
	}
);
```

## Properties

### `Queue.length`

**Type:** `Number`\
**Description:** The total number of active and pending tasks in the queue.

### `Queue.active`

**Type:** `Boolean`\
**Description:** Whether or not this queue is currently running.

### `Queue.options`

**Type:** `QueueOptions` (see constructor above)\
**Description:** The options for this queue.

## Methods

### `Queue.push(item, [options])`

**Returns:** `void`\
**Parameters:**
- `item: T` – The item to process.
- `options?: TaskOptions` – Optional object with custom options for this task.
  - `timeout` (number) – Sets the timeout for this specific task.
  - `runImmediately` (boolean) – If true, the task always runs immediately.

**Description:** Adds an item to the queue. If `autoStart` is enabled in the queue options, the queue will be started automatically.

### `Queue.pushAsync(item, [options])`

**Returns:** `Promise<void>`\
**Parameters:**
- `item: T` – The item to process.
- `options?: TaskOptions` – Optional object with custom options for this task.
  - `timeout` (number) – Sets the timeout for this specific task.
  - `runImmediately` (boolean) – If true, the task always runs immediately.

**Description:** Adds an item to the queue. If `autoStart` is enabled in the queue options, the queue will be started automatically. Returns a promise which resolves once the task has executed, and rejects with an `Error` if the task times out or throws an error.

### `Queue.start()`

**Returns:** `void`\
**Description:** Manually starts the queue. This is not required if `autoStart` is set to true in the queue options.

### `Queue.startAsync()`

**Returns:** `Promise<void>`\
**Description:** Manually starts the queue, and returns a promise which resolves once the queue has stopped. If the queue is running, it still returns a promise, but does nothing more.

### `Queue.stop()`

**Returns**: `void`\
**Description:** Gracefully stops the queue. All active tasks will be allowed to finish, but no new tasks will be started.

### `Queue.stopAsync()`

**Returns:** `Promise<void>`\
**Description:** Gracefully stops the queue, and returns a promise which resolves once complete. All active tasks will be allowed to finish, but no new tasks will be started.

### `Queue.createGroup()`

**Returns:** [`QueueGroup<T>`](groups.md)\
**Description:** Creates and returns a new task group which uses this queue as its underlying processor. You can use task groups to work with and track separate groups of items while using the same underlying queue to process them.

### `Queue.getCompletionPromise()`

**Returns:** `Promise<void>`\
**Description:** Returns a `Promise` which resolves once all tasks in the queue are completed. If the queue does not have any tasks, the promise will be resolved immediately.

## Events

The following snippet is a list of events and their typed parameters.

```ts
interface Events {
	/**
	 * Emitted when an item is added to the queue.
	 */
    taskAdded: [item: T];

    /**
     * Emitted when the queue starts running a task.
     */
    taskStarted: [item: T];

    /**
     * Emitted when a task is completed successfully.
     */
    taskCompleted: [item: T];

    /**
     * Emitted when a task timed out and was dropped
     * from the queue.
     */
    taskTimedOut: [item: T];

    /**
     * Emitted when a task threw an error.
     */
    taskFailed: [error: Error, item: T];

    /**
     * Emitted when a task has finished. If the task timed out
     * or threw an error, the error will be provided as the
     * first parameter.
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

You can listen for this events using the `on` and `once` methods. For example:

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
