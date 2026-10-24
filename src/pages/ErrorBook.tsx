import { useCallback, useEffect, useState } from 'preact/hooks';
import { library } from '../content';
import { loadErrorBook, type ErrorBook as Book } from '../learning/queries';
import { setSelfClassification, type SelfChoice } from '../learning/record';
import { ERROR_CATEGORY_LABELS, type DataStore, type ErrorTag } from '../storage';
import { formatTime } from '../ui/format';

const CHOICES: { value: SelfChoice; label: string }[] = [
  { value: 'grammar', label: '语法' },
  { value: 'spelling', label: '拼写' },
  { value: 'vocabulary', label: '词汇' },
  { value: 'unnatural', label: '表达不自然' },
  { value: 'meaning', label: '理解偏差' },
  { value: 'slip', label: '手滑' },
];

function tagLabel(t: ErrorTag): string {
  if (t.slip) return '手滑';
  return ERROR_CATEGORY_LABELS[t.category];
}
function isActive(tags: ErrorTag[], c: SelfChoice): boolean {
  return tags.some((t) => t.source === 'self' && (c === 'slip' ? t.slip === true : !t.slip && t.category === c));
}

export function ErrorBook({ store }: { store: DataStore }) {
  const [book, setBook] = useState<Book | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setBook(await loadErrorBook(store));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [store]);
  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <p class="msg-error" role="alert">读取错题本失败：{error}</p>;
  if (!book) return <p class="boot">读取错题本…</p>;

  const s = book.summary;
  const cats = (['grammar', 'spelling', 'vocabulary', 'unnatural', 'meaning', 'mechanics'] as const).map((c) => ({
    key: c,
    label: ERROR_CATEGORY_LABELS[c],
    n: s.byCategory[c],
  }));

  return (
    <div class="stack">
      <div>
        <h1 class="page-title">错题本</h1>
        <p class="page-sub">每一类错误分开统计。“手滑”和“待分类”不会算进各类错误。</p>
      </div>

      <section class="card" data-testid="error-summary">
        <h2>错误统计</h2>
        <div class="stat-grid">
          {cats.map((c) => (
            <div key={c.key} class="stat" data-testid={`stat-${c.key}`}>
              <div class="stat-n">{c.n}</div>
              <div class="hint">{c.label}</div>
            </div>
          ))}
          <div class="stat" data-testid="stat-slips">
            <div class="stat-n">{s.slips}</div>
            <div class="hint">手滑（不计入）</div>
          </div>
          <div class="stat" data-testid="stat-unclassified">
            <div class="stat-n">{s.unclassifiedAttempts}</div>
            <div class="hint">待分类</div>
          </div>
        </div>
      </section>

      {book.entries.length === 0 ? (
        <section class="card" data-testid="errorbook-empty">
          <h2>还没有错题</h2>
          <p class="hint">去练习几道题吧。答错的题会出现在这里。</p>
        </section>
      ) : (
        <ul class="stack" data-testid="errorbook-list">
          {book.entries.map((e) => {
            const item = library.item(e.itemId);
            const a = e.latest;
            return (
              <li key={e.itemId} class="card" data-testid="errorbook-entry">
                <div class="row spread">
                  <span class="mono">{e.itemId}</span>
                  <span class="row">
                    {e.recovered ? <span class="pill ok">已改正</span> : <span class="pill warn">还没改正</span>}
                    <span class="pill">错过 {e.wrongCount} 次</span>
                  </span>
                </div>
                <p class="q-stem" style="margin-top:8px">{a.promptSnapshot}</p>
                {item?.zh && <p class="q-zh">{item.zh}</p>}
                <dl class="kv" style="margin-top:8px">
                  <dt>你写的</dt>
                  <dd>{a.userAnswer === '' ? '（不知道）' : a.userAnswer}</dd>
                  <dt>正确</dt>
                  <dd>{a.referenceAnswerSnapshot}</dd>
                  <dt>时间</dt>
                  <dd>{formatTime(a.answeredAt)}</dd>
                  <dt>错因</dt>
                  <dd>
                    {a.errors.map((t, i) => (
                      <span key={i} class="pill" style="margin-right:6px">
                        {tagLabel(t)}
                        {t.source === 'auto' ? '（自动）' : ''}
                      </span>
                    ))}
                  </dd>
                </dl>
                {item && <p class="hint" style="margin-top:8px">{item.explanation}</p>}
                <div class="q-classify">
                  <p class="hint">改一下错因：</p>
                  <div class="row">
                    {CHOICES.map((c) => (
                      <button
                        key={c.value}
                        class={`btn small${isActive(a.errors, c.value) ? ' on' : ''}`}
                        aria-pressed={isActive(a.errors, c.value)}
                        data-testid={`eb-classify-${c.value}`}
                        onClick={async () => {
                          await setSelfClassification(store, a, c.value);
                          await load();
                        }}
                      >
                        {c.label}
                      </button>
                    ))}
                  </div>
                </div>
                {a.topicId && (
                  <p style="margin-top:10px">
                    <a href={`#/practice/${a.topicId}`}>练习这个知识点 →</a>
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
