/**
 * Runs a single benchmark measurement in its own process, and prints the result as a line of JSON.
 *
 * Usage: node --expose-gc bench/worker.mjs <library index> <sync|async> <concurrency> <tasks> <time|memory>
 *
 * The result is `{ "ms": number }` when measuring time, `{ "bytes": number }` when measuring memory, or
 * `{ "error": string }`. If the process ends without printing a result (for example, if the queue never finishes and
 * the event loop empties), the runner treats it as a failure.
 *
 * When measuring memory, the baseline is printed first as `{ "baseline": number }`, so that the runner can work out
 * how much memory was used if it has to stop the worker. Failures include the peak memory used before the failure as
 * `bytes`.
 */
import { libraries, run } from './libraries.mjs';

const [indexArg, kind, concurrencyArg, nArg, mode] = process.argv.slice(2);
const library = libraries[Number(indexArg)];
const concurrency = Number(concurrencyArg);
const n = Number(nArg);

/**
 * The process's memory before the run, in bytes, once it has been measured.
 *
 * @type {number | undefined}
 */
let baseline;

/**
 * Returns how far the process's peak memory has risen above the baseline, in bytes.
 */
function getPeakAboveBaseline() {
	// The peak resident set size is reported in kilobytes
	return Math.max(0, process.resourceUsage().maxRSS * 1024 - (baseline ?? 0));
}

/**
 * Reports a failure. When measuring memory, the peak memory used before the failure is included.
 *
 * @param {unknown} error
 */
function fail(error) {
	report(baseline === undefined ? { error: describe(error) } : { error: describe(error), bytes: getPeakAboveBaseline() });
}

/**
 * Prints the result and exits, so that pending timers or stray work from a failed queue can't change the outcome.
 *
 * @param {{ ms: number } | { bytes: number } | { error: string, bytes?: number }} result
 */
function report(result) {
	console.log(JSON.stringify(result));
	process.exit(0);
}

/**
 * Describes an error thrown or rejected by a library, using short names for common failures.
 *
 * @param {unknown} error
 */
function describe(error) {
	if (error instanceof RangeError && /call stack/i.test(error.message)) {
		return 'stack overflow';
	}

	return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

// Errors can escape the queue entirely, such as a stack overflow thrown from a callback
process.on('uncaughtException', fail);
process.on('unhandledRejection', fail);

/**
 * Throws if any of the tasks didn't run.
 *
 * @param {{ value: number }} counter
 * @param {number} count
 */
function assertAllRan(counter, count) {
	if (counter.value !== count) {
		throw new Error(`only ${counter.value} of ${count} tasks ran`);
	}
}

/**
 * Runs the library with the given number of tasks, and returns the elapsed time in milliseconds.
 *
 * @param {number} count
 */
async function measureTime(count) {
	const counter = { value: 0 };
	const start = performance.now();

	await run(library, kind, concurrency, count, counter, true);

	const elapsed = performance.now() - start;
	assertAllRan(counter, count);

	return elapsed;
}

/**
 * Creates a task counter with a `done` promise that resolves once the given number of tasks have run.
 *
 * @param {number} count
 */
function createCountingCounter(count) {
	let value = 0;
	let resolve;
	const done = new Promise(r => resolve = r);

	return {
		done,
		get value() {
			return value;
		},
		set value(newValue) {
			value = newValue;

			if (value === count) {
				resolve();
			}
		}
	};
}

/**
 * Runs the library with the given number of tasks, and returns how much the process's peak memory (resident set
 * size) grew above its memory before the run, in bytes.
 *
 * Garbage is collected before taking the baseline, so it only includes memory that's still in use. The promises
 * returned by libraries aren't kept (see `run()`), so the result only includes memory used by the library itself
 * and the tasks.
 *
 * @param {number} count
 */
async function measureMemory(count) {
	const counter = createCountingCounter(count);

	globalThis.gc();
	globalThis.gc();

	baseline = process.memoryUsage().rss;
	console.log(JSON.stringify({ baseline }));

	await run(library, kind, concurrency, count, counter, false);
	assertAllRan(counter, count);

	return getPeakAboveBaseline();
}

try {
	if (mode === 'memory') {
		// Memory is measured without a warm-up, since the JIT doesn't affect it and a warm-up run could set the peak
		report({ bytes: await measureMemory(n) });
	}
	else {
		// Warm up the JIT with a small run first
		await measureTime(1000);
		report({ ms: await measureTime(n) });
	}
}
catch (error) {
	fail(error);
}
