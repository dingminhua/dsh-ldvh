import type { ComponentType } from 'react';
import {
  Activity,
  BookOpen,
  BrainCircuit,
  CircleHelp,
  ClipboardCheck,
  Cog,
  Combine,
  Compass,
  FileText,
  ClipboardList,
  FolderPlus,
  GitCommit,
  Github,
  GitPullRequestArrow,
  FileSignature,
  FolderTree,
  Globe2,
  Hand,
  Info,
  KeyRound,
  Layers,
  LayoutDashboard,
  Library,
  Lightbulb,
  Link2,
  MapPinned,
  Milestone,
  NotebookPen,
  PackageCheck,
  Receipt,
  Rocket,
  Route,
  Ruler,
  ShieldCheck,
  Shovel,
  Snail,
  Sparkles,
  Sprout,
  Target,
  Telescope,
  UserRound,
  Users,
  Waypoints,
  Workflow,
  type LucideProps,
} from 'lucide-react';

type SemanticIconComponent = ComponentType<LucideProps>;

function GitHubSilhouetteIcon({ size = 16, className, ...props }: LucideProps) {
  return <Github size={size} strokeWidth={0} fill="currentColor" className={className} {...props} />;
}

function FileSearchCornerIcon({ size = 16, className, strokeWidth = 2, ...props }: LucideProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      {...props}
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h5" />
      <path d="M14 2v6a2 2 0 0 0 2 2h4" />
      <path d="m14 2 6 6v4" />
      <circle cx="15.5" cy="16.5" r="3.5" />
      <path d="m18 19 3 3" />
    </svg>
  );
}

// eslint-disable-next-line react-refresh/only-export-components -- Sidebar 等 3 处消费；契约测试按本文件路径读取该常量，拆文件即打断共置断言。
export const OBJECT_TYPE_ICONS: Record<string, SemanticIconComponent> = {
  workcase: Shovel,
  adr: FileSignature,
  pitfall: Lightbulb,
  spark: Sparkles,
  research: FileSearchCornerIcon,
  // 26 号 Friction：摩擦账本——待修阻碍的账目（蜗牛=摩擦的体感结果：
  // 系统性阻碍拖慢每一次工作；Human 定案 2026-09-12，取代 Flame）。
  friction: Snail,
  // 27 号 Norm：事实规范——成体系方向规范（尺=约束与度量的直观物；
  // Human 定案 2026-09-12，取代 ScrollText）。
  norm: Ruler,
  // 25 号 Goal：项目目标——单例冻结锚（靶心=全部前向工作的统一引用顶点；
  // 与认知中心目标区同图标语义）。单例三免（无 tab 无 card），详情经
  // /goal 直读路由承载。
  goal: Target,
  // 28 号 SubGoal：子目标——目标层的下级锚点（Milestone＝路标：同一个方向上
  // 的下一个可判定站点；与 goal 的靶心区分开——靶心是整件事，路标是走到哪算成）。
  subgoal: Milestone,
  // 29 号 DevLog：开发日志——一次已收敛的过程性工作的结论条目（笔记本＋笔＝
  // 「这件事当时得出什么」被写下来的那一下）。与 norm 的 Ruler（度量）、
  // research 的放大镜式检索、pitfall 的 Lightbulb（醒悟）都不撞形。
  devlog: NotebookPen,
  change: GitCommit,
  // commit 形态关系的目标图标（02 §8.1）：解药是一次受控提交。狐狸＝侧栏那只，
  // 实心填充，与 change 的线框 GitCommit 区分开——读者一眼知道这是提交而非工单。
  // commit 形态关系的目标图标（02 §8.1）：解药是一次受控提交。复用 changelog
  // 的图标——侧栏「提交」那一项用的就是它（Human 指定 2026-10-10：用现成的，
  // 不要另造）。实心剪影，与线框的 change 区分开。
  commit: GitHubSilhouetteIcon,
  changelog: GitHubSilhouetteIcon,
};

