/** 内容包加载：打包时把 JSON 一起放进程序里，启动时校验一次，格式不对就直接报错而不是悄悄出错 */
import raw from '../../content/grammar-core.json';
import { packSchema, type ContentPack, type Item, type Topic } from './schema';

export * from './schema';

export interface Library {
  packs: ContentPack[];
  topics: Topic[];
  items: Item[];
  topic(id: string): Topic | undefined;
  item(id: string): Item | undefined;
  itemsOfTopic(topicId: string): Item[];
}

/** 把若干内容包合成一个题库；ID 重复会直接报错（不同包也不能用同一个 ID） */
export function buildLibrary(inputs: unknown[]): Library {
  const packs: ContentPack[] = [];
  for (const input of inputs) {
    const r = packSchema.safeParse(input);
    if (!r.success) {
      const first = r.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`);
      throw new Error(`内容包格式错误：\n${first.join('\n')}`);
    }
    packs.push(r.data);
  }
  const topics = packs.flatMap((p) => p.topics);
  const items = packs.flatMap((p) => p.items);
  for (const [label, list] of [['知识点', topics], ['题目', items]] as const) {
    const seen = new Set<string>();
    for (const x of list) {
      if (seen.has(x.id)) throw new Error(`${label} ID 在多个内容包中重复：${x.id}`);
      seen.add(x.id);
    }
  }
  const topicMap = new Map(topics.map((t) => [t.id, t]));
  const itemMap = new Map(items.map((i) => [i.id, i]));
  return {
    packs,
    topics,
    items,
    topic: (id) => topicMap.get(id),
    item: (id) => itemMap.get(id),
    itemsOfTopic: (id) => items.filter((i) => i.topicId === id && !i.deprecated),
  };
}

export const library: Library = buildLibrary([raw]);
