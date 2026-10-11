# Benchmarks

These benchmarks compare this package against other popular queue libraries. The results are shown in the [main readme](../README.md#benchmarks).

## Running the benchmarks

Clone the repository, install its dependencies, and run:

```bash
npm run bench
```

This builds the package, benchmarks it against the libraries pinned in the `devDependencies` of [`package.json`](../package.json), and prints the results as markdown tables. It takes around 20 minutes, mostly because of libraries that are slow or hit the time limit.

To only run the time or memory scenarios, keeping the saved results for the others, run:

```bash
npm run bench -- --metric=memory
```

The raw results are saved to [`results.json`](results.json). To print the tables again from the saved results without re-running the benchmarks, such as after changing how they're formatted, run:

```bash
npm run bench:render
```

## How it's measured

- Every library starts with the same backlog. An asynchronous "gate" task is pushed first and holds a slot until every other task has been pushed. Without it, libraries that start tasks as soon as they're pushed would finish synchronous tasks inside `push()` and never hold a queue at all.
- Each library is used the way its documentation describes. Completion is awaited with the library's own API where it has one (`getCompletionPromise()`, `onIdle()`, `drained()`, `drain()`, and `start()`), or with `Promise.all()` over the promises it returns otherwise (p-limit, throat, and bottleneck).
- Callback-style libraries (fastq, async, and queue) call their callback synchronously for synchronous tasks.
- Each measurement runs in a fresh Node process after a warm-up run, and is stopped if it takes longer than 30 seconds. The median of 5 runs is reported.
- Peak memory is measured separately, in a fresh process without a warm-up run. Garbage is collected before the run, and the result is how far the process's peak memory (its resident set size) rose above its memory beforehand. Every library is given the same concurrency and no other options, and queues the same task functions (fastq and async receive them as items, and their workers call them). Libraries that return a promise for each task (p-limit, throat, and bottleneck) are normally awaited with `Promise.all()`, but the array holding those promises would count against them, so the promises aren't kept when measuring memory. Instead, the last task to run signals that the queue is done. Memory isn't measured with 10k tasks, since it only grows by a few megabytes, which is too close to the noise to compare.
- When a library fails or takes longer than 30 seconds while measuring memory, the memory it had used up to that point is shown as a lower bound, such as `≥ 2.19 GB`, since it would have used at least that much. For time outs, this is read from `/proc/<pid>/status` just before the worker is stopped, so it's only available on Linux. These failed runs are measured once rather than 5 times.
- This package is measured with its default settings. It runs tasks back-to-back for up to 1 millisecond (5 milliseconds in browsers) and then yields to the event loop, so that timers, I/O, and other work aren't held up while it works through a large queue. Most of the other libraries never yield, and block the event loop until their queue is empty.

## About the failures

- **Stack overflow:** fastq and queue start the next task from inside the previous task's callback, so a backlog of synchronous tasks recurses once per task.
- **Over 30 seconds (queue):** queue removes tasks with `Array.prototype.shift()`, which gets slower as the queue grows, so draining large queues takes quadratic time.
- **Over 30 seconds (bottleneck):** bottleneck's default in-memory store waits on `setTimeout()` several times for each task, so every task takes around 2 milliseconds regardless of concurrency.

## Files

- [`run.mjs`](run.mjs) runs every scenario and saves the results.
- [`worker.mjs`](worker.mjs) runs a single measurement in its own process.
- [`libraries.mjs`](libraries.mjs) has an adapter for each library, using its idiomatic API.
- [`render.mjs`](render.mjs) renders the results as markdown tables.
