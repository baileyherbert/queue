# Task Groups

A task group is a wrapper on top of a queue. You can add tasks to this group with the `push()` and `pushAsync()` methods, just like a regular queue, and can listen for events such as `taskStarted` on it as well. The main advantage of groups is that they only track tasks which are added through their interface.

- A single queue can have an unlimited number of groups.
- Adding tasks to the group sends them to the underlying queue.
- The group only emits events for its own tasks, and not tasks from other groups or the root queue.
- The group's `length` property only tracks its own tasks, too!

Groups offer a `getCompletionPromise()` method which resolves once all tasks in the group are finished. If the group is not running any tasks when it's called, it resolves immediately. This makes it very easy to wait for a small group of tasks to finish, without worrying about other irrelevant tasks in the queue.

```ts
const group1 = queue.createGroup();
const group2 = queue.createGroup();

queue.on('taskFinished', item => console.log('Queue:', item));

group1.on('taskFinished', item => console.log('Group1:', item));
group2.on('taskFinished', item => console.log('Group2:', item));

group1.push('This was added to group1.');
group2.push('This was added to group2.');
```

The above example will output:

```
Queue: This was added to group1.
Group1: This was added to group1.

Queue: This was added to group2.
Group2: This was added to group2.
```

# API

## Properties

### `QueueGroup.length`

**Type:** `Number`\
**Description:** The total number of active and pending tasks in the group.

### `QueueGroup.active`

**Type:** `Boolean`\
**Description:** Whether or not this group is active. This will always be `true` unless you explicitly call `destroy()` on the group.

## Methods

### `QueueGroup.push(item, [options])`

**Returns:** `void`\
**Parameters:**
- `item: T` – The item to process.
- `options?: TaskOptions` – Optional object with custom options for this task.
  - `timeout` (number) – Sets the timeout for this specific task.
  - `runImmediately` (boolean) – If true, the task always runs immediately.

**Description:** Adds an item to the queue. If `autoStart` is enabled in the queue options, the queue will be started automatically.

### `QueueGroup.pushAsync(item, [options])`

**Returns:** `Promise<void>`\
**Parameters:**
- `item: T` – The item to process.
- `options?: TaskOptions` – Optional object with custom options for this task.
  - `timeout` (number) – Sets the timeout for this specific task.
  - `runImmediately` (boolean) – If true, the task always runs immediately.

**Description:** Adds an item to the queue. If `autoStart` is enabled in the queue options, the queue will be started automatically. Returns a promise which resolves once the task has executed, and rejects with an `Error` if the task times out or throws an error.

### `QueueGroup.getCompletionPromise()`

**Returns:** `Promise<void>`\
**Description:** Returns a `Promise` which resolves once all tasks in the group are completed. If the group does not have any tasks, the promise will be resolved immediately.

### `QueueGroup.destroy()`

**Returns**: `void`\
**Description:** Detaches the group from the queue. All pending and outstanding tasks will still execute, but no further events will be emitted, and `active` will be set to false.

## Events

The following snippet is a list of events and their typed parameters.

```ts
interface Events {
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
};
```

You can listen for this events using the `on` and `once` methods. For example:

```ts
group.on('taskFinished', function(error, task) {
    if (error) {
        console.error('Item failed:', error);
    }
    else {
        console.log('Item finished successfully!');
    }
});
```
