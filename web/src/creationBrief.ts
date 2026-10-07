/** Shared, concrete starting points for the homepage and creation workspace. */
export const briefSources = [
  { id: 'reference', label: '参考视频', title: '从参考视频开始', help: '粘贴视频链接，说说想借鉴的节奏、镜头或配色。', prompts: ['参考视频链接：\n想借鉴的节奏、镜头或配色：', '喜欢这支片子的节奏，内容换成我的产品', '保留参考片的画面质感，讲自己的故事'], hint: '视频链接：\n想借鉴什么？哪些内容换成自己的？' },
  { id: 'website', label: '复刻网站', title: '把喜欢的网站变成视频', help: '提供网址，说明要复刻的页面、视觉与交互。', prompts: ['网站链接：\n想复刻的页面与视觉：', '复刻这个网站的排版与配色，展示我的产品', '把这个网页的重点，转成有节奏的演示'], hint: '网站链接：\n复刻哪些页面、视觉或交互？视频讲什么？' },
  { id: 'script', label: '剧本', title: '把故事写得更具体', help: '提供剧本或大纲，交代人物、场景和故事发展。', prompts: ['故事大纲：\n人物、场景与结尾：', '从一次相遇开始，交代人物、转折与结尾', '用三个场景讲清这个故事，补充对白和旁白'], hint: '剧本或故事大纲：\n人物、场景、故事发展与希望传达的内容…' },
  { id: 'style', label: '风格', title: '先确定画面方向', help: '描述构图、色彩和质感，结合参考图会更清楚。', prompts: ['视觉风格：\n构图、配色与画面质感：', '纸感拼贴、暖色光线，用自己的素材讲故事', '简洁排版、克制配色，用节奏突出产品细节'], hint: '希望的构图、色彩、质感与运动节奏：\n作品的主题与观众是…' },
] as const;
export type BriefSource = typeof briefSources[number]['id'];
export const sourceBrief = (source: BriefSource) => briefSources.find(item => item.id === source)!;

export const briefTemplates = [
  { title: '产品介绍', description: '使用场景 → 产品亮点 → 行动', text: '产品介绍大纲：\n产品与目标观众：\n开场使用场景：\n需要展示的三个亮点：\n结尾希望观众采取的行动：\n参考链接或视觉风格：' },
  { title: '故事短片', description: '人物与场景 → 转折 → 结尾', text: '故事短片大纲：\n主角与场景：\n主角想完成什么：\n遇到的转折：\n故事结尾：\n对白、旁白与视觉风格：' },
  { title: '知识讲解', description: '提出问题 → 可视化解释 → 收获', text: '知识讲解大纲：\n面向谁、回答什么问题：\n内容依据与资料：\n用什么例子或图示解释：\n观众最后应该记住什么：\n参考链接或视觉风格：' },
] as const;
