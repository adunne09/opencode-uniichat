/** A min-heap; consumers can discard stale entries. */
export class Heap<A> {
  private items: A[] = [];
  constructor(private readonly compare: (a: A, b: A) => number) {}
  get size() { return this.items.length; }
  peek() { return this.items[0]; }
  push(value: A) {
    let at = this.items.length;
    this.items.push(value);
    while (at > 0) {
      const parent = Math.floor((at - 1) / 2);
      if (this.compare(this.items[parent]!, value) <= 0) break;
      this.items[at] = this.items[parent]!;
      at = parent;
    }
    this.items[at] = value;
  }
  pop(): A | undefined {
    const first = this.items[0], tail = this.items.pop();
    if (!this.items.length) return first;
    let at = 0;
    while (2 * at + 1 < this.items.length) {
      let child = 2 * at + 1;
      if (child + 1 < this.items.length && this.compare(this.items[child + 1]!, this.items[child]!) < 0) child++;
      if (this.compare(tail!, this.items[child]!) <= 0) break;
      this.items[at] = this.items[child]!;
      at = child;
    }
    this.items[at] = tail!;
    return first;
  }
}
