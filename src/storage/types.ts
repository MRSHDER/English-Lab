/**
 * 统一的数据访问接口。
 *
 * 页面和业务代码只能通过 DataStore 读写数据，不能直接碰 IndexedDB。
 * 这样以后接云同步、换存储方式，只需要新增一个实现，其他代码不用改。
 */
import type { Attempt, Card, ErrorTag, ReviewLog, SettingRow, Snapshot, TableName } from './schema';

export type StoreErrorCode =
  | 'VALIDATION' // 数据不符合格式
  | 'DUPLICATE' // ID 已存在
  | 'NOT_FOUND'
  | 'IMMUTABLE' // 试图修改不可变数据
  | 'UNAVAILABLE'; // 存储本身不可用

export class StoreError extends Error {
  constructor(
    readonly code: StoreErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'StoreError';
  }
}

export type BackupReason = 'pre-import' | 'pre-restore' | 'manual';

export interface BackupMeta {
  id: string;
  createdAt: string;
  reason: BackupReason;
  counts: Record<TableName, number>;
  sizeBytes: number;
}

export interface DataStore {
  /** indexeddb：保存在本机浏览器；memory：临时内存，刷新就没了（IndexedDB 不可用时的后备） */
  readonly kind: 'indexeddb' | 'memory';
  /** 数据是否会在刷新后保留 */
  readonly persistent: boolean;

  /** 本设备的固定编号，用于以后多设备同步时区分来源 */
  getDeviceId(): Promise<string>;

  attempts: {
    /** 新增一条作答；ID 重复会报错 */
    add(attempt: Attempt): Promise<void>;
    get(id: string): Promise<Attempt | undefined>;
    listAll(): Promise<Attempt[]>;
    listByItem(itemId: string): Promise<Attempt[]>;
    /** 作答里唯一允许事后修改的部分：错误标签（例如补充分类）。会更新 updatedAt */
    updateErrors(id: string, errors: ErrorTag[], nowIso?: string): Promise<Attempt>;
  };

  cards: {
    /** 新增或整体替换一张复习卡 */
    put(card: Card): Promise<void>;
    get(id: string): Promise<Card | undefined>;
    getByItem(itemId: string): Promise<Card | undefined>;
    listAll(): Promise<Card[]>;
    /** 到期（due <= beforeIso）且未暂停的卡，按到期时间从早到晚 */
    listDue(beforeIso: string): Promise<Card[]>;
  };

  reviewLogs: {
    /** 追加一条复习日志。日志不可修改、不可删除，接口里也没有这两个操作 */
    append(log: ReviewLog): Promise<void>;
    listAll(): Promise<ReviewLog[]>;
    listByCard(cardId: string): Promise<ReviewLog[]>;
  };

  settings: {
    get(key: string): Promise<SettingRow | undefined>;
    set(key: string, value: unknown, nowIso?: string): Promise<void>;
    listAll(): Promise<SettingRow[]>;
  };

  /** 导出全部学习数据（已排序，已校验） */
  exportSnapshot(): Promise<Snapshot>;
  /**
   * 用给定数据整体替换当前学习数据，要么全部成功要么完全不变（原子操作）。
   * 只应由导入流程在备份并获得用户确认后调用。
   */
  replaceAll(snapshot: Snapshot): Promise<void>;
  countRecords(): Promise<Record<TableName, number>>;
  /** 预留给云同步：返回 sinceIso 之后新增或修改的记录 */
  listChangedSince(sinceIso: string): Promise<Snapshot>;

  /** 本机备份（不属于学习数据，不会被导出，也不会被 replaceAll 清除） */
  backups: {
    save(meta: BackupMeta, payload: string): Promise<void>;
    list(): Promise<BackupMeta[]>; // 新的在前
    getPayload(id: string): Promise<string | undefined>;
    delete(id: string): Promise<void>;
  };
}

/**
 * 云同步适配器（仅预留接口，V1 不实现）。
 * 将来某个云服务实现这个接口，同步流程用 DataStore.listChangedSince 取本地变更，
 * 用 push 上传，用 pull 取回远端变更，再通过导入的合并规则写入本地。
 */
export interface SyncAdapter {
  readonly name: string;
  /** 取回 cursor 之后的远端变更；cursor 为 null 表示第一次 */
  pull(cursor: string | null): Promise<{ changes: Partial<Snapshot>; cursor: string }>;
  /** 上传本地变更 */
  push(changes: Partial<Snapshot>, cursor: string | null): Promise<{ cursor: string }>;
}
