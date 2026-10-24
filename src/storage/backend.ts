/**
 * 最底层的“按表存取”接口。
 * DataStore 的全部业务规则（校验、不可变日志、到期查询……）只写一份在 store.ts，
 * 底层只需实现这几个简单操作。内存版和 IndexedDB 版因此行为完全一致。
 */
export type BackendTable =
  | 'attempts'
  | 'cards'
  | 'reviewLogs'
  | 'settings'
  | 'meta'
  | 'backups'
  | 'backupPayloads';

export type LearningTables = Pick<
  Record<BackendTable, unknown[]>,
  'attempts' | 'cards' | 'reviewLogs' | 'settings'
>;

export interface Backend {
  get(table: BackendTable, key: string): Promise<unknown | undefined>;
  /** 新增；键已存在时抛 StoreError('DUPLICATE') */
  add(table: BackendTable, record: unknown): Promise<void>;
  /** 新增或替换 */
  put(table: BackendTable, record: unknown): Promise<void>;
  remove(table: BackendTable, key: string): Promise<void>;
  all(table: BackendTable): Promise<unknown[]>;
  /** 原子地清空并重写四张学习数据表（要么全成功，要么完全不变） */
  replaceLearningTables(tables: LearningTables): Promise<void>;
}

/** 每张表的主键字段名 */
export const PRIMARY_KEY: Record<BackendTable, string> = {
  attempts: 'id',
  cards: 'id',
  reviewLogs: 'id',
  settings: 'key',
  meta: 'key',
  backups: 'id',
  backupPayloads: 'id',
};
