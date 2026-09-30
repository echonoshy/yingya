import {readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const nonempty = value => typeof value === 'string' && value.trim().length > 0;

export function parseVersion(value) {
  if (typeof value !== 'string' || !versionPattern.test(value)) throw Error('版本号必须为无前导零的 主版本.中版本.修订号，例如 0.1.0');
  const parts = value.split('.').map(Number);
  if (!parts.every(Number.isSafeInteger)) throw Error('版本号超出整数范围');
  return parts;
}

function compareVersions(left, right) {
  const a = parseVersion(left), b = parseVersion(right);
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}

export function validateVersions(history, manifest, lock) {
  if (history?.schemaVersion !== 1 || !Array.isArray(history.releases) || !history.releases.length) throw Error('版本记录至少需要一条记录');
  const current = history.releases[0].version;
  if (manifest.version !== current || lock.version !== current || lock.packages?.['']?.version !== current) throw Error('versions.json、package.json 和 package-lock.json 的当前版本不一致');
  for (const [index, release] of history.releases.entries()) {
    const [, , patch] = parseVersion(release.version);
    if (!validDate(release.date)) throw Error(`${release.version} 的日期无效`);
    if (!Array.isArray(release.changes) || !release.changes.length || !release.changes.every(nonempty)) throw Error(`${release.version} 必须记录开发变更`);
    if (patch === 0 && (!nonempty(release.title) || !nonempty(release.summary))) throw Error(`${release.version} 是中版本，必须填写网页标题和摘要`);
    if (patch !== 0 && (release.title !== undefined || release.summary !== undefined)) throw Error(`${release.version} 是修订版本，只记录开发变更，不填写网页摘要`);
    const previous = history.releases[index + 1];
    if (previous && (compareVersions(release.version, previous.version) <= 0 || release.date < previous.date)) throw Error('版本记录必须按版本和日期从新到旧排列，且版本不能重复');
  }
  const [major, minor] = parseVersion(current);
  if (!history.releases.some(release => release.version === `${major}.${minor}.0`)) throw Error('当前中版本缺少起始版本的网页说明');
  return current;
}

export function recordVersion(history, manifest, lock, bump, {date, changes, title, summary}) {
  const current = validateVersions(history, manifest, lock);
  const [major, minor, patch] = parseVersion(current);
  const versions = {patch: [major, minor, patch + 1], minor: [major, minor + 1, 0], major: [major + 1, 0, 0]};
  if (!Object.hasOwn(versions, bump)) throw Error('使用 patch、minor 或 major 递增版本');
  const version = versions[bump].join('.');
  const entry = {version, date, ...(title !== undefined ? {title} : {}), ...(summary !== undefined ? {summary} : {}), changes};
  const next = {
    history: {...history, releases: [entry, ...history.releases]},
    manifest: {...manifest, version},
    lock: {...lock, version, packages: {...lock.packages, '': {...lock.packages[''], version}}},
  };
  validateVersions(next.history, next.manifest, next.lock);
  return next;
}

async function main() {
  const {positionals, values} = parseArgs({allowPositionals: true, options: {
    change: {type: 'string', multiple: true}, title: {type: 'string'}, summary: {type: 'string'}, date: {type: 'string'}, help: {type: 'boolean'},
  }});
  if (values.help) {
    console.log('npm run version:check\nnpm run version:record -- patch --change "修复说明"\nnpm run version:record -- minor --title "更新标题" --summary "网页简要说明" --change "开发变更"');
    return;
  }
  const [history, manifest, lock] = await Promise.all(['versions.json', 'package.json', 'package-lock.json'].map(async name => JSON.parse(await readFile(path.join(root, name), 'utf8'))));
  if (positionals.length === 1 && positionals[0] === 'check') {
    console.log(`版本记录有效：${validateVersions(history, manifest, lock)}（${history.releases.length} 条）`);
    return;
  }
  if (positionals.length !== 2 || positionals[0] !== 'record') throw Error('使用 check 或 record patch|minor|major；可用 --help 查看示例');
  const date = values.date ?? new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'}).format(new Date());
  const next = recordVersion(history, manifest, lock, positionals[1], {date, changes: values.change, title: values.title, summary: values.summary});
  // Validate every file before writing; a partial filesystem failure is caught by version:check.
  for (const [name, value] of [['versions.json', next.history], ['package.json', next.manifest], ['package-lock.json', next.lock]]) {
    await writeFile(path.join(root, name), JSON.stringify(value, null, 2) + '\n');
  }
  console.log(`已记录 ${next.manifest.version}；请检查并提交版本文件，再执行发布。`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {console.error(error.message); process.exitCode = 1;});
}
