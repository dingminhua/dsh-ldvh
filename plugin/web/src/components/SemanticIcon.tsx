import type { ComponentType } from 'react';
import {
  FileText,
  ClipboardList,
  GitCommit,
  Github,
  FileSignature,
  Lightbulb,
  Link2,
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

/**
 * commit 关联目标图标（Human 指定 2026-10-10：沿用侧栏导航那只狐狸）。
 *
 * 侧栏由宿主提供，其狐狸图标不在本插件内，故此处按同一形态自绘：**实心填充**
 * （与 GitHub 剪影同一路，区别于本表其余 lucide 线框图标），单色 currentColor，
 * 由调用处的文字色决定明暗。
 */
function FoxSilhouetteIcon({ size = 16, className, ...props }: LucideProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="none"
      className={className}
      aria-hidden="true"
      {...props}
    >
      {/* 耳 */}
      <path d="M4.2 3.1a.6.6 0 0 1 .92-.5l4.1 3.2a7.9 7.9 0 0 1 5.56 0l4.1-3.2a.6.6 0 0 1 .92.5l-.86 5.6a7.4 7.4 0 0 1 .5 2.55c0 4.7-3.72 8.3-7.75 8.3S3.05 15.95 3.05 11.25c0-.87.18-1.72.5-2.55L4.2 3.1Z" />
    </svg>
  );
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
  change: GitCommit,
  // commit 形态关系的目标图标（02 §8.1）：解药是一次受控提交。狐狸＝侧栏那只，
  // 实心填充，与 change 的线框 GitCommit 区分开——读者一眼知道这是提交而非工单。
  commit: FoxSilhouetteIcon,
  changelog: GitHubSilhouetteIcon,
};

export const COLLECTION_ICONS: Record<string, SemanticIconComponent> = {
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
