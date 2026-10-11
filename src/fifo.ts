/**
 * A first-in, first-out list with constant time `push()` and `shift()`.
 *
 * `Array.prototype.shift()` moves every remaining element, which makes draining a large array quadratic. This class
 * instead advances a head index, and only compacts the underlying array once the consumed portion makes up at least
 * half of it, so that each operation costs O(1) on average.
 *
 * Items must not be `undefined`, since `shift()` returns `undefined` when the list is empty.
 */
export class FifoQueue<T> {

	/**
	 * The minimum number of consumed slots before the underlying array is compacted, which avoids frequently copying
	 * small arrays.
	 */
	private static readonly _minCompactionSize = 1024;

	private _items: (T | undefined)[] = [];
	private _head = 0;

	/**
	 * The number of items in the list.
	 */
	public get length(): number {
		return this._items.length - this._head;
	}

	/**
	 * Adds an item to the end of the list.
	 *
	 * @param item
	 */
	public push(item: T) {
		this._items.push(item);
	}

	/**
	 * Removes and returns the item at the start of the list, or returns `undefined` if the list is empty.
	 */
	public shift(): T | undefined {
		if (this._head >= this._items.length) {
			return;
		}

		const item = this._items[this._head];

		// Release the reference so the item can be garbage collected
		this._items[this._head] = undefined;
		this._head++;

		// Start over with a fresh array once the list is empty
		if (this._head === this._items.length) {
			this._items = [];
			this._head = 0;
		}

		// Otherwise, discard the consumed slots once they make up at least half of the array
		else if (this._head >= FifoQueue._minCompactionSize && this._head * 2 >= this._items.length) {
			this._items = this._items.slice(this._head);
			this._head = 0;
		}

		return item;
	}

}
