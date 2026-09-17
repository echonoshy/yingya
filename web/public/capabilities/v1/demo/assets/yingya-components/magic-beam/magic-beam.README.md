# 分支与汇聚光束（Magic UI）

`beam-network` 适合表达「多个素材汇成一个方案」「一个系统分发到多个渠道」和服务集成关系。
已有 Anime.js `flow-path` 适合两到五步的线性过程；数字对比、标题揭示也已有实现，不为这些能力再装 Magic UI 同类组件。

此组件实际复用 Magic UI AnimatedBeam 的二次贝塞尔路径、四段渐变、正反方向与缓动曲线。
上游原始 TSX 和 MIT 许可逐字保留，固定提交与文件 SHA256 见 `magic-beam.PROVENANCE.json`。
原始 React/Motion 文件用于来源审阅，不应直接执行；视频适配只需要本地 `magic-beam.js`、CSS 和统一时钟，
没有新增 React、Motion、CDN、随机计时或永久动画循环。

## 接入

通过统一组件安装器获取文件，保留本目录的许可证和来源信息。
先加载统一 `clock.js`，再加载本目录 CSS 和 `magic-beam.js`，通过同一个入口创建镜头：

```js
const scene = YingyaComponents.createScene(document.querySelector('#network'), {
  component: 'beam-network', startSeconds: 2, durationSeconds: 6,
  nodes: [
    { id: 'text', label: '文案', x: .16, y: .2 },
    { id: 'image', label: '图片', x: .16, y: .5 },
    { id: 'audio', label: '声音', x: .16, y: .8 },
    { id: 'story', label: '组织镜头', x: .5, y: .5 },
    { id: 'film', label: '生成视频', x: .84, y: .5 }
  ],
  edges: [
    { from: 'text', to: 'story', durationSeconds: 3 },
    { from: 'image', to: 'story', delaySeconds: .3, durationSeconds: 3 },
    { from: 'audio', to: 'story', delaySeconds: .6, durationSeconds: 3 },
    { from: 'story', to: 'film', delaySeconds: 2, durationSeconds: 3 }
  ]
});
```

`createScene` 负责统一注册，不能把同一实例再注册一次。运行时通过 `renderAt(globalSeconds)`
接收全片秒数；`startSeconds` 只减一次。镜头开始前隐藏，动画结束后保留节点和连接线，
最后一段留给观众阅读。外层画面的入场、退场由作品主时间轴负责。
`dispose()` 只清理本实例创建的 DOM，不影响其他实例；统一桥接负责注销。

## 图和时间约束

- 容器必须已连接、为空且具有明确宽高。画幅内位置是 `[0,1]` 的归一化坐标，标签使用字面文字；每个标签最多 24 字。
- 2—24 个节点、1—48 条边。节点 ID 必须唯一；边必须连接两个存在且位置不同的节点。
- 竖屏请主动调整构图：上方三个输入使用 `(.2,.2)、(.5,.2)、(.8,.2)`，汇聚节点 `(.5,.5)`，输出 `(.5,.8)`。不要把宽屏三列坐标直接套到狭窄画幅；边界附近给标签留余量。
- `startSeconds` 为全片开始时间，0—86400；`durationSeconds` 为本镜头时长，0.1—120。
- 每条边的 `delaySeconds` 从本镜头开始计算，默认 0；`durationSeconds` 默认镜头时长的 65%。
- `iterations` 默认为 1，可设置有限整数 1—20；`repeatDelaySeconds` 默认为 0。所有重复和间隔必须完整落在镜头时长内；不接受无限循环。
- `reverse: true` 表示从 `to` 向 `from` 流动。`curvature` 为 `[-1,1]` 的竖向控制点偏移比例，单位为容器短边；0 复用上游默认曲线。
- 布局在创建时计算，播放中不测量 DOM。预览整体 CSS 缩放不会改变路径；真正修改容器画幅后请销毁并重建。

## 视觉与验证

调色板由该作品的 `DESIGN.md` 决定。复用 `--film-ink`、`--film-accent`、`--film-surface`、`--film-line`、
`--film-font`、`--film-radius`，或显式传对应 `--ygc-*` 样式变量。可调参数还有：
`--ygc-node-font-size`、`--ygc-node-width`、`--ygc-node-min-width`、`--ygc-node-padding`、
`--ygc-beam-width`、`--ygc-track-opacity`、`--ygc-gradient-start`、`--ygc-gradient-stop`。
不要把网站 UI 的减少动效设置带进成片；视频帧必须只由视频时间决定。

测试 `node --test tests/magic-beam.test.mjs` 覆盖许可来源、参数约束、多实例隔离、
任意时间跳转与回退、暂停不漂移、有限重复、横竖画幅、预览缩放、文本注入和销毁。
集成作品仍要按统一流程检查每个镜头的中间帧、标签碰撞、预览播放与实际 MP4 导出。
