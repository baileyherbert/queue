/**
 * Schedules a callback to run in a future turn of the event loop, after pending promises have settled and other
 * queued work has had a chance to run.
 *
 * Unlike `setTimeout(callback, 0)`, this isn't subject to timer clamping (1ms in Node, and 4ms in browsers once
 * timers are nested), which would otherwise limit how many tasks a queue can start per second. It uses the first
 * available option:
 *
 * - `setImmediate` (Node and Bun)
 * - `MessageChannel` (browsers and Deno)
 * - `setTimeout` as a last resort
 *
 * The globals are looked up on each call rather than when the module loads, so that they can be replaced at runtime,
 * such as by fake timers in tests.
 *
 * @param callback The function to invoke.
 */
export function scheduleTick(callback: () => void) {
	const { setImmediate } = globalThis as { setImmediate?: (callback: () => void) => unknown; };

	if (typeof setImmediate === 'function') {
		setImmediate(callback);
		return;
	}

	if (typeof MessageChannel === 'function') {
		const channel = new MessageChannel();

		// Close the channel once it's used, since open ports can keep some runtimes alive
		channel.port1.onmessage = () => {
			channel.port1.close();
			callback();
		};

		channel.port2.postMessage(undefined);
		return;
	}

	setTimeout(callback, 0);
}
