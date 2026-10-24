/**
 * 导出文件的版本迁移。
 *
 * 规则：每次改变数据结构，SCHEMA_VERSION 加 1，并在 MIGRATIONS 里登记
 * “从 N 升到 N+1”的转换函数。导入旧文件时会按顺序自动逐级升级。
 * 比当前程序更新的文件一律拒绝（提示先更新程序），避免丢字段。
 */
import { SCHEMA_VERSION } from '../schema';

/** 输入输出都是整个文件的 JSON 对象（含 schemaVersion 和 data） */
export type Migration = (envelope: Record<string, unknown>) => Record<string, unknown>;

/** key = 起始版本。目前没有旧版本，所以是空的 */
export const MIGRATIONS: Record<number, Migration> = {};

export type MigrationResult =
  | { ok: true; envelope: Record<string, unknown>; migratedFrom: number | null }
  | { ok: false; error: string };

export function migrateEnvelope(
  envelope: Record<string, unknown>,
  target: number = SCHEMA_VERSION,
  migrations: Record<number, Migration> = MIGRATIONS,
): MigrationResult {
  const from = envelope.schemaVersion;
  if (typeof from !== 'number' || !Number.isInteger(from) || from < 0) {
    return { ok: false, error: '文件缺少有效的 schemaVersion（数据结构版本号）。' };
  }
  if (from > target) {
    return {
      ok: false,
      error: `这个文件来自更新的版本（数据结构版本 ${from}，当前程序只支持到 ${target}）。请先更新 English Lab 再导入，以免丢失字段。`,
    };
  }
  let cur = envelope;
  for (let v = from; v < target; v++) {
    const step = migrations[v];
    if (!step) {
      return { ok: false, error: `缺少从数据结构版本 ${v} 升级到 ${v + 1} 的迁移，无法导入这个文件。` };
    }
    try {
      cur = { ...step(cur), schemaVersion: v + 1 };
    } catch (e) {
      return { ok: false, error: `升级数据结构 ${v} → ${v + 1} 时出错：${e instanceof Error ? e.message : String(e)}` };
    }
  }
  return { ok: true, envelope: cur, migratedFrom: from === target ? null : from };
}
