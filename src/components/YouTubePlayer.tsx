import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { ExternalLink, Radio } from 'lucide-react';

type Player = {
  loadVideoById(id: string): void; playVideo(): void; pauseVideo(): void; destroy(): void;
  setVolume(value: number): void; seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number; getDuration(): number;
};
type YTWindow = Window & { YT?: { Player: new (element: HTMLElement, options: unknown) => Player }; onYouTubeIframeAPIReady?: () => void };
let apiPromise: Promise<void> | undefined;
function loadAPI() {
  if ((window as YTWindow).YT?.Player) return Promise.resolve();
  if (!apiPromise) apiPromise = new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('YouTube ne répond pas. Vérifiez votre connexion ou votre bloqueur de contenu.')), 20000);
    const w = window as YTWindow;
    const previous = w.onYouTubeIframeAPIReady;
    w.onYouTubeIframeAPIReady = () => { clearTimeout(timer); previous?.(); resolve(); };
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.onerror = () => { clearTimeout(timer); reject(new Error('Connexion à YouTube impossible. Vérifiez votre connexion.')); };
    document.head.appendChild(script);
  }).catch(error => { apiPromise = undefined; throw error; });
  return apiPromise;
}
export type PlayerHandle = { seek(seconds: number): void; resume(): void };
type Props = {
  videoId: string | null; playing: boolean; volume: number;
  onPlaying(playing: boolean): void; onEnded(): void;
  onProgress(time: number, duration: number): void; onError(message: string, code?: number): void;
};
export const YouTubePlayer = forwardRef<PlayerHandle, Props>(function YouTubePlayer(props, ref) {
  const host = useRef<HTMLDivElement>(null);
  const player = useRef<Player | null>(null);
  const latest = useRef(props); latest.current = props;
  const loadedId = useRef<string | null>(null);
  const [ready, setReady] = useState(false);
  const [problem, setProblem] = useState('');
  const [attempt, setAttempt] = useState(0);
  useImperativeHandle(ref, () => ({ seek: seconds => player.current?.seekTo(seconds, true), resume: () => player.current?.playVideo() }), []);
  const active = Boolean(props.videoId);
  useEffect(() => {
    if (!active) return;
    let canceled = false;
    let instance: Player | null = null;
    loadAPI().then(() => {
      if (canceled || !host.current) return;
      const element = document.createElement('div');
      host.current.replaceChildren(element);
      const initialId = latest.current.videoId;
      instance = new (window as YTWindow).YT!.Player(element, {
        width: '100%', height: '100%', videoId: initialId,
        playerVars: { autoplay: 1, playsinline: 1, origin: window.location.origin, rel: 0 },
        events: {
          onReady: () => {
            if (canceled || !instance) return;
            player.current = instance;
            loadedId.current = initialId;
            instance.setVolume(latest.current.volume);
            if (latest.current.playing) instance.playVideo(); else instance.pauseVideo();
            setReady(true);
          },
          onStateChange: ({ data }: { data: number }) => {
            if (canceled) return;
            if (data === 1) { setProblem(''); latest.current.onPlaying(true); }
            if (data === 2) latest.current.onPlaying(false);
            if (data === 0) latest.current.onEnded();
          },
          onAutoplayBlocked: () => {
            if (canceled) return;
            latest.current.onPlaying(false);
            setProblem('Cliquez sur Lecture dans la vidéo pour commencer.');
          },
          onError: ({ data }: { data: number }) => {
            if (canceled) return;
            const message = data === 100 ? 'Cette vidéo est indisponible ou privée.' : data === 101 || data === 150 ? 'Cette vidéo refuse la lecture intégrée. Choisissez une autre version ou ouvrez YouTube.' : data === 153 ? 'YouTube refuse cette origine. Ouvrez Thrum via son serveur local ou en HTTPS.' : 'La lecture YouTube a échoué. Essayez un autre titre.';
            setProblem(message); latest.current.onPlaying(false); latest.current.onError(message, data);
          },
        },
      });
    }).catch((error: Error) => { if (!canceled) { setProblem(error.message); latest.current.onPlaying(false); latest.current.onError(error.message); } });
    const interval = window.setInterval(() => {
      const p = player.current;
      if (p) latest.current.onProgress(p.getCurrentTime() || 0, p.getDuration() || 0);
    }, 500);
    return () => { canceled = true; clearInterval(interval); instance?.destroy(); player.current = null; loadedId.current = null; setReady(false); };
  }, [active, attempt]);
  useEffect(() => {
    const p = player.current;
    if (!p || !ready || !props.videoId) return;
    if (loadedId.current !== props.videoId) {
      loadedId.current = props.videoId;
      setProblem('');
      p.loadVideoById(props.videoId);
    }
    if (props.playing) p.playVideo(); else p.pauseVideo();
  }, [props.videoId, props.playing, ready]);
  useEffect(() => { player.current?.setVolume(props.volume); }, [props.volume, ready]);
  return <>
    <div className={`video-frame ${active ? 'is-active' : ''}`}>
      <div ref={host} className="video-host"/>
      {!active && <div className="video-placeholder"><Radio size={30}/><span>Votre prochaine écoute<br/>commence ici.</span></div>}
    </div>
    {problem && <p className="player-error" role="status">{problem} <button className="text-link" onClick={() => { setProblem(''); setAttempt(value => value + 1); }}>Réessayer</button></p>}
    {props.videoId && <a className="text-link youtube-link" href={`https://www.youtube.com/watch?v=${props.videoId}`} target="_blank" rel="noopener noreferrer">Ouvrir sur YouTube <ExternalLink size={12}/></a>}
  </>;
});
