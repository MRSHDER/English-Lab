/**
 * 导入计划：先“预览”（只计算，不写入），用户确认后才“执行”。
 *
 * 两种模式：
 *  - merge（合并，默认）：保留本机已有数据，把文件里的新记录加进来。
 *    同一个 ID 内容不同时：复习日志永远保留本机的；其他记录以 updatedAt 较新的为准，
 *    相同或本机较新则保留本机。
 *  - replace（替换）：数据整体变成文件里的样子，本机多出来的记录会被删除。
 *
 * 执行前一定先备份；执行后会核对结果，不一致则自动回滚到执行前的数据。
 */
import { canonicalStringify, sha256Hex } from '../canonical';
import {
  keyOf,
  sortSnapshot,
  TABLE_NAMES,
  type ExportFile,
  type Snapshot,
  type TableName,
} from '../schema';
import type { BackupMeta, BackupReason, DataStore } from '../types';
import { createBackup } from './backup';

export type ImportMode = 'merge' | 'replace';

export interface TableDiff {
  /** 文件里的记录数 */
  incoming: number;
  /** 本机现有记录数 */
  existing: number;
  /** 本机没有、将新增的 */
  added: number;
  /** 两边完全相同的 */
  identical: number;
  /** 本机已有但内容不同，将被文件里的版本覆盖 */
  updated: number;
  /** 本机已有但内容不同，保留本机版本（合并模式） */
  keptLocal: number;
  /** 本机有、文件没有，将被删除（替换模式） */
  removed: number;
}

export interface ImportPreview {
  exportedAt: string;
  deviceId: string;
  appVersion: string;
  schemaVersion: number;
  /** 文件里作答记录的时间范围 */
  attemptRange: { from: string; to: string } | null;
  /** 最近 5 条作答的摘要，用来确认这是你想导入的数据 */
  sampleAttempts: Array<{ answeredAt: string; prompt: string; answer: string; outcome: string }>;
}

export interface ImportPlan {
  mode: ImportMode;
  tables: Record<TableName, TableDiff>;
  warnings: string[];
  preview: ImportPreview;
  /** 执行后本机数据的完整样子 */
  result: Snapshot;
  /** 预览时本机数据与文件内容的指纹；执行时若本机数据已变化则要求重新预览 */
  fingerprint: string;
}

export class ImportError extends Error {
  constructor(
    readonly code: 'NOT_CONFIRMED' | 'STALE_PLAN' | 'BACKUP_FAILED' | 'WRITE_FAILED' | 'VERIFY_FAILED',
    message: string,
  ) {
    super(message);
    this.name = 'ImportError';
  }
}

export interface ImportResult {
  backup: BackupMeta;
  counts: Record<TableName, number>;
}

type AnyRecord = { id?: string; key?: string; updatedAt?: string };

function diffTable(
  table: TableName,
  mode: ImportMode,
  local: AnyRecord[],
  incoming: AnyRecord[],
): { rows: AnyRecord[]; diff: TableDiff; conflictIds: string[] } {
  const localMap = new Map(local.map((r) => [keyOf(table, r), r]));
  const incomingMap = new Map(incoming.map((r) => [keyOf(table, r), r]));
  const diff: TableDiff = {
    incoming: incoming.length,
    existing: local.length,
    added: 0,
    identical: 0,
    updated: 0,
    keptLocal: 0,
    removed: 0,
  };
  const conflictIds: string[] = [];
  const out = new Map<string, AnyRecord>(mode === 'merge' ? localMap : []);

  for (const [key, inc] of incomingMap) {
    const loc = localMap.get(key);
    if (!loc) {
      out.set(key, inc);
      diff.added += 1;
    } else if (canonicalStringify(loc) === canonicalStringify(inc)) {
      out.set(key, loc);
      diff.identical += 1;
    } else if (mode === 'replace') {
      out.set(key, inc);
      diff.updated += 1;
    } else if (table !== 'reviewLogs' && (inc.updatedAt ?? '') > (loc.updatedAt ?? '')) {
      out.set(key, inc);
      diff.updated += 1;
    } else {
      diff.keptLocal += 1;
      if (table === 'reviewLogs') conflictIds.push(key);
    }
  }
  if (mode === 'replace') {
    for (const key of localMap.keys()) if (!incomingMap.has(key)) diff.removed += 1;
  }
  return { rows: [...out.values()], diff, conflictIds };
}

async function fingerprintOf(local: Snapshot, file: ExportFile, mode: ImportMode): Promise<string> {
  return sha256Hex(`${mode}|${canonicalStringify(local)}|${canonicalStringify(file.data)}`);
}