const COLLECTION_ICONS: Record<string, SemanticIconComponent> = {
  workcase: Shovel,
  plan: ClipboardList,
  properties: FileText,
  docs: FileText,
  related: Link2,
  progress: Workflow,
};

/**
 * 导航入口图标（09 §8「图标映射集中在 SemanticIcon.tsx，页面不得自行散落图标选择」）。
 *
 * 对象类入口继续取 `OBJECT_TYPE_ICONS`（同一类型在导航、列表、详情、引用处同一图标，
 * 09 §2 第 1 条）；此处只登记**不指向事实对象**的入口——它们没有对象身份可继承，
 * 过去由 `Sidebar` 各自直接 import lucide，帮助页若要照抄就得再散一份，故收进单源。
 */
// eslint-disable-next-line react-refresh/only-export-components -- 与 OBJECT_TYPE_ICONS 同理：Sidebar 与帮助页共同消费，拆文件即打断共置断言。
export const NAV_ICONS: Record<string, SemanticIconComponent> = {
  // 聚焦=仪表盘（认知中心入口，Human 定案 2026-07-30 换回 LayoutDashboard）。
  cognition: LayoutDashboard,
  // 目录=文件树（项目文件树入口）。
  projectFiles: FolderTree,
  // 变更=拉取请求箭头（工作树未提交改动入口）。
  changes: GitPullRequestArrow,
  // 提交=GitHub 剪影（与 changelog 同一图形：它是提交记录入口，不是工作对象）。
  changelog: GitHubSilhouetteIcon,
  // 帮助=带钉地图（导览/漫游指南；Human 终选 2026-09-12，历经
  // CircleHelp→MapPinned→单独问号→回到 MapPinned）。
  help: MapPinned,
  // 诊断=活动指示（运行时诊断入口，Human 定案 2026-10-18）。
  diagnostics: Activity,
  // 全部项目=地球（联邦聚合视图入口，由项目切换器进入）。
  federation: Globe2,
};

/**
 * 业务系统图标（09 §8「图标映射集中在 SemanticIcon.tsx，页面不得自行散落图标选择」）。
 *
 * **为什么单列一份**：七大业务系统（03 §9.1–§9.7）是**规范层的过程**，不是事实对象，
 * 没有对象身份可继承 `OBJECT_TYPE_ICONS`——它们的结论落在对象上，但系统本身没有对象。
 * 帮助页要讲这七个系统的职能与用法，就得有一份系统自己的图形映射；散在页面里等于再散一份。
 *
 * **选形纪律**：与对象类型图标全部错开形（读者一眼分得清「这是对象」还是「这是系统」），
 * 且七个彼此不撞：路标排（目标规划）、嫩芽（火花记录）、齿轮（工单执行）、望远镜
 * （调研吸收）、合并（双源召回）、书架（经验积累）、票据（摩擦销账）。
 */
// eslint-disable-next-line react-refresh/only-export-components -- 与 OBJECT_TYPE_ICONS / NAV_ICONS 同理：帮助页消费，拆文件即打断共置断言。
export const SYSTEM_ICONS: Record<string, SemanticIconComponent> = {
  // 目标规划=路标排（Waypoints＝一条方向上的多个判定站点，与 subgoal 的单个 Milestone
  // 路标区分开：系统负责把目标拆成一串站点，对象只是其中一个）。
  goalPlanning: Waypoints,
  // 火花记录=嫩芽（Sprout＝刚冒出来、还没定型的念头；与 spark 对象的 Sparkles 星芒
  // 区分开：那是被登记之后的形态，这里是它出生前的样）。
  sparkRecord: Sprout,
  // 工单执行=齿轮（ Cog＝已经批准之后才转起来的机制；与 workcase 对象的 Shovel
  // 铲子区分开：铲子是那件工作的载体，齿轮是它运转的机制）。
  workOrder: Cog,
  // 调研吸收=望远镜（Telescope＝朝还没掌握的方向看；与 research 对象的
  // FileSearchCornerIcon 检索式图形区分开：那是报告载体，这是找证据这件事）。
  researchAbsorb: Telescope,
  // 双源召回=合并（Combine＝规范源与事实源两股并成一股当前约束；它是横切过程，
  // 不留对象，所以图形不能是任何一件东西的形状）。
  dualRecall: Combine,
  // 经验积累=书架（Library＝沉下来能反复取用的存量；与 pitfall 对象的 Lightbulb
  // 醒悟区分开：那是一次教训，这是教训被收起来之后的样子）。
  experience: Library,
  // 摩擦销账=票据（Receipt＝一笔一笔记着的账；与 friction 对象的 Snail 蜗牛
  // 区分开：蜗牛是阻碍本身的体感，票据是它被记在账上的样子）。
  friction: Receipt,
};

