import { useEffect, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { DataStore, PersistState } from './storage';
import { Dashboard } from './pages/Dashboard';
import { ErrorBook } from './pages/ErrorBook';
import { Learn } from './pages/Learn';
import { Practice } from './pages/Practice';
import { Review } from './pages/Review';
import { Settings } from './pages/Settings';

/** 用 #/路径 做路由：纯静态部署不需要服务器配置，放在任何子目录都能用 */
const ROUTES = [
  { path: 'dashboard', label: '首页', en: 'Dashboard' },
  { path: 'learn', label: '学习', en: 'Learn' },
  { path: 'review', label: '复习', en: 'Review' },
  { path: 'practice', label: '练习', en: 'Practice' },
  { path: 'progress', label: '错题本', en: 'Errors' },
  { path: 'settings', label: '设置', en: 'Settings' },
] as const;

type RoutePath = (typeof ROUTES)[number]['path'];

interface Route {
  path: RoutePath;
  /** 路径后面的参数，例如 #/practice/g.present-simple 里的 g.present-simple */
  param: string | undefined;
}

function currentRoute(): Route {
  const raw = window.location.hash.replace(/^#\/?/, '');
  const [head, ...rest] = raw.split('/');
  const found = ROUTES.find((r) => r.path === head);
  const param = rest.join('/');
  return { path: (found?.path ?? 'dashboard') as RoutePath, param: found && param ? decodeURIComponent(param) : undefined };
}

function useRoute(): Route {
  const [route, setRoute] = useState<Route>(currentRoute());
  useEffect(() => {
    const on = () => {
      setRoute(currentRoute());
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

interface AppProps {
  store: DataStore;
  fallbackReason: string | undefined;
  persist: PersistState;
}

export function App({ store, fallbackReason, persist }: AppProps) {
  const route = useRoute();

  const pages: Record<RoutePath, () => JSX.Element> = {
    dashboard: () => <Dashboard store={store} />,
    learn: () => <Learn topicId={route.param} />,
    review: () => <Review store={store} />,
    practice: () => <Practice store={store} topicId={route.param} />,
    progress: () => <ErrorBook store={store} />,
    settings: () => <Settings store={store} persist={persist} />,
  };

  return (
    <div class="shell">
      <nav class="nav" aria-label="主导航">
        <div class="brand">
          English <span>Lab</span>
        </div>
        {ROUTES.map((r) => (
          <a key={r.path} href={`#/${r.path}`} aria-current={route.path === r.path ? 'page' : undefined} data-testid={`nav-${r.path}`}>
            {r.label}
            <small>{r.en}</small>
          </a>
        ))}
      </nav>
      <main class="main" id="main">
        {fallbackReason && (
          <div class="banner" role="alert" data-testid="storage-fallback-banner">
            无法使用本机存储（{fallbackReason}）。现在用的是临时内存，刷新或关闭页面后数据会丢失。请换成普通（非隐私）浏览窗口再打开。
          </div>
        )}
        {pages[route.path]()}
      </main>
    </div>
  );
}
