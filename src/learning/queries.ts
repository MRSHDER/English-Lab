import type { Item, Library } from '../content';
import { DEFAULT_APP_SETTINGS, type Attempt, type Card } from '../storage/schema';
import type { DataStore } from '../storage/types';
import { summarizeErrors, type ErrorSummary } from '../storage/errorTaxonomy';

/** 本地时间“今天 23:59:59.999”对应的 UTC 时间串。到期时间在今天之内的卡都算今天要复习 */
export function endOfLocalDayIso(now: Date): string {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999).toISOString();
}

export interface DueEntry {
  card: Card;
  item: Item;
}

export async function dueToday(store: DataStore, lib: Library, now: Date = new Date()): Promise<{ entries: DueEntry[]; total: number }> {
  const cards = await store.cards.listDue(endOfLocalDayIso(now));
  const entries: DueEntry[] = [];
  for (const card of cards) {
    const item = lib.item(card.itemId);
    if (item && !item.deprecated) entries.push({ card, item });
  }
  const limit = DEFAULT_APP_SETTINGS.dailyReviewLimit;
  return { entries: entries.slice(0, limit), total: entries.length };
}

export interface ErrorBookEntry {
  itemId: string;
  topicId: string | undefined;
  /** 最近一次答错的作答 */
  latest: Attempt;
  wrongCount: number;
  /** 这道题最近一次作答是否已经答对（说明已经改正） */
  recovered: boolean;
}

export interface ErrorBook {
  entries: ErrorBookEntry[];
  summary: ErrorSummary;
}

export async function loadErrorBook(store: DataStore): Promise<ErrorBook> {
  const all = await store.attempts.listAll();
  const byItem = new Map<string, Attempt[]>();
  for (const a of all) {
    const list = byItem.get(a.itemId) ?? [];
    list.push(a);
    byItem.set(a.itemId, list);
  }
  const entries: ErrorBookEntry[] = [];
  for (const [itemId, list] of byItem) {
    list.sort((x, y) => (x.answeredAt < y.answeredAt ? -1 : x.answeredAt > y.answeredAt ? 1 : x.id < y.id ? -1 : 1));
    const wrongs = list.filter((a) => a.outcome === 'wrong');
    if (wrongs.length === 0) continue;
    const latest = wrongs[wrongs.length - 1] as Attempt;
    entries.push({
      itemId,
      topicId: latest.topicId,
      latest,
      wrongCount: wrongs.length,
      recovered: (list[list.length - 1] as Attempt).outcome !== 'wrong',
    });
  }
  entries.sort((x, y) => (x.latest.answeredAt < y.latest.answeredAt ? 1 : -1));
  return { entries, summary: summarizeErrors(all) };
}
