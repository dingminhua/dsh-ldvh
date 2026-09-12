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
  change: GitCommit,
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
