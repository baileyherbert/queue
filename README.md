# Queue

This package offers two different types of queues, an `ItemQueue` and a `FunctionQueue`, for running tasks with concurrency and timeouts. It's my personal replacement to the `queue` package and offers some cool features:

- ⌚ Working timeouts
- ✨ [Task groups](https://github.com/baileyherbert/queue/blob/master/docs/groups.md)

# Getting started

```
npm install @baileyherbert/queue
```

That's all you need. There are zero dependencies, not even `events` – and it works in modern browsers!

# Queues

Below are the two types of queues exported by this package. Scroll down further to see the API reference, which is the same for both queues.

## `FunctionQueue`

The `FunctionQueue` allows you to queue individual functions that will run once a slot is available.

```ts
import { FunctionQueue } from '@baileyherbert/queue';

const queue = new FunctionQueue();

queue.push(() => console.log('Do some work!'));
queue.push(() => console.log('Do some more work!'));
```

[**📚 Click here for `FunctionQueue` documentation.**](https://github.com/baileyherbert/queue/blob/master/docs/function_queue.md)

## `ItemQueue`

The `ItemQueue` accepts a single processor function and allows you to queue individual items that will be sent to that processor.

```ts
import { ItemQueue } from '@baileyherbert/queue';

const queue = new ItemQueue(function(str) {
	console.log(str);
});

queue.push('Do some work!');
queue.push('Do some more work!');
```

[**📚 Click here for `ItemQueue` documentation.**](https://github.com/baileyherbert/queue/blob/master/docs/item_queue.md)

## Task groups

Once you create a queue, you can spawn a task group using `queue.createGroup()`. This returns a wrapper around the queue that tracks a specific set of tasks. It offers the same methods and events as the queue itself, but only emits events for tasks added through the group. The original queue is still used to process the tasks.

```ts
const group = task.createGroup();
group.push('Do even more work!');

// The getCompletionPromise() returns a promise which resolves
// once all tasks in the group are done, even if the underlying
// queue is still busy with more tasks!
await group.getCompletionPromise();
```

[**📚 Click here for task group documentation.**](https://github.com/baileyherbert/queue/blob/master/docs/groups.md)
