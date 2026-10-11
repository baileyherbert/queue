/**
 * Renders benchmark results as markdown tables.
 *
 * Usage: npm run bench:render
 *
 * This is used by `run.mjs` after benchmarking, and can also be run on its own to render the tables from the saved
 * results in `bench/results.json` without benchmarking again.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Describes a single measurement, which is a time, an amount of memory, or a failure. Failures when measuring memory
 * can include the peak memory used before the failure as `bytes`.
 *
 * @typedef {{ ms: number } | { bytes: number } | { error: string, bytes?: number }} Result
 */

/**
 * Describes the saved benchmark results.
 *
 * @typedef {object} Results
 * @property {number} timeLimit The maximum time a run could take, in milliseconds.
 * @property {Array<{ title: string, description?: string, sizes: number[], rows: Array<{ name: string, pkg: string, results: Result[] }> }>} scenarios
 */

/**
 * The name of this package, whose rows are compared when deciding which results to highlight.
 */
const SELF = '@baileyherbert/queue';

/**
 * Formats a duration for display.
 *
 * @param {number} ms
 */
export function formatTime(ms) {
	if (ms < 10) {
		return `${ms.toFixed(1)} ms`;
	}

	if (ms < 1000) {
		return `${Math.round(ms)} ms`;
	}

	return `${(ms / 1000).toFixed(ms < 10000 ? 2 : 1)} s`;
}

/**
 * Formats an amount of memory for display, in megabytes or gigabytes.
 *
 * @param {number} bytes
 */
export function formatBytes(bytes) {
	const megabytes = bytes / 1e6;

	if (megabytes < 10) {
		return `${megabytes.toFixed(1)} MB`;
	}

	if (megabytes < 1000) {
		return `${Math.round(megabytes)} MB`;
	}

	return `${(bytes / 1e9).toFixed(2)} GB`;
}

/**
 * Formats a successful result for display, as either a time or an amount of memory.
 *
 * @param {{ ms: number } | { bytes: number }} result
 */
export function formatResultValue(result) {
	return 'bytes' in result ? formatBytes(result.bytes) : formatTime(result.ms);
}

/**
 * Returns the value of a successful result for comparison, or `undefined` for a failure.
 *
 * @param {Result} result
 */
function getValue(result) {
	if ('error' in result) {
		return undefined;
	}

	return 'bytes' in result ? result.bytes : result.ms;
}

/**
 * Formats a number of tasks for display.
 *
 * @param {number} n
 */
export function formatSize(n) {
	return n >= 1000000 ? `${n / 1000000}M` : `${n / 1000}k`;
}

/**
 * Formats a result for display in a table cell. Highlighted results are shown in bold.
 *
 * @param {Result} result
 * @param {boolean} isHighlighted
 * @param {number} timeLimit
 */
function formatResult(result, isHighlighted, timeLimit) {
	if ('error' in result) {
		const errors = {
			'timeout': `⏱️ Over ${timeLimit / 1000} s`,
			'stack overflow': '❌ Stack overflow',
			'never finished': '❌ Never finished',
			'out of memory': '❌ Out of memory'
		};

		const error = result.error.startsWith('Error: only') ? '❌ Lost tasks' : errors[result.error] ?? `❌ ${result.error}`;

		// Show the memory used before the failure as a lower bound, since the run didn't finish
		if (result.bytes !== undefined) {
			return `≥ ${formatBytes(result.bytes)}`;
		}

		return error;
	}

	return isHighlighted ? `**${formatResultValue(result)}**` : formatResultValue(result);
}

/**
 * Returns the rows to highlight in a column. This is the best (lowest) result, along with the second best when this
 * package takes both first and second place.
 *
 * @param {Array<{ pkg: string, results: Result[] }>} rows
 * @param {number} column
 */
function getHighlightedRows(rows, column) {
	const ranked = rows
		.filter(row => getValue(row.results[column]) !== undefined)
		.sort((a, b) => getValue(a.results[column]) - getValue(b.results[column]));

	if (ranked[0]?.pkg === SELF && ranked[1]?.pkg === SELF) {
		return new Set(ranked.slice(0, 2));
	}

	return new Set(ranked.slice(0, 1));
}

/**
 * Renders the results as markdown, with a table for each scenario.
 *
 * @param {Results} results
 */
export function render(results) {
	const lines = [];

	for (const scenario of results.scenarios) {
		lines.push(`## ${scenario.title}`, '');

		if (scenario.description) {
			lines.push(scenario.description, '');
		}
		lines.push(`| Library | ${scenario.sizes.map(n => `${formatSize(n)} tasks`).join(' | ')} |`);
		lines.push(`| --- | ${scenario.sizes.map(() => '--:').join(' | ')} |`);

		const highlighted = scenario.sizes.map((_, i) => getHighlightedRows(scenario.rows, i));

		for (const row of scenario.rows) {
			const cells = row.results.map((result, i) => formatResult(result, highlighted[i].has(row), results.timeLimit));

			lines.push(`| ${row.name} | ${cells.join(' | ')} |`);
		}

		lines.push('');
	}

	return lines.join('\n');
}

// Render the saved results when run directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const resultsPath = fileURLToPath(new URL('./results.json', import.meta.url));
	console.log(render(JSON.parse(readFileSync(resultsPath, 'utf8'))));
}
