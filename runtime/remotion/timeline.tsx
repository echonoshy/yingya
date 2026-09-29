import React from 'react';
import {AbsoluteFill, Audio, OffthreadVideo, Sequence, staticFile} from 'remotion';

// The host owns media scheduling so the manifest used for delivery verification
// describes the actual nodes rendered, rather than a second author-written list.
export function createTimeline(Video, media) {
  return function Timeline(props) {
    return <AbsoluteFill>
      {media.map(clip => <Sequence key={clip.id} from={clip.from} durationInFrames={clip.durationInFrames}>
        {clip.type === 'audio'
          ? <Audio src={staticFile(clip.src.slice(7))} trimBefore={clip.trimBefore} volume={clip.volume} muted={clip.muted} />
          : <OffthreadVideo data-yingya-media={clip.id} src={staticFile(clip.src.slice(7))}
              trimBefore={clip.trimBefore} volume={clip.volume} muted={clip.muted}
              style={{position:'absolute', width:'100%', height:'100%', objectFit:'contain', ...clip.style}} />}
      </Sequence>)}
      <AbsoluteFill><Video {...props} /></AbsoluteFill>
    </AbsoluteFill>;
  };
}
