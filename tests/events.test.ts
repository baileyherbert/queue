import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from '../src/events';

/**
 * An emitter that exposes its protected methods for testing.
 */
class TestEmitter extends EventEmitter<{ test: [value: number]; other: []; }> {
	public emit(value: number) {
		this._emit('test', value);
	}

	public hasListeners(event: 'test' | 'other') {
		return this._hasListeners(event);
	}
}

describe('EventEmitter', () => {
	it('reports whether an event has listeners', () => {
		const emitter = new TestEmitter();
		const listener = vi.fn();

		expect(emitter.hasListeners('test')).toBe(false);

		emitter.on('test', listener);
		expect(emitter.hasListeners('test')).toBe(true);
		expect(emitter.hasListeners('other')).toBe(false);

		emitter.removeListener('test', listener);
		expect(emitter.hasListeners('test')).toBe(false);

		emitter.once('test', listener);
		expect(emitter.hasListeners('test')).toBe(true);

		emitter.emit(1);
		expect(emitter.hasListeners('test')).toBe(false);
	});

	it('calls once listeners when every other listener has been removed', () => {
		const emitter = new TestEmitter();
		const removed = vi.fn();
		const once = vi.fn();

		emitter.on('test', removed);
		emitter.removeListener('test', removed);
		emitter.once('test', once);

		emitter.emit(1);

		expect(removed).not.toHaveBeenCalled();
		expect(once).toHaveBeenCalledExactlyOnceWith(1);
	});

	it('calls listeners that were added after emitting with no listeners', () => {
		const emitter = new TestEmitter();
		const listener = vi.fn();

		emitter.emit(1);
		emitter.on('test', listener);
		emitter.emit(2);

		expect(listener).toHaveBeenCalledExactlyOnceWith(2);
	});

	it('does not call removed listeners', () => {
		const emitter = new TestEmitter();
		const listener = vi.fn();

		emitter.on('test', listener);
		emitter.removeListener('test', listener);
		emitter.emit(1);

		expect(listener).not.toHaveBeenCalled();
	});
});
