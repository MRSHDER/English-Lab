// 必须最先引入：它会先装好模拟的 IndexedDB，之后才能加载 Dexie
import { makeDexieStore } from './dexieHelper';
import { DexieBackend } from '../../src/storage/dexieBackend';
import { describe, expect, it } from 'vitest';
import { MemoryBackend } from '../../src/storage/memoryBackend';
import { createStore } from '../../src/storage/store';
import { log } from './helpers';
import { storeContract } from './storeContract';

storeContract('内存实现', async () => createStore(new MemoryBackend(), 'memory', false));
storeContract('IndexedDB 实现（fake-indexeddb）', async () => (await makeDexieStore()).store);

describe('IndexedDB 额外防线', () => {
  it('绕过 DataStore 直接改库，复习日志也不能被修改或删除', async () => {
    const { backend, store } = await makeDexieStore();
    await store.reviewLogs.append(log(1));
    await expect(backend.db.reviewLogs.put({ ...log(1), rating: 1 })).rejects.toThrow();
    await expect(backend.db.reviewLogs.delete(log(1).id)).rejects.toThrow();
    expect((await store.reviewLogs.listAll())[0]?.rating).toBe(3);
  });

  it('数据在重新打开数据库后仍然存在（模拟刷新页面）', async () => {
    const name = `reopen-${Date.now()}`;
    const first = new DexieBackend(name);
    await first.open();
    const s1 = createStore(first, 'indexeddb', true);
    await s1.reviewLogs.append(log(1));
    const dev = await s1.getDeviceId();
    first.close();

    const second = new DexieBackend(name);
    await second.open();
    const s2 = createStore(second, 'indexeddb', true);
    expect((await s2.reviewLogs.listAll()).length).toBe(1);
    expect(await s2.getDeviceId()).toBe(dev);
  });
});
