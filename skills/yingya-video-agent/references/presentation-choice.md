# 首页选择的表现方式

`.yingya/requirements.json` 的可选 `presentation: { capabilityId, variant }` 是用户主动选择的初始表现偏好。按 creative-brief.md 把它写入方案的视觉主体、动作和适用镜头，再沿用现有方案确认与制作流程，不增加单独的样式确认点。后续用户明确修改优先；局部修改不能因此重置已批准画面。没有此字段时不强制任何组件。

| capabilityId | variant（呈现意图） | 能力与素材要求 |
| --- | --- | --- |
| model-stage | turntable 缓慢旋转；orbit 镜头环绕；still 静态展示 | 已适配 Three.js 模型组件；需要用户提供可加载的 GLB/glTF 及依赖。首页耳机是概念图，演示为几何模型，不能当作用户产品，也不能声称已生成 3D 模型。 |
| flow-path | three-steps 三步流程；four-steps 四步讲解；five-steps 五步展开 | Anime.js 线性流程组件；按实际步骤组织，不为凑数捏造步骤。 |
| infographic | structure 结构拆解；hierarchy 层级讲解；comparison 前后对比 | 使用 design/index.md 的 Baoyu 布局与图解参考，按内容实现可编辑动画。当前没有接入完整 Baoyu 自动生成工作流；这不是可安装的组件 ID。 |
| title-reveal | opening 开场标题；chapter 章节提示；closing 结尾主张 | Anime.js 标题组件；替换成用户短句，安排标题揭示与强调线节奏。 |
| number-compare | before-after 前后对比；metrics 两项指标；change 变化结果 | Anime.js 数字对比；需要真实数值、单位及来源。不得使用演示数字充当用户事实。 |
| beam-network | converge 多路汇聚；branch 分支展开；system 系统连接 | 已适配 Magic UI 关系连线组件；按实际节点与关系配置。不是整个 Magic UI 库都能直接用于视频。 |

除 infographic 外，使用 runtime-tools.md / third-party-components.md 的组件库工具，先 inspect 对应 ID，再 install 到项目并按组件 README 的正式 API 接入。variant 是创作意图，不是通用组件参数；只有 model-stage 的三种值直接对应 motion，其余转成组件支持的内容与布局配置。不要复制首页演示页面作为最终作品，不要在项目内安装上游依赖。

所选方式优先用于合适镜头，可以与实拍、图片、文字及其他镜头组合，不把整片强制套同一种表现。尊重用户的真实素材、品牌和数据；缺少关键输入时沿用方案阶段说明与补充流程，不伪造素材或效果。组件不可用时说明原因与可行替代。
