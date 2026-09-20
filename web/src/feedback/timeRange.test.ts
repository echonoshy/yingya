import {describe,it,expect} from 'vitest';
import {parseTimeRange} from './timeRange';
import {visualFeedbackSchema} from '../schemas';
describe('natural time ranges',()=>{
 it('recognizes an explicit range and preserves ambiguity',()=>{
  expect(parseTimeRange('12–18 秒缩短一些')).toEqual({start:12,end:18});
  expect(parseTimeRange('00:12 到 01:18 改一下')).toEqual({start:12,end:78});
  for(const text of ['12-18个物体','18–12秒','00:99–01:30','12–18秒以及20–30秒','开头慢一点']) expect(parseTimeRange(text)).toBeNull();
 });
 it('accepts range feedback alongside historical point records',()=>{
  const base={id:crypto.randomUUID(),versionId:'v1',videoPath:'a.mp4',timeSeconds:12,note:'缩短',createdAt:0};
  expect(visualFeedbackSchema.safeParse({...base,kind:'video-range',endSeconds:18}).success).toBe(true);
  expect(visualFeedbackSchema.safeParse({...base,kind:'video-time'}).success).toBe(true);
  expect(visualFeedbackSchema.safeParse({...base,kind:'video-range',endSeconds:11}).success).toBe(false);
 });
});
