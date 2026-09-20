import media from "../knowledgeExamples.json";

const examples = [
  {id:"pendulum", title:"把物理关系讲明白", description:"单摆周期 · 用示意图和公式解释原因"},
  {id:"compound-interest", title:"让数字变得好理解", description:"复利示例 · 假设数据与逐步计算"},
  {id:"walkthrough", title:"结合素材讲清操作", description:"操作说明 · 录屏、画面标注与讲解"},
] as const;

export function KnowledgeExamples() {
  return <section className="knowledge-examples" aria-labelledby="knowledge-examples-title" onPlayCapture={event => {
    const playing = event.target;
    if (!(playing instanceof HTMLVideoElement)) return;
    event.currentTarget.querySelectorAll("video").forEach(video => { if (video !== playing) video.pause(); });
  }}>
    <header><h2 id="knowledge-examples-title">看看内容可以怎样讲</h2><p>播放真实作品，感受不同内容的讲解方式。</p></header>
    <div className="knowledge-example-grid">{examples.map(item => <article key={item.id}>
      <video controls playsInline preload="none" poster={media[item.id].poster} src={media[item.id].video} aria-label={`${item.title}示例`}/>
      <h3>{item.title}</h3><p>{item.description}</p>
    </article>)}</div>
  </section>;
}
