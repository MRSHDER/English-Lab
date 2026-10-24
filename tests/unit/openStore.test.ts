// 这个文件刻意不引入 fake-indexeddb：模拟浏览器没有 IndexedDB 的情况
import { describe, expect, it } from 'vitest';
import { openStore } from '../../src/storage';

describe('openStore 后备机制', () => {
  it('IndexedDB 不可用时退回内存存储，并给出原因（不会假装能保存）', async () => {
    const { store, fallbackReason } = await openStore('no-idb');
    expect(store.kind).toBe('memory');
    expect(store.persistent).toBe(false);
    expect(fallbackReason).toBeTruthy();
    expect(await store.getDeviceId()).toMatch(/^dev_/); // 内存存储依然可用
  });
});
