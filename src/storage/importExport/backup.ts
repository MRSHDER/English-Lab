import { newRecordId } from '../ids';
import type { BackupMeta, BackupReason, DataStore } from '../types';
import { buildExportFile, serializeExport } from './exporter';

/** 本机最多保留的备份份数，超出后删除最旧的 */
export const MAX_BACKUPS = 10;

/** 把当前数据完整备份到本机（和导出文件同一格式）。失败会抛出错误，调用方必须据此中止后续操作 */
export async function createBackup(
  store: DataStore,
  reason: BackupReason,
  now: Date = new Date(),
): Promise<BackupMeta> {
  const file = await buildExportFile(store, now);
  const payload = serializeExport(file);
  const meta: BackupMeta = {
    id: newRecordId('bak', now.getTime()),
    createdAt: now.toISOString(),
    reason,
    counts: {
      attempts: file.data.attempts.length,
      cards: file.data.cards.length,
      reviewLogs: file.data.reviewLogs.length,
      settings: file.data.settings.length,
    },
    sizeBytes: new TextEncoder().encode(payload).length,
  };
  await store.backups.save(meta, payload);
  await pruneBackups(store);
  return meta;
}

export async function pruneBackups(store: DataStore, keep: number = MAX_BACKUPS): Promise<void> {
  const all = await store.backups.list(); // 新的在前
  for (const old of all.slice(keep)) await store.backups.delete(old.id);
}
