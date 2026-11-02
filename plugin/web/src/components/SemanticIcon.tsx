import type { ComponentType } from 'react';
import {
  FileText,
  ClipboardList,
  GitCommit,
  Github,
  FileSignature,
  Lightbulb,
  Link2,
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

/** 裸问号（无外圈）。关联行末「待处理（等一个决定）」族用（Human 定案 2026-11-02：
 * 「有没有单个问号的，不要有外部的圆圈」）。lucide 0.511 没有无外圈的问号形态
 * （CircleHelp/BadgeHelp/FileQuestion 全部带圈或徽框），故按 §8 先例在集中映射处
 * 包一层本地图形——禁的是**页面内联自绘**，不是集中封装本身（research 的
 * FileSearchCornerIcon 同款）。path 取自 lucide circle-help 的问号部分并**放大 1.9 倍**
 * （绕字形中心 (12,13)）：原字形只占 24 视框的 8/24（它是设计来装进 r=10 的圆里的），
 * 直接摘出来在 15px 下会是个小点，与同排带圈的四个图标视觉重量失衡。放大后字形跨
 * 5.4–20.6，描边宽度不变（strokeWidth 2 → 15px 下 1.25px，与 lucide 同权重）。 */
export function QuestionMarkIcon({ size = 16, className, strokeWidth = 2, ...props }: LucideProps) {
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
      <path d="M6.8 5.4a5.7 5.7 0 0 1 11.1 1.9c0 3.6-5.7 5.7-5.7 5.7" />
      <path d="M12 20.6h.01" />
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
