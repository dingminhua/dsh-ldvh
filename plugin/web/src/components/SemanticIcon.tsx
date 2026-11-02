import type { ComponentType } from 'react';
import {
  Activity,
  FileText,
  ClipboardList,
  GitCommit,
  Github,
  GitPullRequestArrow,
  FileSignature,
  FolderTree,
  Globe2,
  LayoutDashboard,
  Lightbulb,
  Link2,
  MapPinned,
  Milestone,
  NotebookPen,
  Ruler,
  Shovel,
  Snail,
  Sparkles,
  Target,
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
