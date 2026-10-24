/**
 * 数据模型（学习记录的“形状”）。
 * 所有进入存储或导入文件的数据都必须先通过这里的校验。
 *
 * 数据库表：
 *   attempts   每次作答（可修改错误标签，其余视为不可变事实）
 *   cards      每个题目/词条一张复习卡（FSRS 状态）
 *   reviewLogs 每次复习一条日志，只增不改不删
 *   settings   设置（键值）
 */
import { z } from 'zod';
import { ERROR_CATEGORIES, ERROR_SOURCES } from './errorTaxonomy';
import { cardIdFor, isContentId } from './ids';

export const SCHEMA_VERSION = 1;
export const EXPORT_FORMAT = 'english-lab-export';

export const TABLE_NAMES = ['attempts', 'cards', 'reviewLogs', 'settings'] as const;
export type TableName = (typeof TABLE_NAMES)[number];

// ---------- 基础类型 ----------

/** 统一用 UTC 的 ISO 时间（带毫秒、以 Z 结尾），这样按字符串排序就是按时间排序 */
export const isoSchema = z.string().refine((s) => {
  const t = Date.parse(s);
  return !Number.isNaN(t) && new Date(t).toISOString() === s;
}, '时间必须是 UTC 格式，例如 2026-10-22T04:41:00.000Z');

export const contentIdSchema = z
  .string()
  .refine(isContentId, '内容 ID 格式不对，应形如 q.present-simple.0001');

const recordIdSchema = z.string().min(1).max(100);

// ---------- 错题标签 ----------

export const errorTagSchema = z.strictObject({
  category: z.enum(ERROR_CATEGORIES),
  /** 更细的分类，例如 third-person-s、article；小写字母数字加短横线 */
  subtype: z
    .string()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, '子类别只能是小写字母、数字和短横线')
    .optional(),
  topicId: contentIdSchema.optional(),
  /** 手滑：会，但这次打错了。记录但不计入掌握度 */
  slip: z.boolean().optional(),
  source: z.enum(ERROR_SOURCES),
});
export type ErrorTag = z.infer<typeof errorTagSchema>;

// ---------- 作答 ----------

export const ATTEMPT_MODES = ['practice', 'review', 'exam'] as const;
export const ATTEMPT_OUTCOMES = ['independent', 'hinted', 'wrong'] as const;

export const attemptSchema = z
  .strictObject({
    id: recordIdSchema,
    itemId: contentIdSchema,
    /** 作答时题目的版本号；题目以后修改了，这条历史仍然能对上当时的版本 */
    itemRevision: z.number().int().min(1),
    topicId: contentIdSchema.optional(),
    mode: z.enum(ATTEMPT_MODES),
    /** 作答时题干和参考答案的快照，题库以后改动或下架，错题本仍能完整显示 */
    promptSnapshot: z.string(),
    userAnswer: z.string(),
    referenceAnswerSnapshot: z.string(),
    /** independent 独立答对；hinted 提示后答对；wrong 答错 */
    outcome: z.enum(ATTEMPT_OUTCOMES),
    hintUsed: z.boolean(),
    errors: z.array(errorTagSchema),
    durationMs: z.number().int().min(0),
    answeredAt: isoSchema,
    createdAt: isoSchema,
    updatedAt: isoSchema,
  })
  .superRefine((a, ctx) => {
    if (a.outcome === 'independent' && a.hintUsed) {
      ctx.addIssue({ code: 'custom', path: ['hintUsed'], message: '独立答对时不能使用过提示' });
    }
    if (a.outcome === 'hinted' && !a.hintUsed) {
      ctx.addIssue({ code: 'custom', path: ['hintUsed'], message: '提示后答对时必须使用过提示' });
    }
    if (a.outcome === 'independent' && a.errors.length > 0) {
      ctx.addIssue({ code: 'custom', path: ['errors'], message: '独立答对不应有错误标签' });
    }
  });
export type Attempt = z.infer<typeof attemptSchema>;

// ---------- 复习卡与复习日志 ----------

export const fsrsStateSchema = z.strictObject({
  /** 0 新卡，1 学习中，2 复习中，3 重新学习 */
  state: z.number().int().min(0).max(3),
  due: isoSchema,
  stability: z.number().min(0),
  difficulty: z.number().min(0),
  elapsedDays: z.number().min(0),
  scheduledDays: z.number().min(0),
  reps: z.number().int().min(0),
  lapses: z.number().int().min(0),
  learningSteps: z.number().int().min(0).optional(),
  lastReview: isoSchema.nullable(),
});
export type FsrsState = z.infer<typeof fsrsStateSchema>;

export const CARD_KINDS = ['question', 'vocab', 'grammar'] as const;

export const cardSchema = z
  .strictObject({
    /** 必须等于 card.<itemId>，保证一个内容只有一张卡 */
    id: recordIdSchema,
    itemId: contentIdSchema,
    kind: z.enum(CARD_KINDS),
    suspended: z.boolean(),
    fsrs: fsrsStateSchema,
    createdAt: isoSchema,
    updatedAt: isoSchema,
  })
  .superRefine((c, ctx) => {
    if (c.id !== cardIdFor(c.itemId)) {
      ctx.addIssue({ code: 'custom', path: ['id'], message: `卡片 ID 必须是 ${cardIdFor(c.itemId)}` });
    }
  });
export type Card = z.infer<typeof cardSchema>;

