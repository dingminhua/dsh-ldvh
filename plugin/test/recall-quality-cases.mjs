
export const QUALITY_CASES = [
  { q: "页面白屏了怎么办", want: ["无基址构建致 SPA 白屏"], jaccard: 0.07 },
  { q: "前端构建出来打开是空白的", want: ["无基址构建致 SPA 白屏"], jaccard: 0.05 },
  { q: "改字段名之后读取那边没跟着改", want: ["字段改名后读取侧与契约断言未同步"], jaccard: 0.11 },
  { q: "提交被门禁拒绝了", want: ["Git Gate 双向路径覆盖拦截"], jaccard: 0.0 },
  { q: "加了一条校验但没测过它能不能真发现问题", want: ["Code 实践与测试规范"], jaccard: 0.08 },
  { q: "插件重新加载以后子代理的记录都没了", want: ["插件重建清空子代理登记表致复核记录恒被拒"], jaccard: 0.06 },
  { q: "热重载的时候好像同时装了两份", want: ["重载窗口多实例致钩子重复且互相摘除"], jaccard: 0.05 },
  { q: "这次改动会不会把已有的缓存弄坏", want: [], jaccard: 0.0,
    known_gap: "已澄清：目标 friction 已 resolved，按 26 §12 不进默认候选——want 留空是正确期望" },

  { q: "实际给出的都是有价值的信息吗？还是为了给而给的？", want: [], jaccard: 0.0 },
  { q: "按你建议推进", want: [], jaccard: 0.0 },
  { q: "这样做好不好", want: [], jaccard: 0.0 },
  { q: "谢谢，先这样吧", want: [], jaccard: 0.0 },
];

export function isRelated(title, want) {
  if (want.length === 0) return false;
  return want.some((w) => title.includes(w.slice(0, 6)));
}
