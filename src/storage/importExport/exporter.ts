import { APP_VERSION } from '../../version';
import { canonicalStringify, sha256Hex } from '../canonical';
import { EXPORT_FORMAT, SCHEMA_VERSION, type ExportFile, type Snapshot } from '../schema';
import type { DataStore } from '../types';

export async function snapshotChecksum(data: Snapshot): Promise<string> {
  return sha256Hex(canonicalStringify(data));
}

/** 把当前全部学习数据打包成导出文件（含校验码） */
export async function buildExportFile(store: DataStore, now: Date = new Date()): Promise<ExportFile> {
  const data = await store.exportSnapshot();
  return {
    format: EXPORT_FORMAT,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: now.toISOString(),
    appVersion: APP_VERSION,
    deviceId: await store.getDeviceId(),
    data,
    checksum: { algorithm: 'sha-256', value: await snapshotChecksum(data) },
  };
}

export function serializeExport(file: ExportFile): string {
  return JSON.stringify(file, null, 2);
}

/** english-lab-backup-20261022-044100.json（用北京时间之外的本地时间也可以，这里用本地时间便于识别） */
export function exportFilename(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
  return `english-lab-backup-${stamp}.json`;
}
