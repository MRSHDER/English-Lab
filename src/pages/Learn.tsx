import { library } from '../content';

export function Learn({ topicId }: { topicId?: string | undefined }) {
  const topic = topicId ? library.topic(topicId) : undefined;
  if (topicId && !topic) {
    return (
      <div>
        <h1 class="page-title">找不到这个知识点</h1>
        <p class="page-sub"><a href="#/learn">返回学习中心</a></p>
      </div>
    );
  }
  if (topic) {
    const count = library.itemsOfTopic(topic.id).length;
    return (
      <div class="stack">
        <p><a href="#/learn">← 学习中心</a></p>
        <h1 class="page-title" data-testid="topic-title">{topic.title}</h1>
        <p class="page-sub">{topic.titleEn} · {topic.summary}</p>
        <section class="card">
          <h2>规则</h2>
          <ul class="bullets">
            {topic.rules.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </section>
        <section class="card">
          <h2>例句</h2>
          <ul class="list">
            {topic.examples.map((e) => (
              <li key={e.en}>
                <div class="ex-en">{e.en}</div>
                <div class="hint">{e.zh}</div>
              </li>
            ))}
          </ul>
        </section>
        <a class="btn primary" style="display:inline-flex;align-items:center;text-decoration:none" data-testid="start-practice" href={`#/practice/${topic.id}`}>
          开始练习（{count} 题）
        </a>
      </div>
    );
  }
  return (
    <div>
      <h1 class="page-title">学习中心</h1>
      <p class="page-sub">先读规则和例句，再去练习。词汇本和基础阅读之后加入。</p>
      <ul class="stack topic-list">
        {library.topics.map((t) => (
          <li key={t.id}>
            <a class="card topic-card" href={`#/learn/${t.id}`} data-testid="topic-link">
              <strong>{t.title}</strong> <span class="hint">{t.titleEn}</span>
              <p class="hint">{t.summary}</p>
              <p class="hint">{library.itemsOfTopic(t.id).length} 题</p>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
