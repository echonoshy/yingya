import { useState } from 'react';
import { ActionDialog } from './ActionDialog';

export function TimeRangeDialog({ current, duration, onConfirm, onClose }: { current: number; duration: number; onConfirm: (start: number, end: number) => void; onClose: () => void }) {
  const [start, setStart] = useState(String(Math.max(0, Math.min(current, duration - .1)).toFixed(1)));
  const [end, setEnd] = useState(String(Math.min(duration, Number(Math.max(.1, current + 5).toFixed(1)))));
  const from = Number(start), to = Number(end);
  const error = !start || !end ? '请填写开始和结束时间' : !Number.isFinite(from) || !Number.isFinite(to) || from < 0 || to > duration ? '请选择视频时长内的范围' : to <= from ? '结束时间必须晚于开始时间' : '';
  return <ActionDialog title="标记时间范围" className="time-range-dialog" onClose={onClose}><p>选定一段画面，再描述你希望怎样修改。当前视频共 {duration.toFixed(1)} 秒。</p><form onSubmit={event => { event.preventDefault(); if (!error) { onClose(); onConfirm(from, to); } }}><div className="time-range-fields"><label>开始时间（秒）<input aria-label="范围开始时间" type="number" min={0} max={duration} step="any" value={start} onChange={event => setStart(event.target.value)} autoFocus/></label><label>结束时间（秒）<input aria-label="范围结束时间" type="number" min={0} max={duration} step="any" value={end} onChange={event => setEnd(event.target.value)}/></label></div>{error ? <p className="form-error" role="alert">{error}</p> : null}<button className="time-range-submit" disabled={!!error}>添加这段的修改意见</button></form></ActionDialog>;
}
