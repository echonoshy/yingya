import { ArrowRight } from "@phosphor-icons/react";
import { productWorkflows, type ProductWorkflowId } from "../productWorkflows";

export function ProductExamples({ onChoose }: { onChoose: (id: ProductWorkflowId) => void }) {
  return <section className="product-examples" aria-labelledby="product-examples-title"><header><h2 id="product-examples-title">先看看成片效果</h2><p>用映芽的真实产品素材制作，换成你的内容继续创作。</p></header>
    <div className="product-example-grid">{productWorkflows.map(item => <article key={item.id}>
      <video controls preload="none" playsInline poster={`/product-examples/${item.id}.jpg`} src={`/product-examples/${item.id}.mp4`} aria-label={`${item.name}样片`}/>
      <div><span><b>{item.name}</b><small>{item.duration} 秒</small></span><button type="button" aria-label={`制作类似视频：${item.name}`} onClick={() => onChoose(item.id)}>制作类似视频<ArrowRight/></button></div>
    </article>)}</div>
  </section>;
}
