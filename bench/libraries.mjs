import asyncLib from 'async';
import Bottleneck from 'bottleneck';
import fastq from 'fastq';
import pLimit from 'p-limit';
import PQueue from 'p-queue';
import Queue from 'queue';
import throat from 'throat';
import { FunctionQueue } from '../dist/index.js';

/**
 * Creates a synchronous task, which increments the counter.
 *
 * @param {{ value: number }} counter
 */
function syncTask(counter) {
	return () => {
		counter.value++;
	};
}

/**
 * Creates an asynchronous task, which increments the counter and returns a resolved promise.
 *
 * @param {{ value: number }} counter
 */
function asyncTask(counter) {
	return async () => {
		counter.value++;
	};
}

/**
 * Creates the task for the given kind.
 *
 * @param {'sync' | 'async'} kind
 * @param {{ value: number }} counter
 */
function createTask(kind, counter) {
	return kind === 'sync' ? syncTask(counter) : asyncTask(counter);
}

/**
 * Pushes a gate task followed by `n` tasks, and then opens the gate.
 *
 * The gate is an asynchronous task which occupies a slot until every task has been pushed. Without it, libraries that
 * start tasks as soon as they're pushed would run synchronous tasks to completion inside `push()`, and would never
 * hold a backlog. With it, every library starts with the same backlog of `n` pending tasks.
 *
 * @param {'sync' | 'async'} kind
 * @param {number} n
 * @param {{ value: number }} counter
 * @param {(task: () => unknown) => void} push A function which pushes a task to the library's queue.
 */
function fill(kind, n, counter, push) {
	let open;
	const gate = new Promise(resolve => open = resolve);

	push(() => gate);

	for (let i = 0; i < n; i++) {
		push(createTask(kind, counter));
	}

	open();
}

/**
 * Runs a task for a callback-style worker. Synchronous tasks call the callback synchronously, as the libraries'
 * documentation describes, while tasks that return a promise (such as the gate) call it once the promise settles.
 *
 * @param {() => unknown} task
 * @param {(error?: unknown) => void} callback
 */
function runWithCallback(task, callback) {
	const result = task();

	if (result instanceof Promise) {
		result.then(() => callback(null), callback);
	}
	else {
		callback(null);
	}
}

/**
 * A queue created by a library adapter.
 *
 * @typedef {object} AdapterQueue
 * @property {(task: () => unknown) => unknown} push Pushes a task, and returns whatever the library returns for it.
 * @property {() => Promise<unknown>} [wait] Waits for every task to finish using the library's own API. Libraries
 *   without one are awaited with `Promise.all()` over the promises returned by `push()` instead.
 */

/**
 * Describes a library under test.
 *
 * Each adapter creates a queue with the given concurrency, using the library's idiomatic API and no other options.
 * Every library queues task functions. Item-based libraries (fastq and async) receive the function as their item, and
 * their worker calls it.
 *
 * @typedef {object} Library
 * @property {string} name The name to show in results.
 * @property {string} pkg The npm package name, used to look up the version.
 * @property {(kind: 'sync' | 'async', concurrency: number) => AdapterQueue} create
 */

/**
 * The libraries to benchmark.
 *
 * @type {Library[]}
 */
export const libraries = [
	{
		name: '@baileyherbert/queue',
		pkg: '@baileyherbert/queue',
		create(kind, concurrency) {
			const queue = new FunctionQueue({ maxConcurrentTasks: concurrency });

			return {
				push: task => queue.push(task),
				wait: () => queue.getCompletionPromise()
			};
		}
	},
	{
		name: 'p-limit',
		pkg: 'p-limit',
		create(kind, concurrency) {
			const limit = pLimit(concurrency);

			return {
				push: task => limit(task)
			};
		}
	},
	{
		name: 'fastq',
		pkg: 'fastq',
		create(kind, concurrency) {
			// Synchronous work uses the callback API, and asynchronous work uses the promise API
			if (kind === 'sync') {
				const queue = fastq(runWithCallback, concurrency);
				const drained = new Promise(resolve => queue.drain = resolve);

				return {
					push: task => queue.push(task),
					wait: () => drained
				};
			}

			const queue = fastq.promise(task => task(), concurrency);

			return {
				push: task => queue.push(task),
				wait: () => queue.drained()
			};
		}
	},
	{
		name: 'async',
		pkg: 'async',
		create(kind, concurrency) {
			// Synchronous work uses a callback worker, and asynchronous work uses an async function worker
			const worker = kind === 'sync' ? runWithCallback : async task => task();
			const queue = asyncLib.queue(worker, concurrency);

			return {
				push: task => queue.push(task),
				wait: () => queue.drain()
			};
		}
	},
	{
		name: 'p-queue',
		pkg: 'p-queue',
		create(kind, concurrency) {
			const queue = new PQueue({ concurrency });

			return {
				push: task => queue.add(task),
				wait: () => queue.onIdle()
			};
		}
	},
	{
		name: 'queue',
		pkg: 'queue',
		create(kind, concurrency) {
			const queue = new Queue({ concurrency, autostart: false });

			return {
				// Synchronous jobs must call the callback, while asynchronous jobs can return a promise
				push: task => queue.push(kind === 'sync' ? callback => runWithCallback(task, callback) : task),

				// This queue must be started manually once the tasks are pushed
				wait: () => queue.start()
			};
		}
	},
	{
		name: 'throat',
		pkg: 'throat',
		create(kind, concurrency) {
			const limit = throat(concurrency);

			return {
				push: task => limit(task)
			};
		}
	},
	{
		name: 'bottleneck',
		pkg: 'bottleneck',
		create(kind, concurrency) {
			const limiter = new Bottleneck({ maxConcurrent: concurrency });

			return {
				push: task => limiter.schedule(task)
			};
		}
	}
];

/**
 * Runs `n` tasks through a library (behind a gate, see `fill()`), and returns a promise which resolves once every
 * task has finished.
 *
 * Libraries with their own completion API are awaited with it. For the others, the promises returned by `push()` are
 * normally awaited with `Promise.all()`. When measuring memory, those promises aren't kept, since the array holding
 * them would count against the library. Instead, the counter's `done` promise is awaited, which resolves when the
 * last task runs.
 *
 * @param {Library} library
 * @param {'sync' | 'async'} kind
 * @param {number} concurrency
 * @param {number} n
 * @param {{ value: number, done?: Promise<void> }} counter
 * @param {boolean} keepPromises Whether to keep the promises returned by `push()` for `Promise.all()`.
 */
export async function run(library, kind, concurrency, n, counter, keepPromises) {
	const queue = library.create(kind, concurrency);
	const promises = [];

	fill(kind, n, counter, task => {
		const result = queue.push(task);

		if (keepPromises && !queue.wait) {
			promises.push(result);
		}
	});

	if (queue.wait) {
		await queue.wait();
	}
	else if (keepPromises) {
		await Promise.all(promises);
	}
	else {
		await counter.done;
	}
}
