import Dexie, { type Table } from 'dexie';
import type { Backend, BackendTable, LearningTables } from './backend';
import { StoreError } from './types';

/**
 * IndexedDB 数据库定义。
 * 以后要增加表或字段：新增 this.version(2).stores({...}).upgrade(...)，
 * 不要修改 version(1)，Dexie 会按顺序自动升级旧数据。详见 docs/MIGRATIONS.md。
 */
export class LabDB extends Dexie {
  attempts!: Table<unknown, string>;
  cards!: Table<unknown, string>;
  reviewLogs!: Table<unknown, string>;
  settings!: Table<unknown, string>;
  meta!: Table<unknown, string>;
  backups!: Table<unknown, string>;
  backupPayloads!: Table<unknown, string>;
  /** 只有导入/恢复（replaceLearningTables）进行期间为 true，此时才允许清空复习日志 */
  allowLogRewrite = false;

  constructor(name: string) {
    super(name);
    this.version(1).stores({
      attempts: 'id, itemId, topicId, answeredAt, updatedAt',
      cards: 'id, itemId, updatedAt, fsrs.due',
      reviewLogs: 'id, cardId, itemId, reviewedAt, createdAt',
      settings: 'key, updatedAt',
      meta: 'key',
      backups: 'id, createdAt',
      backupPayloads: 'id',
    });
    // 第二道防线：即使有人绕过 DataStore 直接改库，复习日志也拒绝被修改或删除
    this.reviewLogs.hook('updating', () => {
      throw new StoreError('IMMUTABLE', '复习日志不可修改');
    });
    this.reviewLogs.hook('deleting', () => {
      if (!this.allowLogRewrite) throw new StoreError('IMMUTABLE', '复习日志不可删除');
    });
  }
}

export class DexieBackend implements Backend {
  readonly db: LabDB;

  constructor(dbName: string) {
    this.db = new LabDB(dbName);
  }

  async open(): Promise<void> {
    await this.db.open();
  }

  close(): void {
    this.db.close();
  }

  async get(table: BackendTable, key: string) {
    return this.db.table(table).get(key);
  }

  async add(table: BackendTable, record: unknown) {
    try {
      await this.db.table(table).add(record);
    } catch (e) {
      if ((e as { name?: string }).name === 'ConstraintError') {
        throw new StoreError('DUPLICATE', `${table} 中已存在相同 ID`);
      }
      throw e;
    }
  }

  async put(table: BackendTable, record: unknown) {
    await this.db.table(table).put(record);
  }

  async remove(table: BackendTable, key: string) {
    await this.db.table(table).delete(key);
  }

  async all(table: BackendTable) {
    return this.db.table(table).toArray();
  }

  async replaceLearningTables(tables: LearningTables) {
    const { attempts, cards, reviewLogs, settings } = this.db;
    // 一个事务：任何一步失败，整个事务回滚，现有数据保持不变
    this.db.allowLogRewrite = true;
    try {
      await this.db.transaction('rw', [attempts, cards, reviewLogs, settings], async () => {
        await Promise.all([attempts.clear(), cards.clear(), reviewLogs.clear(), settings.clear()]);
        await attempts.bulkAdd(tables.attempts);
        await cards.bulkAdd(tables.cards);
        await reviewLogs.bulkAdd(tables.reviewLogs);
        await settings.bulkAdd(tables.settings);
      });
    } finally {
      this.db.allowLogRewrite = false;
    }
  }
}
