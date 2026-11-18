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
  PackageCheck,
  Receipt,
  Rocket,
  Route,
  Ruler,
  ShieldCheck,
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

// eslint-disable-next-line react-refresh/only-export-components
export const OBJECT_TYPE_ICONS: Record<string, SemanticIconComponent> = {
  pitfall: Lightbulb,
  spark: Sparkles,
  report: FileSearchCornerIcon,
  friction: Snail,
  norm: Ruler,
  goal: Target,
  subgoal: Milestone,
  change: GitCommit,
  commit: GitHubSilhouetteIcon,
  changelog: GitHubSilhouetteIcon,
};

const COLLECTION_ICONS: Record<string, SemanticIconComponent> = {
  plan: ClipboardList,
  properties: FileText,
  docs: FileText,
  related: Link2,
  progress: Workflow,
};

// eslint-disable-next-line react-refresh/only-export-components
export const NAV_ICONS: Record<string, SemanticIconComponent> = {
  cognition: LayoutDashboard,
  projectFiles: FolderTree,
  changes: GitPullRequestArrow,
  changelog: GitHubSilhouetteIcon,
  help: MapPinned,
  diagnostics: Activity,
  federation: Globe2,
};

// eslint-disable-next-line react-refresh/only-export-components
export const SYSTEM_ICONS: Record<string, SemanticIconComponent> = {
  goalPlanning: Waypoints,
  sparkRecord: Sprout,
  workOrder: Cog,
  researchAbsorb: Telescope,
  dualRecall: Combine,
  experience: Library,
  friction: Receipt,
};

// eslint-disable-next-line react-refresh/only-export-components
export const HELP_TAB_ICONS: Record<string, SemanticIconComponent> = {
  start: Rocket,
  overview: BookOpen,
  objects: Layers,
  systems: Route,
  gates: Hand,
  entries: Compass,
  trust: ShieldCheck,
};

// eslint-disable-next-line react-refresh/only-export-components
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
