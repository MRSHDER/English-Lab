/**
 * 内容包格式（详见 docs/CONTENT-FORMAT.md）
 *
 * 内容包是一个 JSON 文件，包含若干知识点（topics）和题目（items）。
 * 题库更新的规则：ID 永远不变；改了题就把 revision 加 1；不要了就标记 deprecated，不要删除。
 */
import { z } from 'zod';
import { ERROR_CATEGORIES } from '../storage/errorTaxonomy';
import { isContentId, contentKind } from '../storage/ids';
import { normalizeAnswer } from '../learning/grade';

export const CONTENT_FORMAT = 'english-lab-content';
export const CONTENT_FORMAT_VERSION = 1;

const contentId = (prefix: 'g' | 'q') =>
  z.string().refine((s) => isContentId(s) && contentKind(s) === prefix, `ID 必须以 ${prefix}. 开头并符合内容 ID 规则`);

export const topicSchema = z.strictObject({
  id: contentId('g'),
  title: z.string().min(1),
  titleEn: z.string().min(1),
  summary: z.string().min(1),
  rules: z.array(z.string().min(1)).min(1),
  examples: z.array(z.strictObject({ en: z.string().min(1), zh: z.string().min(1) })).min(1),
});
export type Topic = z.infer<typeof topicSchema>;

/** 已知的常见错误：学生输入了这个答案时，直接给出明确的错因，而不是“待分类” */
export const mistakeSchema = z.strictObject({
  text: z.string().min(1),
  category: z.enum(ERROR_CATEGORIES),
  subtype: z
    .string()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)
    .optional(),
  /** 针对这个错误的一句提醒 */
  note: z.string().optional(),
});
export type Mistake = z.infer<typeof mistakeSchema>;

export const itemSchema = z
  .strictObject({
    id: contentId('q'),
    revision: z.number().int().min(1),
    topicId: contentId('g'),
    type: z.enum(['fill', 'choice']),
    /** 题干。填空题用 ___ 表示空格 */
    stem: z.string().min(1),
    /** 填空题括号里的提示词，例如 study */
    cue: z.string().optional(),
    /** 题干的中文意思，给初学者参考 */
    zh: z.string().optional(),
    /** 选择题的选项 */
    options: z.array(z.string().min(1)).optional(),
    /** 所有可接受的正确答案，第一个是标准答案 */
    answers: z.array(z.string().min(1)).min(1),
    hint: z.string().optional(),
    explanation: z.string().min(1),
    mistakes: z.array(mistakeSchema).optional(),
    deprecated: z.boolean().optional(),
  })
  .superRefine((it, ctx) => {
    const add = (path: (string | number)[], message: string) => ctx.addIssue({ code: 'custom', path, message });
    const topicSlug = it.topicId.slice(2);
    if (!it.id.startsWith(`q.${topicSlug}.`)) add(['id'], `题目 ID 应以 q.${topicSlug}. 开头，与所属知识点对应`);
    if (it.type === 'fill' && !it.stem.includes('___')) add(['stem'], '填空题的题干里要有 ___ 表示空格');
    if (it.type === 'choice') {
      if (!it.options || it.options.length < 2) add(['options'], '选择题至少要有 2 个选项');
      else {
        const opts = new Set(it.options.map(normalizeAnswer));
        if (opts.size !== it.options.length) add(['options'], '选项不能重复');
        it.answers.forEach((a, i) => {
          if (!opts.has(normalizeAnswer(a))) add(['answers', i], `正确答案必须是选项之一：${a}`);
        });
      }
    } else if (it.options) add(['options'], '填空题不应有 options');
    const answerSet = new Set(it.answers.map(normalizeAnswer));
    it.mistakes?.forEach((m, i) => {
      if (answerSet.has(normalizeAnswer(m.text))) add(['mistakes', i, 'text'], `“${m.text}”是正确答案，不能列为错误`);
      if (it.type === 'choice' && it.options && !it.options.map(normalizeAnswer).includes(normalizeAnswer(m.text)))
        add(['mistakes', i, 'text'], `“${m.text}”不是选项`);
    });
  });
export type Item = z.infer<typeof itemSchema>;

export const packSchema = z
  .strictObject({
    format: z.literal(CONTENT_FORMAT),
    formatVersion: z.literal(CONTENT_FORMAT_VERSION),
    packId: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
    title: z.string().min(1),
    topics: z.array(topicSchema).min(1),
    items: z.array(itemSchema).min(1),
  })
  .superRefine((p, ctx) => {
    const seen = new Set<string>();
    p.topics.forEach((t, i) => {
      if (seen.has(t.id)) ctx.addIssue({ code: 'custom', path: ['topics', i, 'id'], message: `知识点 ID 重复：${t.id}` });
      seen.add(t.id);
    });
    const topicIds = new Set(p.topics.map((t) => t.id));
    const itemIds = new Set<string>();
    p.items.forEach((it, i) => {
      if (itemIds.has(it.id)) ctx.addIssue({ code: 'custom', path: ['items', i, 'id'], message: `题目 ID 重复：${it.id}` });
      itemIds.add(it.id);
      if (!topicIds.has(it.topicId))
        ctx.addIssue({ code: 'custom', path: ['items', i, 'topicId'], message: `找不到知识点：${it.topicId}` });
    });
  });
export type ContentPack = z.infer<typeof packSchema>;
