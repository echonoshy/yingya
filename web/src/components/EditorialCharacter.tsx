import { useCinemaPlayback } from '../marketing/useCinemaPlayback';
import loginPoster from '../assets/editorial/login-girl.webp';
import loginMovie from '../assets/editorial/login-girl.mp4';
import createPoster from '../assets/editorial/create-girl.webp';
import createMovie from '../assets/editorial/create-girl.mp4';

/** Decorative identity only; never replaces a user's avatar or project media. */
export function EditorialCharacter({ variant }: { variant: 'login' | 'create' }) {
  const poster = variant === 'login' ? loginPoster : createPoster;
  const { videoRef, started } = useCinemaPlayback(variant === 'login' ? loginMovie : createMovie);
  return <div className="editorial-character">
    <img src={poster} width="1536" height="1024" alt={variant === 'login' ? '橙发小姑娘微笑着挥手' : '深蓝双丸子头的小姑娘抱着速写本思考'} style={{ visibility: started ? 'hidden' : 'visible' }} />
    <video ref={videoRef} poster={poster} autoPlay muted loop playsInline preload="none" aria-hidden="true" tabIndex={-1} />
  </div>;
}
