import 'fake-indexeddb/auto';
import { DexieBackend } from '../../src/storage/dexieBackend';
import { createStore } from '../../src/storage/store';

let n = 0;
/** 每次创建一个全新的、互相隔离的 IndexedDB 数据库（测试里由 fake-indexeddb 模拟） */
export async function makeDexieStore() {
  const backend = new DexieBackend(`test-db-${Date.now()}-${n++}`);
  await backend.open();
  return { backend, store: createStore(backend, 'indexeddb', true) };
}
