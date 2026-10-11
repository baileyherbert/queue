/**
 * Benchmarks this package against other popular queue libraries, and prints the results as markdown tables.
 *
 * Usage: npm run bench [-- --metric=<time|memory>]
 *
 * With `--metric`, only the scenarios for that metric are run, and their results replace the saved ones in
 * `bench/results.json` while the other scenarios are kept.
 *
 * Each measurement runs in a fresh process (see `worker.mjs`) with a time limit, and the median of several runs is
 * reported. Scenarios measure either time or peak memory. Failures such as stack overflows, time outs, and lost tasks
 * are reported in place of a result. The raw results are also saved to `bench/results.json`, and can be rendered
 * again with `npm run bench:render`.
 */
import { execSync, spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { fileURLToPath } from 'node:url';
import { libraries } from './libraries.mjs';
import { formatResultValue, formatSize, render } from './render.mjs';

/**
 * The number of runs per measurement. The median is reported.
 */
const RUNS = 5;

/**
 * The maximum time a single run can take before it's reported as too slow, in milliseconds.
 */
const TIME_LIMIT = 30000;

/**
 * The numbers of tasks to benchmark speed with.
 */
const SIZES = [10000, 100000, 1000000];

/**
 * The numbers of tasks to benchmark memory with. Memory grows by only a few megabytes with fewer tasks, which is
 * too close to the noise to compare.
 */
const MEMORY_SIZES = [100000, 1000000];

/**
 * The scenarios to benchmark.
 */
const SCENARIOS = [
	{ title: 'Asynchronous tasks, concurrency 1', metric: 'time', kind: 'async', concurrency: 1, sizes: SIZES },
	{ title: 'Asynchronous tasks, concurrency 16', metric: 'time', kind: 'async', concurrency: 16, sizes: SIZES },
	{ title: 'Synchronous tasks, concurrency 1', metric: 'time', kind: 'sync', concurrency: 1, sizes: SIZES },
	{
		title: 'Peak memory, asynchronous tasks, concurrency 16',
		description: 'How much memory the process used at its peak while working through the queue, above what it used beforehand. Lower is better.',
		metric: 'memory',
		kind: 'async',
		concurrency: 16,
		sizes: MEMORY_SIZES
	}
];

/**
 * The metric to benchmark from `--metric=<time|memory>`, or `undefined` to benchmark every scenario.
 */
const onlyMetric = process.argv.find(arg => arg.startsWith('--metric='))?.slice('--metric='.length);

if (onlyMetric !== undefined && onlyMetric !== 'time' && onlyMetric !== 'memory') {
	throw new Error(`Expected --metric to be "time" or "memory", got "${onlyMetric}"`);
}

const workerPath = fileURLToPath(new URL('./worker.mjs', import.meta.url));
const resultsPath = fileURLToPath(new URL('./results.json', import.meta.url));

/**
 * Describes a scenario to benchmark.
 *
 * @typedef {object} Scenario
 * @property {string} title
 * @property {string} [description] Text to show under the title, if any.
 * @property {'time' | 'memory'} metric
 * @property {'sync' | 'async'} kind
 * @property {number} concurrency
 * @property {number[]} sizes
 */

/**
 * Returns the peak memory (resident set size) of a running process in bytes, or `undefined` if it can't be read.
 * This reads `VmHWM` from `/proc/<pid>/status`, so it only works on Linux.
 *
 * @param {number} pid
 */
function readPeakMemory(pid) {
	try {
		const status = readFileSync(`/proc/${pid}/status`, 'utf8');
		const match = /^VmHWM:\s+(\d+) kB$/m.exec(status);

		return match ? Number(match[1]) * 1024 : undefined;
	}
	catch {
		return undefined;
	}
}

/**
 * Runs a single measurement in a new process. Memory is measured with `--expose-gc`, so that the worker can collect
 * garbage before taking its baseline.
 *
 * If the worker takes longer than the time limit, it's stopped and reported as a time out. When measuring memory,
 * the worker's peak memory so far is read just before stopping it, so the result still shows how much memory it had
 * used by then. The worker can't report this itself, since some libraries block its event loop.
 *
 * @param {number} index The index of the library in `libraries`.
 * @param {Scenario} scenario
 * @param {number} n The number of tasks.
 * @returns {Promise<{ ms: number } | { bytes: number } | { error: string, bytes?: number }>}
 */
function runOnce(index, scenario, n) {
	const flags = scenario.metric === 'memory' ? ['--expose-gc'] : [];
	const args = [...flags, workerPath, index, scenario.kind, scenario.concurrency, n, scenario.metric];

	return new Promise(resolve => {
		const child = spawn(process.execPath, args);
		let stdout = '';
		let stderr = '';
		let timedOut;

		child.stdout.setEncoding('utf8').on('data', data => stdout += data);
		child.stderr.setEncoding('utf8').on('data', data => stderr += data);

		const timer = setTimeout(() => {
			timedOut = { error: 'timeout' };

			if (scenario.metric === 'memory') {
				const peak = readPeakMemory(child.pid);
				const baseline = parseLines(stdout).find(line => 'baseline' in line)?.baseline;

				if (peak !== undefined && baseline !== undefined) {
					timedOut.bytes = Math.max(0, peak - baseline);
				}
			}

			child.kill('SIGKILL');
		}, TIME_LIMIT);

		child.on('close', (status, signal) => {
			clearTimeout(timer);

			if (timedOut) {
				return resolve(timedOut);
			}

			const result = parseLines(stdout).find(line => !('baseline' in line));

			if (result) {
				return resolve(result);
			}

			if (/heap out of memory/i.test(stderr)) {
				return resolve({ error: 'out of memory' });
			}

			// Node exits with code 13 when top-level await never settles, meaning the queue never finished
			if (status === 13) {
				return resolve({ error: 'never finished' });
			}

			resolve({ error: `crashed (exit code ${status ?? signal})` });
		});
	});
}

/**
 * Parses the JSON lines printed by a worker.
 *
 * @param {string} output
 * @returns {Array<Record<string, any>>}
 */
function parseLines(output) {
	return output.split('\n').filter(line => line.startsWith('{')).map(line => JSON.parse(line));
}

/**
 * Runs a measurement several times and returns the median, or the first failure.
 *
 * @param {number} index
 * @param {Scenario} scenario
 * @param {number} n
 * @returns {Promise<{ ms: number } | { bytes: number } | { error: string, bytes?: number }>}
 */
async function measure(index, scenario, n) {
	const key = scenario.metric === 'memory' ? 'bytes' : 'ms';
	const values = [];

	for (let i = 0; i < RUNS; i++) {
		const result = await runOnce(index, scenario, n);

		if ('error' in result) {
			return result;
		}

		values.push(result[key]);
	}

	values.sort((a, b) => a - b);
	return { [key]: values[Math.floor(values.length / 2)] };
}

/**
 * Returns the installed version of a package. For this package, the current commit is included as well, with a
 * `-dirty` suffix if the source has uncommitted changes.
 *
 * @param {string} pkg
 */
function getVersion(pkg) {
	const isSelf = pkg === '@baileyherbert/queue';
	const path = isSelf ? '../package.json' : `../node_modules/${pkg}/package.json`;
	const { version } = JSON.parse(readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8'));

	if (isSelf) {
		const commit = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
		const isDirty = execSync('git status --porcelain -- src', { encoding: 'utf8' }).trim() !== '';

		return `${version} (${commit}${isDirty ? '-dirty' : ''})`;
	}

	return version;
}

const output = {
	date: new Date().toISOString().slice(0, 10),
	node: process.version,
	cpu: cpus()[0]?.model.trim(),
	runs: RUNS,
	timeLimit: TIME_LIMIT,
	versions: Object.fromEntries(libraries.map(library => [library.pkg, getVersion(library.pkg)])),
	scenarios: []
};

for (const scenario of SCENARIOS.filter(scenario => !onlyMetric || scenario.metric === onlyMetric)) {
	const rows = [];

	for (const [index, library] of libraries.entries()) {
		const results = [];

		for (const n of scenario.sizes) {
			const result = await measure(index, scenario, n);
			results.push(result);

			const bytes = 'error' in result && result.bytes !== undefined ? ` (${formatResultValue({ bytes: result.bytes })})` : '';
			console.error(`${scenario.title} | ${library.name} | ${formatSize(n)} | ${'error' in result ? result.error + bytes : formatResultValue(result)}`);
		}

		rows.push({ name: library.name, pkg: library.pkg, results });
	}

	output.scenarios.push({ ...scenario, rows });
}

// When only some scenarios were run, keep the saved results for the others
if (onlyMetric) {
	const saved = JSON.parse(readFileSync(resultsPath, 'utf8'));

	output.scenarios = SCENARIOS
		.map(scenario => [...output.scenarios, ...saved.scenarios].find(result => result.title === scenario.title))
		.filter(Boolean);
}

writeFileSync(resultsPath, JSON.stringify(output, null, '\t') + '\n');

console.log(render(output));
console.log(`Node ${output.node} on ${output.cpu}, median of ${RUNS} runs, ${output.date}.`);
