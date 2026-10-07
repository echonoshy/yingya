import {Sequence} from 'remotion';
import {EditCut} from './EditCut';
import {EditFinish} from './EditFinish';
export function Edit(){return <><Sequence name="精剪胶片" durationInFrames={96}><EditCut/></Sequence><Sequence name="剪辑落版" from={96} durationInFrames={54}><EditFinish/></Sequence></>;}
