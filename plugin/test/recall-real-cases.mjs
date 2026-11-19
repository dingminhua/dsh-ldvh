
export const REAL_CASES = [
  {
    q: "现在的召回内容，ai能快速找到对应的l1-l4层的信息吗？你测试一下",
    want: ["双源召回系统规范", "规范源与规范模型基础规范"],
    kind: "topic",
    basis: "问的是 L1–L4 读取层级能否取到内容：分层定义在 01 §10（L0–L4），承接面在 34。"
      + "两句都在规范源，事实源无对应条目不属标注遗漏。",
    jaccard: 0.18,
  },
  {
    q: "为什么测试总是在核对事实对象的数量，我觉得这种测试毫无意义",
    want: ["数量陈述与枚举清单条数不一致", "事实对象正文数量陈述未与源核对", "Code 实践与测试规范"],
    kind: "topic",
    basis: "两条 friction 正是「数量陈述与清单/源不一致」这一类失败；问句抱怨的正是该现象。",
    jaccard: 0.22,
  },
  {
    q: "这里有问题，你必须要明确一点，就是specs里放的是跨管辖范围的规范，事实对象放的是当前管辖的规范和决定",
    want: ["规范源与规范模型基础规范", "事实源与事实模型基础规范"],
    kind: "topic",
    basis: "陈述的是「规范源 vs 事实源」的职责划分，01 与 02 各自承载一半。",
    jaccard: 0.12,
  },
  {
    q: "召回系统是很重要的一环，其实是这三个价值的保障",
    want: ["双源召回系统规范", "理念与构成"],
    kind: "topic",
    basis: "直接在谈召回系统与核心价值的关系，34 §1 正是这段论证。",
    jaccard: 0.25,
  },
  {
    q: "检查现在召回系统是否符合设计要求",
    want: ["双源召回系统规范", "Norm-事实规范", "检查机制规范"],
    kind: "topic",
    basis: "核对召回实现与设计的一致性，权威判据在 34。",
    jaccard: 0.30,
  },
  {
    q: "预算只有一个总预算，为什么还有各种其他预算呢？",
    want: ["DSH 环境接入与插件发布规范", "双源召回系统规范"],
    kind: "topic",
    basis: "问注入预算的层级归属：预算归属在 10 §5.3，召回侧分配口径在 34 §11。",
    jaccard: 0.10,
  },

  {
    q: "先把好处理的处理掉",
    context: "评估当前待修的摩擦，哪些比较好处理的，先找出来",
    want: ["摩擦账本", "Friction-摩擦账本", "摩擦销账系统规范"],
    kind: "ellipsis",
    basis: "上文问的是「待修摩擦里哪些好处理」，本句是执行该决定。应得答案与上文同："
      + "摩擦账本与摩擦销账规范。",
  },
  {
    q: "那么下一批处理什么",
    context: "先把好处理的处理掉",
    want: ["摩擦账本", "Friction-摩擦账本", "摩擦销账系统规范"],
    kind: "ellipsis",
    basis: "承接同一批次处置的上下文，答案仍是摩擦处置相关。",
  },
  {
    q: "按你建议推进",
    context: "我说的是待修的里面23条，下一批做什么",
    want: ["摩擦账本", "摩擦销账系统规范", "Friction-摩擦账本"],
    kind: "ellipsis",
    basis: "上文是「待修摩擦的下一批」，本句是授权执行。",
  },
  {
    q: "你一个一个说",
    context: "这为什么还要问我呢",
    want: [],
    kind: "ellipsis",
    basis: "**本条如实保留空标注**：上文「这为什么还要问我呢」本身也没有项目主题"
      + "（是对流程的抱怨）。两句都不含可召回内容，故整对标注为空是正确的——"
      + "它守的是「抱怨对抱怨不该产生候选」这条边界，不作为「上文改法有效」的证据。",
  },
  {
    q: "提交吧",
    context: "清理一些无效的断言吧",
    want: ["Code 实践与测试规范", "受控提交与机械守护规范"],
    kind: "ellipsis",
    basis: "上文是清理无效断言（测试规范相关），本句是提交。应得答案与该上下文相关："
      + "受控提交与 06 测试规范。",
  },
  {
    q: "都修复了，对吗",
    context: "按你建议修复吧",
    want: [],
    kind: "ellipsis",
    basis: "上文「按你建议修复吧」也无具体主题（指代更早的对话），故本条标注为空——"
      + "如实登记这一对被上下文截断、无法判定答案。",
  },

  {
    q: "B（入库）",
    context: "关于docs的问题，应该改为如果有事实对象无法吸收的文档的是，可以放在docs里",
    want: ["事实源与事实模型基础规范", "业务系统基础规范"],
    kind: "ellipsis",
    basis: "上文在讨论「哪些文档该进 docs、哪些该进事实源」，本句是选项表态。"
      + "应得答案是事实源边界的承载条（02／03）。",
  },
  {
    q: "清理一些无效的断言吧",
    context: "为什么测试总是在核对事实对象的数量，我觉得这种测试毫无意义",
    want: ["Code 实践与测试规范"],
    kind: "ellipsis",
    basis: "上文在质疑数量型断言的意义；本句是据此清理。判据来源是 06 的测试纪律。",
  },
  {
    q: "维持现状，关闭spark",
    context: "dsh-ldvh@spark-d2b1474e-1049-49b5-b0b9-25e184f3253c 如何推进这个问题",
    want: ["Spark-火花", "火花记录系统规范"],
    kind: "ellipsis",
    basis: "上文在讨论某 spark 如何推进，本句是对它的处置决定。承载条是 20／31。",
  },
  {
    q: "现在就是补上规范就可以了对吗",
    context: "dsh-ldvh@spark-27a9dbfc-35ca-485e-83f8-182fd8f0f1c9 这个问题还存在吗",
    want: ["规范源与规范模型基础规范"],
    kind: "ellipsis",
    basis: "上文在核对某问题是否仍在，本句问是否只需补规范。承载条是 01。",
  },
  {
    q: "直接修改",
    context: "按你建议推进，同意修改20号",
    want: ["Spark-火花", "火花记录系统规范"],
    kind: "ellipsis",
    basis: "上文明确指向「20 号」（Spark 规范），本句是执行。若句子单独看则无主题——"
      + "这正是要测的形态：上文含编号载体，且它是否被利用决定成败。",
  },

  {
    q: "这个又是什么问题，检查一下是否属实",
    context: "spark-writer.js:933（以及 norm/friction/pitfall 各自的 list 函数）对文件名不匹配的载体一律 continue，静默吞掉。它和 localFactReader 的宽松正则口径不一致，才造成「工具查不到、Web 报得出」的分裂。",
    want: ["受控提交与机械守护规范", "事实源与事实模型基础规范"],
    kind: "ellipsis",
    basis: "上文讲的是载体文件名与 object_uid 不一致被静默吞掉——那正是事实源载入"
      + "与受控提交校验两处的缺口，02（载体身份）与 09（机械守护）是其承载条。",
  },

  {
    q: "批准执行",
    want: [],
    kind: "noise",
    basis: "审批动作本身不含主题；答案取决于上一条提请教的是什么。",
  },
  {
    q: "这为什么还要问我呢",
    want: [],
    kind: "noise",
    basis: "对流程的抱怨，无项目主题。",
  },
  {
    q: "你自己看着办",
    want: [],
    kind: "noise",
    basis: "完全放权表态，无主题。",
  },
  {
    q: "同意 重启就新建，然后要做什么",
    want: [],
    kind: "noise",
    basis: "前半句是表态，后半句「要做什么」是询问下一步；"
      + "上句是 norm 作废后重开的讨论。本句无主题词，属省略。",
  },
  {
    q: "都修复了，对吗",
    want: [],
    kind: "noise",
    basis: "核对完成度的短问，无主题。",
  },
  {
    q: "重启了",
    want: [],
    kind: "noise",
    basis: "状态通报，无项目主题。真实上文是「批准执行」——**两者都不含可召回内容**，"
      + "故整对无上述答案；本条守的是「状态通报不该产生候选」这条边界。",
  },

  {
    q: "dsh-ldvh@spark-69b1de3f-7202-4abe-9281-93a2840855e1 这个问题当前是什么状态",
    want: [],
    kind: "ref",
    basis: "引用式且目标是 spark：按 20 §12.1／31 §10 不进引导面自动注入，"
      + "注入面正确期望为空。该对象须由 AI 用 ldvh_spark_read 主动取。",
  },
  {
    q: "dsh-ldvh@spark-5b0b380e-c56f-40f8-bdb7-9645d8a54730 这个是什么问题",
    want: [],
    kind: "ref",
    basis: "引用式且目标是 spark，同上不进自动注入。",
  },
];

const TYPE_PREFIXES = ["Pitfall", "Friction", "Research", "Norm", "Spark", "Goal", "SubGoal"];

export function isTypeWant(w) {
  return typeof w === "string" && TYPE_PREFIXES.some((t) => w === t || w.startsWith(`${t}-`));
}

export function isRealCaseRelated(title, want, type) {
  if (!Array.isArray(want) || want.length === 0) return false;
  if (typeof title !== "string") return false;
  const typeLower = typeof type === "string" ? type.toLowerCase() : "";
  return want.some((w) => {
    if (typeof w !== "string" || w === "") return false;
    if (isTypeWant(w)) {
      const bare = w.split("-")[0].toLowerCase();
      return typeLower === bare;
    }
    return title.includes(w.slice(0, 6));
  });
}

export const REAL_CASE_KINDS = Object.freeze(["topic", "ellipsis", "noise", "ref"]);
