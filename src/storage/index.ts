import { DexieBackend } from './dexieBackend';
import { MemoryBackend } from './memoryBackend';
import { createStore } from './store';
import type { DataStore } from './types';

export * from './types';
export * from './schema';
export * from './ids';
export * from './errorTaxonomy';
export { createStore } from './store';
export { MemoryBackend } from './memoryBackend';
export { DexieBackend } from './dexieBackend';

export interface OpenResult {
  store: DataStore;
  /** 打开 IndexedDB 失败时的原因（此时使用的是临时内存存储，数据不会保留） */
  fallbackReason?: string;
}

/** 打开本机存储。IndexedDB 不可用（例如某些隐私模式）时退回临时内存存储，并说明原因 */
export async function openStore(dbName = 'english-lab'): Promise<OpenResult> {
  try {
    const backend = new DexieBackend(dbName);
    await backend.open();
    const store = createStore(backend, 'indexeddb', true);
    await store.getDeviceId(); // 试写一次，确认真的能写
    return { store };
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    return { store: createStore(new MemoryBackend(), 'memory', false), fallbackReason: reason };
  }
}

export type PersistState = 'granted' | 'denied' | 'unsupported';

/** 请求浏览器把本站数据标记为“持久”，降低被系统自动清理的可能。结果不保证，仅供提示 */
export async function requestPersistentStorage(): Promise<PersistState> {
  try {
    if (!navigator.storage?.persist) return 'unsupported';
    if (await navigator.storage.persisted()) return 'granted';
    return (await navigator.storage.persist()) ? 'granted' : 'denied';
  } catch {
    return 'unsupported';
  }
}
