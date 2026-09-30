import "./marketing.css";
import "./printHome.css";
import "./splitHome.css";
import { ArrowUp, ArrowUpRight, GithubLogo } from "@phosphor-icons/react";
import { BrandLogo } from "./BrandLogo";
import { useCinemaPlayback } from "./useCinemaPlayback";
import city from "../assets/home-cinema/02-sunset-panorama.webp";
import movie from "../assets/home-cinema/yingya-six-scenes-v2.mp4";
import sea from "../assets/home-cinema/04-seaside.webp";
import seaMovie from "../assets/home-cinema/04-seaside.mp4";
import door from "../assets/home-cinema/03-light-passage.webp";
import train from "../assets/home-cinema/05-night-train.webp";

const createUrl = "/app";

function HeroFilm() {
  const media = useCinemaPlayback(movie);
  return <div className="cinema-screening" id="screening">
    <div className="cinema-scene">
      <img className={media.started ? "cinema-poster cinema-poster--hidden" : "cinema-poster"}
        src={city} alt="小映坐在屋顶，远望橙色夕阳下的城市" width="1344" height="768" fetchPriority="high" />
      <video ref={media.videoRef} poster={city} autoPlay loop muted playsInline preload="none" aria-hidden="true" tabIndex={-1} />
    </div>
  </div>;
}

function Journey() {
  const media = useCinemaPlayback(seaMovie);
  return <section className="scene-journey" id="about-yingya" aria-labelledby="journey-title">
    <div className="journey-heading">
      <h2 id="journey-title">带上灵感，<br />让故事发生</h2>
      <div className="journey-intro">
        <p>一份资料，一个网页<br />或是脑海里闪过的念头<br />和映芽一起，把它变成一段好故事</p>
        <a href={createUrl}>开始你的故事<ArrowUpRight aria-hidden="true" /></a>
      </div>
    </div>
    <div className="journey-frames">
      <figure className="journey-frame journey-frame--door">
        <img src={door} alt="小映穿过深蓝长廊，走向一扇明亮的光门" width="1344" height="768" loading="lazy" />
        <figcaption><span>01 / 想象</span><em lang="en">What if?</em></figcaption>
      </figure>
      <figure className="journey-frame journey-frame--sea">
        <div className="journey-moving-frame">
          <img src={sea} className={media.started ? "cinema-poster--hidden" : ""} alt="小映举起相机，记录海边的落日和飞鸟" width="1344" height="768" loading="lazy" />
          <video ref={media.videoRef} poster={sea} autoPlay loop muted playsInline preload="none" aria-hidden="true" tabIndex={-1} />
        </div>
        <figcaption><span>02 / 看见</span><em lang="en">Look a little closer.</em></figcaption>
      </figure>
      <figure className="journey-frame journey-frame--train">
        <img src={train} alt="小映坐在夜行列车上，窗外的城市灯光掠过" width="1344" height="768" loading="lazy" />
        <figcaption><span>03 / 出发</span><em lang="en">And, action.</em></figcaption>
      </figure>
    </div>
  </section>;
}

export function MarketingPage() {
  return <div className="marketing-page cinema-home split-preview">
    <a className="marketing-skip" href="#main-content">跳到主要内容</a>
    <header className="cinema-header" id="page-top">
      <BrandLogo href="#page-top" compact />
      <nav aria-label="官网导航">
        <a className="github-link" href="https://github.com/echonoshy/yingya" target="_blank" rel="noopener noreferrer"><GithubLogo weight="fill" aria-hidden="true" />GitHub</a>
        <a href={createUrl}>进入创作<ArrowUpRight aria-hidden="true" /></a>
      </nav>
    </header>
    <main id="main-content" tabIndex={-1}>
      <section className="cinema-hero" aria-labelledby="marketing-title">
        <div className="cinema-copy">
          <p className="cinema-motto" lang="en">A moving story.</p>
          <h1 id="marketing-title"><span>让想法</span><span>有声有色</span></h1>
          <div className="cinema-introduction">
            <p className="cinema-intro">把资料、想法和素材<br />变成讲得清楚的视频</p>
            <a className="cinema-start" href={createUrl}>开始创作<ArrowUpRight aria-hidden="true" /></a>
          </div>
        </div>
        <HeroFilm />
      </section>
      <Journey />
    </main>
    <footer className="cinema-footer">
      <BrandLogo href="#page-top" compact />
      <p>带上灵感，剩下的交给映芽</p>
      <a href="#page-top">回到顶部<ArrowUp aria-hidden="true" /></a>
    </footer>
  </div>;
}