export async function buildImportPlan(
  store: DataStore,
  file: ExportFile,
  mode: ImportMode = 'merge',
): Promise<ImportPlan> {
  const local = await store.exportSnapshot();
  const tables = {} as Record<TableName, TableDiff>;
  const resultRaw = { attempts: [], cards: [], reviewLogs: [], settings: [] } as Snapshot;
  const warnings: string[] = [];

  for (const t of TABLE_NAMES) {
    const { rows, diff, conflictIds } = diffTable(
      t,
      mode,
      local[t] as AnyRecord[],
      file.data[t] as AnyRecord[],
    );
    tables[t] = diff;
    (resultRaw[t] as unknown[]) = rows;
    if (conflictIds.length > 0) {
      warnings.push(`有 ${conflictIds.length} 条复习日志与本机同 ID 但内容不同，已保留本机版本（复习日志不可被覆盖）。`);
    }
  }
  const result = sortSnapshot(resultRaw);

  if (mode === 'replace') {
    const lost = TABLE_NAMES.reduce((n, t) => n + tables[t].removed, 0);
    const overwritten = TABLE_NAMES.reduce((n, t) => n + tables[t].updated, 0);
    if (lost > 0) warnings.push(`替换模式会删除本机 ${lost} 条文件里没有的记录。`);
    if (overwritten > 0) warnings.push(`替换模式会用文件内容覆盖本机 ${overwritten} 条已有记录。`);
  }
  const cardIds = new Set(result.cards.map((c) => c.id));
  const orphanLogs = result.reviewLogs.filter((l) => !cardIds.has(l.cardId)).length;
  if (orphanLogs > 0) warnings.push(`有 ${orphanLogs} 条复习日志找不到对应的复习卡（日志仍会保留）。`);

  const attempts = [...file.data.attempts].sort((a, b) => (a.answeredAt < b.answeredAt ? -1 : 1));
  const preview: ImportPreview = {
    exportedAt: file.exportedAt,
    deviceId: file.deviceId,
    appVersion: file.appVersion,
    schemaVersion: file.schemaVersion,
    attemptRange: attempts.length
      ? { from: (attempts[0] as { answeredAt: string }).answeredAt, to: (attempts[attempts.length - 1] as { answeredAt: string }).answeredAt }
      : null,
    sampleAttempts: attempts
      .slice(-5)
      .reverse()
      .map((a) => ({
        answeredAt: a.answeredAt,
        prompt: a.promptSnapshot.slice(0, 80),
        answer: a.userAnswer.slice(0, 80),
        outcome: a.outcome,
      })),
  };

  return { mode, tables, warnings, preview, result, fingerprint: await fingerprintOf(local, file, mode) };
}

export interface ApplyOptions {
  /** 必须显式传 true。界面上对应用户勾选确认并点击“开始导入” */
  confirmed: boolean;
  backupReason?: BackupReason;
  /** 导入文件本身，用于重新核对指纹（防止预览之后本机数据又变了） */
  file: ExportFile;
}

export async function applyImport(
  store: DataStore,
  plan: ImportPlan,
  opts: ApplyOptions,
): Promise<ImportResult> {
  if (opts.confirmed !== true) {
    throw new ImportError('NOT_CONFIRMED', '导入需要你明确确认，已取消，数据未改动。');
  }

  const before = await store.exportSnapshot();
  if ((await fingerprintOf(before, opts.file, plan.mode)) !== plan.fingerprint) {
    throw new ImportError('STALE_PLAN', '预览之后本机数据发生了变化，请重新选择文件并预览。数据未改动。');
  }

  // 先备份；备份失败就中止，绝不在没有备份的情况下改数据
  let backup: BackupMeta;
  try {
    backup = await createBackup(store, opts.backupReason ?? 'pre-import');
  } catch (e) {
    throw new ImportError(
      'BACKUP_FAILED',
      `导入前备份失败，已中止，数据未改动：${e instanceof Error ? e.message : String(e)}`,
    );
  }

  try {
    await store.replaceAll(plan.result);
  } catch (e) {
    throw new ImportError(
      'WRITE_FAILED',
      `写入失败，数据保持原样：${e instanceof Error ? e.message : String(e)}`,
    );
  }

  // 核对：写进去的必须和计划一致，否则回滚到导入前
  const after = await store.exportSnapshot();
  if (canonicalStringify(after) !== canonicalStringify(sortSnapshot(plan.result))) {
    try {
      await store.replaceAll(before);
    } catch {
      /* 回滚失败时，导入前备份仍在本机备份列表里，可手动恢复 */
    }
    throw new ImportError('VERIFY_FAILED', '导入后核对不一致，已自动恢复到导入前的数据。');
  }

  return { backup, counts: await store.countRecords() };
}
