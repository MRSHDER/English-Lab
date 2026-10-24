import { render } from 'preact';
import './styles.css';
import { App } from './app';
import { openStore, requestPersistentStorage, type PersistState } from './storage';

async function start() {
  const root = document.getElementById('app') as HTMLElement;
  render(<p class="boot">正在打开本机数据…</p>, root);
  const { store, fallbackReason } = await openStore();
  const persist: PersistState = store.kind === 'indexeddb' ? await requestPersistentStorage() : 'unsupported';
  render(<App store={store} fallbackReason={fallbackReason} persist={persist} />, root);
}

void start();
