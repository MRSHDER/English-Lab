/**
 * 导入文件的解析与校验。
 * 原则：任何一处有问题，整个文件都不接受（不做“部分导入”），并告诉你具体错在哪。
 */
import { canonicalStringify } from '../canonical';
import {
  exportEnvelopeSchema,
  keyOf,
  TABLE_NAMES,
  TABLE_SCHEMAS,
  type ExportFile,
  type Snapshot,
  type TableName,
} from '../schema';
import { snapshotChecksum } from './exporter';
import { migrateEnvelope, type Migration } from './migrations';
import { MIGRATIONS } from './migrations';

export const MAX_IMPORT_BYTES = 20 * 1024 * 1024; // 20 MB
const MAX_REPORTED_ERRORS = 20;

export type ParseResult =
  | {
      ok: true;
      file: ExportFile;
      warnings: string[];
      /** 文件原来的数据结构版本；没有发生升级时为 null */
      migratedFrom: number | null;
    }
  | { ok: false; errors: string[] };

export interface ParseOptions {
  maxBytes?: number;
  migrations?: Record<number, Migration>;
  targetVersion?: number;
}

function fail(...errors: string[]): ParseResult {
  return { ok: false, errors };
}

export async function parseImportText(text: string, opts: ParseOptions = {}): Promise<ParseResult> {
  const maxBytes = opts.maxBytes ?? MAX_IMPORT_BYTES;
  // 用字符数近似；中文字符多时实际字节更大，UI 层还会检查 File.size
  if (text.length > maxBytes) {
    return fail(`文件太大（超过 ${Math.round(maxBytes / 1024 / 1024)} MB），已拒绝。`);
  }

  // 1. 必须是合法 JSON
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return fail(`不是有效的 JSON 文件：${e instanceof Error ? e.message : String(e)}`);
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return fail('文件内容应该是一个 JSON 对象。');
  }
  const original = raw as Record<string, unknown>;

  if (original.format !== 'english-lab-export') {
    return fail('这不是 English Lab 的导出文件（format 字段不对）。');
  }

  // 2. 校验码：如果文件带了校验码，必须和内容一致（在升级之前，对照原始内容校验）
  const warnings: string[] = [];
  const claimed = (original.checksum as { value?: unknown } | undefined)?.value;
  if (original.checksum === undefined) {
    warnings.push('文件没有校验码，无法确认内容是否完整、是否被改动过。请确认来源可信。');
  } else if (original.data && typeof original.data === 'object') {
    const actual = await snapshotChecksum(original.data as Snapshot);
    if (typeof claimed !== 'string' || claimed !== actual) {
      return fail('校验码不一致：文件在导出后被改动过，或下载不完整。为了保护数据，已拒绝导入。');
    }
  }

  // 3. 版本检查与迁移
  const migrated = migrateEnvelope(original, opts.targetVersion, opts.migrations ?? MIGRATIONS);
  if (!migrated.ok) return fail(migrated.error);

  // 4. 外壳格式
  const env = exportEnvelopeSchema.safeParse(migrated.envelope);
  if (!env.success) {
    return fail(...env.error.issues.slice(0, MAX_REPORTED_ERRORS).map((i) => `文件头 ${i.path.join('.') || '(根)'}：${i.message}`));
  }

  // 5. 数据部分逐条校验，报告精确位置
  const data = env.data.data as Record<string, unknown> | null;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return fail('data 字段应该是一个对象。');
  }
  const errors: string[] = [];
  let overflow = 0;
  const push = (msg: string) => (errors.length < MAX_REPORTED_ERRORS ? errors.push(msg) : void overflow++);

  for (const key of Object.keys(data)) {
    if (!(TABLE_NAMES as readonly string[]).includes(key)) push(`data 中有无法识别的表：${key}`);
  }
  const snapshot: Snapshot = { attempts: [], cards: [], reviewLogs: [], settings: [] };
  for (const table of TABLE_NAMES) {
    const rows = data[table];
    if (!Array.isArray(rows)) {
      push(`data.${table} 应该是一个数组（没有数据时写空数组）。`);
      continue;
    }
    const seen = new Set<string>();
    rows.forEach((rec, i) => {
      const parsed = TABLE_SCHEMAS[table].safeParse(rec);
      const label = `${table}[${i}]${describeId(rec)}`;
      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          push(`${label} 字段 ${issue.path.join('.') || '(整条)'}：${issue.message}`);
        }
        return;
      }
      const id = keyOf(table as TableName, parsed.data as { id?: string; key?: string });
      if (seen.has(id)) push(`${label} 的 ID 在文件中重复：${id}`);
      seen.add(id);
      (snapshot[table] as unknown[]).push(parsed.data);
    });
  }
  if (errors.length > 0) {
    if (overflow > 0) errors.push(`……另外还有 ${overflow} 处错误未列出。`);
    return { ok: false, errors };
  }

  const file: ExportFile = {
    format: 'english-lab-export',
    schemaVersion: env.data.schemaVersion,
    exportedAt: env.data.exportedAt,
    appVersion: env.data.appVersion,
    deviceId: env.data.deviceId,
    data: snapshot,
    ...(env.data.checksum ? { checksum: env.data.checksum } : {}),
  };
  if (migrated.migratedFrom !== null) {
    warnings.push(`文件的数据结构版本较旧（${migrated.migratedFrom}），已自动升级。`);
  }
  return { ok: true, file, warnings, migratedFrom: migrated.migratedFrom };
}

function describeId(rec: unknown): string {
  if (rec && typeof rec === 'object') {
    const r = rec as { id?: unknown; key?: unknown };
    const id = typeof r.id === 'string' ? r.id : typeof r.key === 'string' ? r.key : null;
    if (id) return `（${id}）`;
  }
  return '';
}

/** 供测试和比较使用：两份快照内容是否完全相同 */
export function sameSnapshot(a: Snapshot, b: Snapshot): boolean {
  return canonicalStringify(a) === canonicalStringify(b);
}
