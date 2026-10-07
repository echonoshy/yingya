import {Composition,Folder,registerRoot,delayRender,continueRender,cancelRender} from 'remotion';
import {fontsReady} from './design';
import {Edit} from './Edit';
import {EditCut} from './EditCut';
import {EditFinish} from './EditFinish';
import {Effects} from './Effects';
import {Voice} from './Voice';
import {Charts} from './Charts';
const fontHandle=delayRender('Local editorial typefaces');
fontsReady.then(()=>continueRender(fontHandle)).catch(cancelRender);
function Root(){return <>
 <Composition id="Effects" component={Effects} width={1600} height={900} fps={30} durationInFrames={150}/>
 <Composition id="Voice" component={Voice} width={1600} height={900} fps={30} durationInFrames={180}/>
 <Composition id="Charts" component={Charts} width={1600} height={900} fps={30} durationInFrames={150}/>
 <Composition id="Edit" component={Edit} width={1600} height={900} fps={30} durationInFrames={150}/>
 <Folder name="Edit-scenes">
  <Composition id="EditCut" component={EditCut} width={1600} height={900} fps={30} durationInFrames={96}/>
  <Composition id="EditFinish" component={EditFinish} width={1600} height={900} fps={30} durationInFrames={54}/>
 </Folder>
 </>}
registerRoot(Root);
