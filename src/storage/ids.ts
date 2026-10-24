/**
 * 稳定 ID 规则（详见 docs/ID-RULES.md）
 *
 * 1. 题库内容（知识点、题目、词条）的 ID 是人写的、有含义的短名字，
 *    形如 g.present-simple、q.present-simple.0001、v.run.1。
 * 2. 内容 ID 一旦发布就永远不改、不删、不重复使用。
 *    题目改了内容就把 revision 加 1，ID 不变；不要了就标记 deprecated，不删除。
 * 3. 你的学习记录（作答、复习日志、备份）的 ID 由程序随机生成，带时间前缀，
 *    因此多台设备各自生成也不会撞车。
 * 4. 学习记录只通过内容 ID 关联题库，所以题库更新后历史记录仍能对上。
 */

/** 内容 ID 的前缀含义：g 语法知识点，q 题目，v 词条，r 阅读材料，t 真题条目 */
export const CONTENT_PREFIXES = ['g', 'q', 'v', 'r', 't'] as const;
export type ContentPrefix = (typeof CONTENT_PREFIXES)[number];

const CONTENT_ID_RE = /^(g|q|v|r|t)\.[a-z0-9]+(?:[-.][a-z0-9]+)*$/;

export function isContentId(id: unknown): id is string {
  return typeof id === 'string' && id.length <= 100 && CONTENT_ID_RE.test(id);
}

export function contentKind(id: string): ContentPrefix | null {
  if (!isContentId(id)) return null;
  return id.charAt(0) as ContentPrefix;
}

/** 每个题目/词条对应唯一一张复习卡，卡片 ID 由内容 ID 推出，保证跨设备、跨次导入不重复 */
export function cardIdFor(itemId: string): string {
  return `card.${itemId}`;
}

export type RecordPrefix = 'att' | 'log' | 'bak' | 'dev';

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

function randomChars(n: number): string {
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += ALPHABET.charAt(b % 36);
  return out;
}

/**
 * 生成学习记录 ID：前缀_时间(毫秒，36进制，固定10位)+随机10位。
 * 按字符串排序就是按创建时间排序；随机部分让多设备同一毫秒也不会重复。
 */
export function newRecordId(prefix: RecordPrefix, now: number = Date.now()): string {
  const time = now.toString(36).padStart(10, '0');
  return `${prefix}_${time}${randomChars(10)}`;
}

const RECORD_ID_RE = /^(att|log|bak|dev)_[0-9a-z]{20}$/;
export function isRecordId(id: unknown, prefix?: RecordPrefix): id is string {
  if (typeof id !== 'string' || !RECORD_ID_RE.test(id)) return false;
  return prefix ? id.startsWith(`${prefix}_`) : true;
}
