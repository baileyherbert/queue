# Queue

This is a modern queue class for running functions with a concurrency limit. It's very similar to the `queue` package, but it uses promises, offers more options, and has working timeouts.

# Example

```ts
import { Queue } from '@baileyherbert/queue';

const queue = new Queue({
	concurrency: 2,
	defaultTimeout: 60000
});

for (let i = 1; i <= 10; i++) {
	queue.push(async function() {
		console.log('Task', i);
		await new Promise(r => setTimeout(r, 1000));
	});
}
```

# Getting started

```
npm install @baileyherbert/queue
```

That's all you need. This package does not have any dependencies, not even `events`, and it works in browsers!

# API

## Constructor

Create a new queue using the class constructor. All available options, along with their defaults, are shown below.

```ts
new Queue({
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
});
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

### `Queue.push(fn, [options])`

**Returns:** `void`\
**Parameters:**
- `fn: TaskFunction` – The function to execute.
- `options?: TaskOptions` – Optional object with custom options for this task.
  - `timeout` (number) – Sets the timeout for this specific task.
  - `runImmediately` (boolean) – If true, the task always runs immediately.

**Description:** Adds a task function to the queue. If `autoStart` is enabled in the queue options, the queue will be started automatically.

### `Queue.pushAsync(fn, [options])`

**Returns:** `Promise<void>`\
**Parameters:**
- `fn: TaskFunction` – The function to execute.
- `options?: TaskOptions` – Optional object with custom options for this task.
  - `timeout` (number) – Sets the timeout for this specific task.
  - `runImmediately` (boolean) – If true, the task always runs immediately.

**Description:** Adds a task function to the queue. If `autoStart` is enabled in the queue options, the queue will be started automatically. Returns a promise which resolves once the task has executed, and rejects with an `Error` if the task times out or throws an error.

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

## Events

The following snippet is a list of events and their typed parameters.

```ts
interface Events {
	/**
	 * Emitted when the queue starts running a task.
	 */
	taskStarted: [task: TaskFunction];

	/**
	 * Emitted when a task is completed successfully.
	 */
	taskCompleted: [task: TaskFunction];

	/**
	 * Emitted when a task timed out and was dropped
	 * from the queue.
	 */
	taskTimedOut: [task: TaskFunction];

	/**
	 * Emitted when a task threw an error.
	 */
	taskFailed: [error: Error, task: TaskFunction];

	/**
	 * Emitted when a task has finished. If the task timed out
	 * or threw an error, the error will be provided as the
	 * first parameter.
	 */
	taskFinished: [error: Error | undefined, task: TaskFunction];

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

queue.on('taskFinished', function(error, task) {
	if (error) {
		console.error('Task failed:', error);
	}
	else {
		console.log('Task finished successfully!');
	}
});
```
