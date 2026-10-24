/**
 * DataStore 的唯一实现：全部业务规则都在这里，底层只负责“存”和“取”。
 */
import type { z } from 'zod';
import type { Backend, LearningTables } from './backend';
import { cardIdFor, newRecordId } from './ids';
import {
  attemptSchema,
  cardSchema,
  emptySnapshot,
  reviewLogSchema,
  settingRowSchema,
  sortSnapshot,
  TABLE_NAMES,
  type Attempt,
  type Card,
  type ReviewLog,
  type SettingRow,
  type Snapshot,
  type TableName,
} from './schema';
import { StoreError, type BackupMeta, type DataStore } from './types';

export function formatIssues(issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>): string {
  return issues
    .slice(0, 5)
    .map((i) => (i.path.length ? `${i.path.map(String).join('.')}：${i.message}` : i.message))
    .join('；');
}

function check<S extends z.ZodType>(schema: S, value: unknown, label: string): z.infer<S> {
  const r = schema.safeParse(value);
  if (!r.success) {
    throw new StoreError('VALIDATION', `${label}数据无效：${formatIssues(r.error.issues)}`);
  }
  return r.data;
}

const byId = <T extends { id: string }>(a: T, b: T) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function createStore(
  backend: Backend,
  kind: DataStore['kind'],
  persistent: boolean,
): DataStore {
  const list = async <T>(table: Parameters<Backend['all']>[0]) => (await backend.all(table)) as T[];

  async function validateSnapshot(snapshot: Snapshot): Promise<LearningTables> {
    const out = {} as LearningTables;
    const schemas = {
      attempts: attemptSchema,
      cards: cardSchema,
      reviewLogs: reviewLogSchema,
      settings: settingRowSchema,
    } as const;
    for (const name of TABLE_NAMES) {
      const seen = new Set<string>();
      const rows: unknown[] = [];
      for (const [i, rec] of (snapshot[name] as unknown[]).entries()) {
        const parsed = check(schemas[name], rec, `${name}[${i}]`);
        const key = String((parsed as { id?: string; key?: string }).id ?? (parsed as SettingRow).key);
        if (seen.has(key)) throw new StoreError('DUPLICATE', `${name} 中有重复 ID：${key}`);
        seen.add(key);
        rows.push(parsed);
      }
      out[name] = rows;
    }
    return out;
  }

  const store: DataStore = {
    kind,
    persistent,

    async getDeviceId() {
      const row = (await backend.get('meta', 'deviceId')) as { value: string } | undefined;
      if (row) return row.value;
      const id = newRecordId('dev');
      await backend.put('meta', { key: 'deviceId', value: id });
      return id;
    },

    attempts: {
      async add(attempt) {
        await backend.add('attempts', check(attemptSchema, attempt, '作答'));
      },
      async get(id) {
        return (await backend.get('attempts', id)) as Attempt | undefined;
      },
      async listAll() {
        return (await list<Attempt>('attempts')).sort(byId);
      },
      async listByItem(itemId) {
        return (await list<Attempt>('attempts'))
          .filter((a) => a.itemId === itemId)
          .sort((a, b) => (a.answeredAt < b.answeredAt ? -1 : a.answeredAt > b.answeredAt ? 1 : byId(a, b)));
      },
      async updateErrors(id, errors, nowIso = new Date().toISOString()) {
        const cur = (await backend.get('attempts', id)) as Attempt | undefined;
        if (!cur) throw new StoreError('NOT_FOUND', `找不到作答：${id}`);
        // updatedAt 不能倒退，否则合并导入时会被旧数据覆盖
        const updatedAt = nowIso > cur.updatedAt ? nowIso : cur.updatedAt;
        const next = check(attemptSchema, { ...cur, errors, updatedAt }, '作答');
        await backend.put('attempts', next);
        return next;
      },
    },

    cards: {
      async put(card) {
        await backend.put('cards', check(cardSchema, card, '复习卡'));
      },
      async get(id) {
        return (await backend.get('cards', id)) as Card | undefined;
      },
      async getByItem(itemId) {
        return (await backend.get('cards', cardIdFor(itemId))) as Card | undefined;
      },
      async listAll() {
        return (await list<Card>('cards')).sort(byId);
      },
      async listDue(beforeIso) {
        return (await list<Card>('cards'))
          .filter((c) => !c.suspended && c.fsrs.due <= beforeIso)
          .sort((a, b) => (a.fsrs.due < b.fsrs.due ? -1 : a.fsrs.due > b.fsrs.due ? 1 : byId(a, b)));
      },
    },

    reviewLogs: {
      async append(log) {
        // add 而不是 put：ID 已存在就报错，保证已写入的日志永远不会被覆盖
        await backend.add('reviewLogs', check(reviewLogSchema, log, '复习日志'));
      },
      async listAll() {
        return (await list<ReviewLog>('reviewLogs')).sort(byId);
      },
      async listByCard(cardId) {
        return (await list<ReviewLog>('reviewLogs'))
          .filter((l) => l.cardId === cardId)
          .sort((a, b) => (a.reviewedAt < b.reviewedAt ? -1 : a.reviewedAt > b.reviewedAt ? 1 : byId(a, b)));
      },
    },

    settings: {
      async get(key) {
        return (await backend.get('settings', key)) as SettingRow | undefined;
      },
      async set(key, value, nowIso = new Date().toISOString()) {
        await backend.put('settings', check(settingRowSchema, { key, value, updatedAt: nowIso }, '设置'));
      },
      async listAll() {
        return (await list<SettingRow>('settings')).sort((a, b) => (a.key < b.key ? -1 : 1));
      },
    },

    async exportSnapshot() {
      return sortSnapshot({
        attempts: await list<Attempt>('attempts'),
        cards: await list<Card>('cards'),
        reviewLogs: await list<ReviewLog>('reviewLogs'),
        settings: await list<SettingRow>('settings'),
      });
    },

    async replaceAll(snapshot) {
      const tables = await validateSnapshot(snapshot);
      await backend.replaceLearningTables(tables);
    },

    async countRecords() {
      const out = {} as Record<TableName, number>;
      for (const t of TABLE_NAMES) out[t] = (await backend.all(t)).length;
      return out;
    },

    async listChangedSince(sinceIso) {
      const s = await store.exportSnapshot();
      const out = emptySnapshot();
      out.attempts = s.attempts.filter((a) => a.updatedAt > sinceIso);
      out.cards = s.cards.filter((c) => c.updatedAt > sinceIso);
      out.reviewLogs = s.reviewLogs.filter((l) => l.createdAt > sinceIso);
      out.settings = s.settings.filter((r) => r.updatedAt > sinceIso);
      return out;
    },

    backups: {
      async save(meta, payload) {
        await backend.add('backups', meta);
        await backend.put('backupPayloads', { id: meta.id, payload });
      },
      async list() {
        return (await list<BackupMeta>('backups')).sort((a, b) =>
          a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a.id < b.id ? 1 : -1,
        );
      },
      async getPayload(id) {
        const row = (await backend.get('backupPayloads', id)) as { payload: string } | undefined;
        return row?.payload;
      },
      async delete(id) {
        await backend.remove('backupPayloads', id);
        await backend.remove('backups', id);
      },
    },
  };

  return store;
}
