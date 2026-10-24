import { PRIMARY_KEY, type Backend, type BackendTable, type LearningTables } from './backend';
import { StoreError } from './types';

const TABLES: BackendTable[] = [
  'attempts',
  'cards',
  'reviewLogs',
  'settings',
  'meta',
  'backups',
  'backupPayloads',
];

/** 内存版：数据只在当前页面存活。用于测试，以及 IndexedDB 不可用时的临时后备 */
export class MemoryBackend implements Backend {
  private tables = new Map<BackendTable, Map<string, unknown>>(
    TABLES.map((t) => [t, new Map<string, unknown>()]),
  );

  private t(table: BackendTable): Map<string, unknown> {
    return this.tables.get(table) as Map<string, unknown>;
  }

  private keyOf(table: BackendTable, record: unknown): string {
    return String((record as Record<string, unknown>)[PRIMARY_KEY[table]]);
  }

  async get(table: BackendTable, key: string) {
    const v = this.t(table).get(key);
    return v === undefined ? undefined : structuredClone(v);
  }

  async add(table: BackendTable, record: unknown) {
    const key = this.keyOf(table, record);
    if (this.t(table).has(key)) throw new StoreError('DUPLICATE', `${table} 中已存在 ID：${key}`);
    this.t(table).set(key, structuredClone(record));
  }

  async put(table: BackendTable, record: unknown) {
    this.t(table).set(this.keyOf(table, record), structuredClone(record));
  }

  async remove(table: BackendTable, key: string) {
    this.t(table).delete(key);
  }

  async all(table: BackendTable) {
    return [...this.t(table).values()].map((v) => structuredClone(v));
  }

  async replaceLearningTables(tables: LearningTables) {
    // 先在旁边构建好新数据，最后一次性换上，中途出错不会改动现有数据
    const built = new Map<BackendTable, Map<string, unknown>>();
    for (const name of ['attempts', 'cards', 'reviewLogs', 'settings'] as const) {
      const m = new Map<string, unknown>();
      for (const rec of tables[name]) {
        const key = this.keyOf(name, rec);
        if (m.has(key)) throw new StoreError('DUPLICATE', `${name} 中有重复 ID：${key}`);
        m.set(key, structuredClone(rec));
      }
      built.set(name, m);
    }
    for (const [name, m] of built) this.tables.set(name, m);
  }
}