/** 复习当时所用算法的完整信息，保证以后能重算或迁移 */
export const algorithmSchema = z.strictObject({
  name: z.string().min(1), // 例如 FSRS
  libraryVersion: z.string().min(1), // 例如 ts-fsrs 的版本号
  paramsVersion: z.string().min(1), // 参数集的名字，例如 default-fsrs6
  parameters: z.array(z.number()).min(1), // 完整权重参数
  requestRetention: z.number().gt(0).lt(1),
  maximumInterval: z.number().int().min(1).optional(),
  enableFuzz: z.boolean().optional(),
  /** 是否启用同日短期学习步骤；V1 关闭，卡片间隔以“天”为单位。后加的可选字段，旧文件仍然有效 */
  enableShortTerm: z.boolean().optional(),
});
export type AlgorithmInfo = z.infer<typeof algorithmSchema>;

export const REVIEW_RATINGS = [1, 2, 3, 4] as const; // 1 重来 2 困难 3 良好 4 简单

export const reviewLogSchema = z
  .strictObject({
    id: recordIdSchema,
    cardId: recordIdSchema,
    itemId: contentIdSchema,
    attemptId: recordIdSchema.optional(),
    reviewedAt: isoSchema,
    rating: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
    outcome: z.enum(ATTEMPT_OUTCOMES),
    durationMs: z.number().int().min(0),
    algorithm: algorithmSchema,
    /** 复习前的状态；第一次复习为 null */
    before: fsrsStateSchema.nullable(),
    after: fsrsStateSchema,
    createdAt: isoSchema,
  })
  .superRefine((l, ctx) => {
    if (l.cardId !== cardIdFor(l.itemId)) {
      ctx.addIssue({ code: 'custom', path: ['cardId'], message: `卡片 ID 必须是 ${cardIdFor(l.itemId)}` });
    }
  });
export type ReviewLog = z.infer<typeof reviewLogSchema>;

// ---------- 设置 ----------

export const appSettingsSchema = z.strictObject({
  dailyNewLimit: z.number().int().min(0).max(200),
  dailyReviewLimit: z.number().int().min(0).max(500),
  fontScale: z.number().min(0.8).max(1.6),
  reminder: z.enum(['off', 'daily']),
});
export type AppSettings = z.infer<typeof appSettingsSchema>;

export const DEFAULT_APP_SETTINGS: AppSettings = {
  dailyNewLimit: 5,
  dailyReviewLimit: 50,
  fontScale: 1,
  reminder: 'off',
};

function isJsonValue(v: unknown): boolean {
  if (v === null) return true;
  const t = typeof v;
  if (t === 'string' || t === 'boolean') return true;
  if (t === 'number') return Number.isFinite(v as number);
  if (Array.isArray(v)) return v.every(isJsonValue);
  if (t === 'object') return Object.values(v as object).every(isJsonValue);
  return false;
}

export const settingRowSchema = z
  .strictObject({
    key: z.string().regex(/^[A-Za-z0-9._-]{1,60}$/, '设置名只能包含字母、数字、点、下划线和短横线'),
    value: z.unknown().refine(isJsonValue, '设置值必须是合法的 JSON 数据'),
    updatedAt: isoSchema,
  })
  .superRefine((row, ctx) => {
    if (row.key === 'app') {
      const r = appSettingsSchema.safeParse(row.value);
      if (!r.success) {
        for (const issue of r.error.issues) {
          ctx.addIssue({ code: 'custom', path: ['value', ...issue.path], message: issue.message });
        }
      }
    }
  });
export type SettingRow = z.infer<typeof settingRowSchema>;

// ---------- 快照与导出文件 ----------

export interface Snapshot {
  attempts: Attempt[];
  cards: Card[];
  reviewLogs: ReviewLog[];
  settings: SettingRow[];
}

export const TABLE_SCHEMAS = {
  attempts: attemptSchema,
  cards: cardSchema,
  reviewLogs: reviewLogSchema,
  settings: settingRowSchema,
} as const;

export function keyOf(table: TableName, record: { id?: string; key?: string }): string {
  return table === 'settings' ? (record.key as string) : (record.id as string);
}

export function emptySnapshot(): Snapshot {
  return { attempts: [], cards: [], reviewLogs: [], settings: [] };
}

/** 统一排序（按 ID / 键），让导出结果和比较结果稳定 */
export function sortSnapshot(s: Snapshot): Snapshot {
  const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return {
    attempts: [...s.attempts].sort(byId),
    cards: [...s.cards].sort(byId),
    reviewLogs: [...s.reviewLogs].sort(byId),
    settings: [...s.settings].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)),
  };
}

export const checksumSchema = z.strictObject({
  algorithm: z.literal('sha-256'),
  value: z.string().regex(/^[0-9a-f]{64}$/, '校验码应为 64 位十六进制'),
});

/** 导出文件的外壳；data 部分另行逐条校验，以便给出精确的错误位置 */
export const exportEnvelopeSchema = z.strictObject({
  format: z.literal(EXPORT_FORMAT),
  schemaVersion: z.number().int().min(0),
  exportedAt: isoSchema,
  appVersion: z.string().min(1),
  deviceId: z.string().min(1).max(100),
  data: z.unknown(),
  checksum: checksumSchema.optional(),
});

export interface ExportFile {
  format: typeof EXPORT_FORMAT;
  schemaVersion: number;
  exportedAt: string;
  appVersion: string;
  deviceId: string;
  data: Snapshot;
  checksum?: { algorithm: 'sha-256'; value: string };
}
