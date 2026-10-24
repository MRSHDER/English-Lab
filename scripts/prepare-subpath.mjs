// 把打包结果复制到一个“子目录”里，用来验证网站放在任意路径下都能正常工作
import { cpSync, rmSync, mkdirSync } from 'node:fs';

rmSync('.e2e-site', { recursive: true, force: true });
mkdirSync('.e2e-site/lab/v1', { recursive: true });
cpSync('dist', '.e2e-site/lab/v1', { recursive: true });
console.log('已复制 dist -> .e2e-site/lab/v1');
