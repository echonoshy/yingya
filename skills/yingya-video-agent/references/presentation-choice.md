# 历史表现偏好的兼容

旧项目的 `presentation: {capabilityId, variant}` 表示用户的表现意图，
不代表当前已安装同名组件。保留已批准的设计与源码；没有该字段不强制模板。

| 历史 capabilityId | 当前实现方向 |
| --- | --- |
| flow-path | `explain-process`，按真实步骤编排，不为凑数虚构步骤 |
| infographic | Baoyu 信息结构参考，加原生 concept/comparison/data-change 或自定义 TSX |
| number-compare | `explain-data-change` 或 `explain-comparison`，保留真实数值、单位、共同尺度 |
| title-reveal | 原生 `interpolate/spring` 文字揭示，或已适配的 GSAP 中文文字效果 |
| beam-network | 自定义帧驱动 SVG，或 search/view/add 获取 Magic UI 源码后适配 |
| model-stage | 用户提供 GLB/glTF 后编写帧驱动 Three.js 场景；无预装同名模型组件，不承诺生成模型 |

原生组件用 `node "$YINGYA_COMPONENT_LIBRARY" catalog`、`view --component ID`、
`install --project . --component ID`，见 [remotion-authoring.md](remotion-authoring.md)。
公共 React 源码使用 [third-party-components.md](third-party-components.md) 中的
search/view/add，导入后仍须验证任意帧定位及导出。不要调用旧 `inspect` 命令，
也不要把原 Anime.js/HTML 组件当作现成的 Remotion 组件。

variant 是创作意图，不是通用组件参数。缺少模型、数据或素材时说明实际缺口；
局部修改沿用已批准设计，不恢复最初的偏好，不增加独立风格审批。