/**
 * 帮助页分区图标（09 §8 同理：映射单源，页面不得自行散落图标选择）。
 *
 * **这是什么形状**：七个分区切换按钮的**分区提示符**——它们回答「这一格讲的是哪一类
 * 事情」，不是对象身份，也不是状态。与 `OBJECT_TYPE_ICONS`（这是什么对象）、
 * `SYSTEM_ICONS`（这件事由谁管）、`NAV_ICONS`（这是哪个入口）三族全部错开形，
 * 读者不会把分区图标误读成对象图标。
 *
 * **选形**：火箭（如何开始）、打开的书（这是什么）、层叠（有哪些东西）、路径（事情怎么
 * 推进）、举手（什么时候该你出面）、罗盘（去哪儿看）、盾牌（怎么判断可信）。
 */
// eslint-disable-next-line react-refresh/only-export-components -- 与 OBJECT_TYPE_ICONS / NAV_ICONS / SYSTEM_ICONS 同理：帮助页消费，拆文件即打断共置断言。
export const HELP_TAB_ICONS: Record<string, SemanticIconComponent> = {
  start: Rocket,
  overview: BookOpen,
  objects: Layers,
  systems: Route,
  gates: Hand,
  entries: Compass,
  trust: ShieldCheck,
};

/**
 * 帮助页内容图标：概览三张对照（AI 的短板 / 人的短板 / 双方叠加）、五类交互入口的
 * 触发标记、声明条的信息标记。
 *
 * **为什么登记**：09 §6 允许 Card 语义区标题用语义图标，但要求「必须通过统一组件
 * 输出，不在页面里临时拼写」；本页此前直接 import 了九枚图标，映射散在页面文件里。
 * 收进单源后，改形只需改一处。
 *
 * **与既有族错开**：概览三张用「脑 / 人 / 群」三种人形关系标记，与对象族（铲子、灯泡、
 * 星芒…）和系统族（路标排、嫩芽、齿轮…）都不撞；五类交互入口用各自的动作物（问号、
 * 剪贴板、钥匙、包裹、加号文件夹），不借用任何对象或系统的图形。
 */
// eslint-disable-next-line react-refresh/only-export-components -- 同上。
export const HELP_ICONS: Record<string, SemanticIconComponent> = {
  ai: BrainCircuit,
  human: UserRound,
  amplify: Users,
  inquiry: CircleHelp,
  plan: ClipboardCheck,
  authorization: KeyRound,
  handover: PackageCheck,
  registration: FolderPlus,
  info: Info,
};

type SemanticIconProps = Omit<LucideProps, 'ref'> & {
  type?: string | null;
};

export function ObjectTypeIcon({ type, size = 14, ...props }: SemanticIconProps) {
  const Icon = type ? (OBJECT_TYPE_ICONS[type] ?? Link2) : Link2;
  return <Icon size={size} aria-hidden="true" {...props} />;
}

export function CollectionTitleIcon({ type, size = 14, ...props }: SemanticIconProps) {
  const Icon = type ? (COLLECTION_ICONS[type] ?? Link2) : Link2;
  return <Icon size={size} aria-hidden="true" {...props} />;
}
