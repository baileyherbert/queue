import { describe, expect, it } from 'vitest';
import { FifoQueue } from '../src/fifo';

describe('FifoQueue', () => {
	it('starts empty', () => {
		const list = new FifoQueue<number>();

		expect(list.length).toBe(0);
		expect(list.shift()).toBeUndefined();
	});

	it('returns items in the order they were pushed', () => {
		const list = new FifoQueue<string>();

		list.push('a');
		list.push('b');
		list.push('c');

		expect(list.length).toBe(3);
		expect(list.shift()).toBe('a');
		expect(list.shift()).toBe('b');
		expect(list.shift()).toBe('c');
		expect(list.shift()).toBeUndefined();
		expect(list.length).toBe(0);
	});

	it('can be reused after being emptied', () => {
		const list = new FifoQueue<number>();

		list.push(1);
		list.shift();
		list.push(2);

		expect(list.length).toBe(1);
		expect(list.shift()).toBe(2);
	});

	it('preserves order and length when interleaving pushes and shifts across compactions', () => {
		const list = new FifoQueue<number>();
		const shifted: number[] = [];
		let next = 0;

		// Each round consumes more than it adds, which passes the compaction threshold several times
		for (let round = 0; round < 10; round++) {
			for (let i = 0; i < 3000; i++) {
				list.push(next++);
			}

			for (let i = 0; i < 2500; i++) {
				shifted.push(list.shift()!);
			}

			expect(list.length).toBe(next - shifted.length);
		}

		while (list.length > 0) {
			shifted.push(list.shift()!);
		}

		expect(shifted).toEqual(Array.from({ length: next }, (_, i) => i));
	});
});
