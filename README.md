# Queue

This package offers two different types of queues, an `ItemQueue` and a `FunctionQueue`, for running tasks with concurrency and timeouts. It's my personal replacement to the `queue` package and offers some cool features:

- ⌚ Working timeouts
- ⏳ Non-blocking by default for synchronous tasks
- 🚀 [Extremely fast regardless of scale](#benchmarks)
- ✨ [Task groups](https://github.com/baileyherbert/queue/blob/master/docs/groups.md)

# Getting started

```bash
npm install @baileyherbert/queue
```

That's all you need. There are zero dependencies, not even `events` – and it works in modern browsers!

This package requires Node 22.12 or newer. It's an ES module, but CommonJS projects can still load it with `require()`.

# Queues

Below are the two types of queues exported by this package. They share the same options, methods, and events, which are covered in each queue's documentation.

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
const group = queue.createGroup();
group.push('Do even more work!');

// The getCompletionPromise() returns a promise which resolves
// once all tasks in the group are done, even if the underlying
// queue is still busy with more tasks!
await group.getCompletionPromise();
```

[**📚 Click here for task group documentation.**](https://github.com/baileyherbert/queue/blob/master/docs/groups.md)

## Yielding to the event loop

Queues run tasks back-to-back for up to 1 millisecond (5 milliseconds in browsers), and then yield to the event loop before continuing. This lets timers, I/O, and the rest of your app keep running while a queue works through thousands of tasks, even when those tasks are synchronous.

You can change how often a queue yields with the `yieldInterval` option:

```ts
// Yield after every task, so each task's promise settles before the next task starts
const steadyQueue = new FunctionQueue({ yieldInterval: 0 });

// Never yield, which is slightly faster but blocks the event loop until the queue is empty
const fastQueue = new FunctionQueue({ yieldInterval: false });
```

# Benchmarks

Below is a comparison of how long this package takes to work through a queue of tasks, compared to the popular and mainstream queue packages. Lower is better.

By default, this package yields to the event loop between tasks, which helps keep the rest of your application responsive when the queue is running synchronous functions. The benchmarks below are measured with this default behavior.

## Asynchronous tasks, concurrency 1

| Library | 10k tasks | 100k tasks | 1M tasks |
| --- | --: | --: | --: |
| @baileyherbert/queue | **4.8 ms** | **31 ms** | **202 ms** |
| p-limit | 16 ms | 156 ms | 1.79 s |
| fastq | 6.1 ms | 89 ms | 855 ms |
| async | 11 ms | 102 ms | 895 ms |
| p-queue | 18 ms | 122 ms | 1.13 s |
| queue | 8.6 ms | 2.18 s | ⏱️ Over 30 s |
| throat | 5.9 ms | 55 ms | 412 ms |
| bottleneck | 22.5 s | ⏱️ Over 30 s | ⏱️ Over 30 s |

## Asynchronous tasks, concurrency 16

| Library | 10k tasks | 100k tasks | 1M tasks |
| --- | --: | --: | --: |
| @baileyherbert/queue | **5.2 ms** | **29 ms** | **166 ms** |
| p-limit | 15 ms | 165 ms | 1.79 s |
| fastq | 6.9 ms | 104 ms | 998 ms |
| async | 11 ms | 101 ms | 855 ms |
| p-queue | 19 ms | 120 ms | 1.15 s |
| queue | 8.7 ms | 2.20 s | ⏱️ Over 30 s |
| throat | 6.2 ms | 58 ms | 435 ms |
| bottleneck | 22.5 s | ⏱️ Over 30 s | ⏱️ Over 30 s |

## Synchronous tasks, concurrency 1

| Library | 10k tasks | 100k tasks | 1M tasks |
| --- | --: | --: | --: |
| @baileyherbert/queue | **3.7 ms** | **26 ms** | **187 ms** |
| p-limit | 16 ms | 158 ms | 1.64 s |
| fastq | ❌ Stack overflow | ❌ Stack overflow | ❌ Stack overflow |
| async | 10 ms | 92 ms | 802 ms |
| p-queue | 19 ms | 117 ms | 1.22 s |
| queue | ❌ Stack overflow | ❌ Stack overflow | ❌ Stack overflow |
| throat | 5.9 ms | 53 ms | 412 ms |
| bottleneck | 22.5 s | ⏱️ Over 30 s | ⏱️ Over 30 s |

## Peak memory, asynchronous tasks, concurrency 16

How much memory the process used at its peak while working through the queue, above what it used beforehand. Lower is better.

| Library | 100k tasks | 1M tasks |
| --- | --: | --: |
| @baileyherbert/queue | **48 MB** | **264 MB** |
| p-limit | 186 MB | 953 MB |
| fastq | 140 MB | 897 MB |
| async | 163 MB | 660 MB |
| p-queue | 180 MB | 1.31 GB |
| queue | 52 MB | ≥ 266 MB |
| throat | 89 MB | 596 MB |
| bottleneck | ≥ 508 MB | ≥ 2.19 GB |

Measured with Node v24.12.0 on an AMD Ryzen 9 9950X3D (Linux, WSL2) on 2026-10-11, using the median of 5 runs against our `FunctionQueue` class. The other libraries' versions are pinned in [`package.json`](https://github.com/baileyherbert/queue/blob/master/package.json). See the [benchmark readme](https://github.com/baileyherbert/queue/tree/master/bench) for how the benchmarks work, what causes the failures, and how to run them yourself.

# Upgrading from v2

Version 3 includes the following breaking changes:

- The package is now an ES module and requires Node 22.12 or newer. CommonJS projects can still load it with `require()`.
- The `useAsyncTicking` option has been replaced with `yieldInterval`. Use `yieldInterval: 0` in place of `useAsyncTicking: true`, and `yieldInterval: false` in place of `useAsyncTicking: false`.
- By default, queues now yield to the event loop every millisecond instead of after every task. As a result, a task's promise may not settle before the next task starts. Set `yieldInterval: 0` if you rely on that order.
- Errors thrown by event listeners no longer affect the queue. They're rethrown asynchronously instead, so they're still reported as uncaught exceptions.
- Tasks that throw or reject with something other than an `Error` now fail with an `Error` that keeps the original value as its `cause`. Rejecting with `undefined` now counts as a failure.

# Development

Install the dependencies, and then use these scripts:

```bash
npm run dev        # Run the tests in watch mode
npm test           # Run the tests once
npm run typecheck  # Type-check the source and tests
npm run build      # Build the package into dist/
npm run bench      # Run the benchmarks (takes around 20 minutes)
```
