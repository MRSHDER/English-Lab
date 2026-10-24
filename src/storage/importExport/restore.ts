import type { DataStore } from '../types';
import { parseImportText, type ParseResult } from './validate';

/** 读取本机某份备份，按导入同样的校验流程解析（之后走“预览 → 确认 → 替换”） */
export async function loadBackupAsImport(store: DataStore, backupId: string): Promise<ParseResult> {
  const payload = await store.backups.getPayload(backupId);
  if (payload === undefined) return { ok: false, errors: ['找不到这份备份。'] };
  return parseImportText(payload);
}
