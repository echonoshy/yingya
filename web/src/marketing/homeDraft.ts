import type { BriefSource } from '../creationBrief';
const draftKey = 'yingya-marketing-draft-v1';
const sourceKey = 'yingya-marketing-source-v1';
export type HomeSource = BriefSource;
export function saveHomeDraft(prompt: string, source: HomeSource = 'reference') {
  sessionStorage.setItem(draftKey, prompt);
  sessionStorage.setItem(sourceKey, source);
}
export function takeHomeSource(): HomeSource | null {
  try {
    const source = sessionStorage.getItem(sourceKey);
    sessionStorage.removeItem(sourceKey);
    if (source === 'material' || source === 'idea') return 'script';
    return source === 'reference' || source === 'website' || source === 'script' || source === 'style' ? source : null;
  } catch { return null; }
}
export function takeHomeDraft(): string {
  try {
    const prompt = sessionStorage.getItem(draftKey) ?? '';
    sessionStorage.removeItem(draftKey);
    return prompt;
  } catch { return ''; }
}
