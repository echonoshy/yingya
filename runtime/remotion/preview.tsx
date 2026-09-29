import React, {useEffect, useRef} from 'react';
import {createRoot} from 'react-dom/client';
import {Player} from '@remotion/player';

export function mountPreview(component, config) {
  const {width, height, fps, durationInFrames} = config.composition;
  window.remotion_staticBase = new URL('assets', window.location.href).pathname;
  function Preview() {
    const ref = useRef(null);
    useEffect(() => {
      const player = ref.current;
      if (!player) return;
      window.__yingyaRemotionPlayer = player;
      const position = ({detail}) => parent.postMessage({type:'yingya-preview-position', time:detail.frame / fps}, '*');
      const error = ({detail}) => {window.__yingyaRemotionError = String(detail.error); parent.postMessage({type:'yingya-preview-error', message:String(detail.error)}, '*');};
      const command = event => {
        if (event.source !== parent || event.data?.type !== 'yingya-preview-playback' || typeof event.data.playing !== 'boolean') return;
        player.pause();
        if (Number.isFinite(event.data.time)) player.seekTo(Math.max(0, Math.min(durationInFrames - 1, Math.round(event.data.time * fps))));
        if (event.data.playing) player.play();
      };
      player.addEventListener('frameupdate', position);
      player.addEventListener('error', error);
      window.addEventListener('message', command);
      parent.postMessage({type:'yingya-preview-position', time:0}, '*');
      return () => {
        player.removeEventListener('frameupdate', position);
        player.removeEventListener('error', error);
        window.removeEventListener('message', command);
        delete window.__yingyaRemotionPlayer;
      };
    }, []);
    return <Player ref={ref} component={component} inputProps={config.props}
      compositionWidth={width} compositionHeight={height} fps={fps} durationInFrames={durationInFrames}
      controls={false} autoPlay={false} loop style={{width:'100%', height:'100%'}}
      errorFallback={({error}) => <div role="alert">预览加载失败：{error.message}</div>} />;
  }
  createRoot(document.getElementById('root')).render(<Preview />);
}
