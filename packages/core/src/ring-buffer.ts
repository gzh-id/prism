/**
 * 定长环形缓冲区 —— 面包屑的存储结构
 *
 * 为什么不用普通数组 + push/slice：
 * 面包屑是高频写入的（每次点击、每个请求都写一条），如果用数组，
 * 每写满一次就要 slice 丢掉最老的，会产生大量临时数组，触发频繁 GC。
 * 环形缓冲用定长数组 + 一个写指针，写入永远是 O(1)，且零内存分配。
 *
 * 为什么容量要设上限：
 * 无上限的话，一个长时间挂着的页面会把内存吃光。定长 20 条意味着
 * 「最多回溯用户报错前的 20 个操作」，这个数量对排障已经够用。
 */
export class RingBuffer<T> {
  private readonly items: Array<T | undefined>;
  private writeIndex = 0;
  private filled = 0;

  constructor(private readonly capacity: number) {
    this.items = new Array<T | undefined>(capacity);
  }

  /** 写入一条。写满后自动覆盖最老的那条 */
  push(item: T): void {
    this.items[this.writeIndex] = item;
    this.writeIndex = (this.writeIndex + 1) % this.capacity;
    if (this.filled < this.capacity) {
      this.filled += 1;
    }
  }

  /** 按时间正序返回（最老的在前），看板时间轴依赖这个顺序 */
  toArray(): T[] {
    const start = this.filled < this.capacity ? 0 : this.writeIndex;
    const out: T[] = [];
    for (let i = 0; i < this.filled; i += 1) {
      const item = this.items[(start + i) % this.capacity];
      if (item !== undefined) {
        out.push(item);
      }
    }
    return out;
  }

  get size(): number {
    return this.filled;
  }

  clear(): void {
    this.items.fill(undefined);
    this.writeIndex = 0;
    this.filled = 0;
  }
}
