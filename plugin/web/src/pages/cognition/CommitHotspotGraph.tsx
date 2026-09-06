import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { History, Maximize2, Minimize2 } from 'lucide-react';
import PriorityIcon from '@/components/PriorityIcon';
import StatusBadge from '@/components/StatusBadge';
import { ObjectTypeIcon } from '@/components/SemanticIcon';
import { useI18n } from '@/i18n/context';
import { getFieldLabel, getLocalizedObjectTitle, getObjectStatusLocale, getTypeLabel, type LocaleKey } from '@/i18n/locales';
import { usePanel } from '@/utils/panelContext';
import type {
  CognitionRecentHotspotCluster,
  CognitionRecentHotspotNode,
  CognitionRecentHotspotRelation,
} from '@/utils/api';

type NodeRole = 'primary' | 'secondary-hotspot' | 'related-work';
type DiagramMode = 'compact' | 'expanded';
type Position = { x: number; y: number };
type NodeSize = { width: number; height: number };

type RelatedWork = {
  node: CognitionRecentHotspotNode;
  relations: CognitionRecentHotspotRelation[];
};

type PositionedWork = {
  item: RelatedWork;
  position: Position;
  size: NodeSize;
};

type DiagramLayout = {
  width: number;
  height: number;
  edgeOrientation: 'horizontal' | 'vertical';
  primaryPosition: Position;
  primarySize: NodeSize;
  work: PositionedWork[];
};

const COMPACT_WORK_LIMIT = 5;

const RELATION_COLORS: Record<string, string> = {
  'related-to': '#2563eb',
  'routed-to': '#c2410c',
  informs: '#7c3aed',
  'inspired-by': '#a16207',
  'depends-on': '#0f766e',
  'contributed-to': '#be123c',
};

const RELATION_PHRASE_KEYS: Record<string, LocaleKey> = {
  'outgoing:related-to': 'cognition.commitHotspots.workRelation.related',
  'incoming:related-to': 'cognition.commitHotspots.workRelation.related',
  'outgoing:routed-to': 'cognition.commitHotspots.workRelation.hotspotRoutesHere',
  'incoming:routed-to': 'cognition.commitHotspots.workRelation.routesToHotspot',
  'outgoing:informs': 'cognition.commitHotspots.workRelation.hotspotInformsHere',
  'incoming:informs': 'cognition.commitHotspots.workRelation.informsHotspot',
  'outgoing:inspired-by': 'cognition.commitHotspots.workRelation.inspiresHotspot',
  'incoming:inspired-by': 'cognition.commitHotspots.workRelation.inspiredByHotspot',
  'outgoing:depends-on': 'cognition.commitHotspots.workRelation.hotspotDependsHere',
  'incoming:depends-on': 'cognition.commitHotspots.workRelation.dependsOnHotspot',
  'outgoing:contributed-to': 'cognition.commitHotspots.workRelation.hotspotContributesHere',
  'incoming:contributed-to': 'cognition.commitHotspots.workRelation.contributesToHotspot',
};

export function nodeKey(node: CognitionRecentHotspotNode): string {
  return node.object_uid ? `uid:${node.object_uid}` : `legacy:${node.type}:${node.id}`;
}

function safeId(value: string): string {
  return value.replace(/[^a-z0-9_-]/gi, '-');
}

function relatedWorkItems(relations: CognitionRecentHotspotRelation[]): RelatedWork[] {
  const items = new Map<string, RelatedWork>();
  for (const relation of relations) {
    const key = nodeKey(relation.node);
    const item = items.get(key) ?? { node: relation.node, relations: [] };
    if (!item.relations.some((candidate) => candidate.direction === relation.direction && candidate.relationKey === relation.relationKey)) {
      item.relations.push(relation);
    }
    items.set(key, item);
  }
  return [...items.values()];
}

function getNodeRole(node: CognitionRecentHotspotNode, primary = false): NodeRole {
  if (primary) return 'primary';
  return node.activityRefs.length > 0 ? 'secondary-hotspot' : 'related-work';
}

function relationColor(item: RelatedWork): string {
  const keys = [...new Set(item.relations.map((relation) => relation.relationKey))];
  if (keys.length !== 1) return '#64748b';
  return RELATION_COLORS[keys[0]] ?? '#64748b';
}

function relationDashArray(item: RelatedWork): string | undefined {
  const keys = [...new Set(item.relations.map((relation) => relation.relationKey))];
  if (keys.length !== 1) return undefined;
  return relationKeyDashArray(keys[0]);
}

function relationKeyDashArray(relationKey: string): string | undefined {
  if (relationKey === 'related-to') return undefined;
  if (relationKey === 'routed-to') return '8 5';
  if (relationKey === 'informs') return '3 4';
  if (relationKey === 'inspired-by') return '10 4 2 4';
  return '6 4';
}

function relationDirection(item: RelatedWork): { incoming: boolean; outgoing: boolean } {
  return {
    incoming: item.relations.some((relation) => relation.direction === 'incoming'),
    outgoing: item.relations.some((relation) => relation.direction === 'outgoing'),
  };
}

function relationLabels(
  item: RelatedWork,
  locale: string,
  t: (key: LocaleKey, params?: Record<string, string>) => string,
): string[] {
  return [...new Set(item.relations.map((relation) => {
    const phraseKey = RELATION_PHRASE_KEYS[`${relation.direction}:${relation.relationKey}`];
    if (phraseKey) return t(phraseKey);
    const relationLabel = getFieldLabel(`relation_${relation.relationKey.replace(/-/g, '_')}`, locale);
    return t(
      relation.direction === 'outgoing'
        ? 'cognition.commitHotspots.outgoingGroup'
        : 'cognition.commitHotspots.incomingGroup',
      { relation: relationLabel },
    );
  }))];
}

function rectangleEdgePoint(from: Position, to: Position, size: NodeSize): Position {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx === 0 && dy === 0) return from;
  const xScale = dx === 0 ? Number.POSITIVE_INFINITY : (size.width / 2) / Math.abs(dx);
  const yScale = dy === 0 ? Number.POSITIVE_INFINITY : (size.height / 2) / Math.abs(dy);
  const scale = Math.min(xScale, yScale);
  return { x: from.x + dx * scale, y: from.y + dy * scale };
}

function curvedPath(start: Position, end: Position, horizontal: boolean): string {
  if (horizontal) {
    const middleX = (start.x + end.x) / 2;
    return `M ${start.x} ${start.y} C ${middleX} ${start.y}, ${middleX} ${end.y}, ${end.x} ${end.y}`;
  }
  const middleY = (start.y + end.y) / 2;
  return `M ${start.x} ${start.y} C ${start.x} ${middleY}, ${end.x} ${middleY}, ${end.x} ${end.y}`;
}

function expandedMindMapAnchors(
  primaryPosition: Position,
  primarySize: NodeSize,
  relatedPosition: Position,
  relatedSize: NodeSize,
): { start: Position; end: Position } {
  const relatedOnLeft = relatedPosition.x < primaryPosition.x;
  return {
    start: {
      x: primaryPosition.x + (relatedOnLeft ? -primarySize.width / 2 : primarySize.width / 2),
      y: primaryPosition.y,
    },
    end: {
      x: relatedPosition.x + (relatedOnLeft ? relatedSize.width / 2 : -relatedSize.width / 2),
      y: relatedPosition.y,
    },
  };
}

function compactMultiRoutePath(start: Position, end: Position, index: number, width: number): string {
  const direction = index % 2 === 0 ? -1 : 1;
  const rank = Math.floor(index / 2);
  const availableGutter = Math.max(18, width * 0.115);
  const offset = direction * Math.min(availableGutter, 26 + rank * 12);
  const upperTurn = start.y + Math.min(34, Math.max(18, (end.y - start.y) * 0.22));
  const lowerTurn = end.y - Math.min(34, Math.max(18, (end.y - start.y) * 0.18));
  return `M ${start.x} ${start.y} C ${start.x + offset} ${upperTurn}, ${end.x + offset} ${lowerTurn}, ${end.x} ${end.y}`;
}

function useMeasuredWidth(ref: React.RefObject<HTMLDivElement | null>): number | undefined {
  const [width, setWidth] = useState<number>();
  useEffect(() => {
    const host = ref.current;
    if (!host) return undefined;
    const sync = () => setWidth(Math.floor(host.getBoundingClientRect().width));
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(host);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

function compactLayout(items: RelatedWork[], availableWidth?: number): DiagramLayout {
  const width = Math.max(120, availableWidth ?? 460);
  const horizontalPadding = 8;
  const primarySize = { width: Math.max(96, width - horizontalPadding * 2), height: 108 };
  const relatedSize = { width: primarySize.width * 0.75, height: 108 };
  const primaryPosition = { x: width / 2, y: primarySize.height / 2 + 8 };
  const firstRelatedY = primaryPosition.y + primarySize.height / 2 + 26 + relatedSize.height / 2;
  const rowGap = relatedSize.height + 14;
  const rows = items.length;
  const height = rows === 0
    ? primarySize.height + 16
    : firstRelatedY + (rows - 1) * rowGap + relatedSize.height / 2 + 10;
  const work = items.map((item, index) => {
    return {
      item,
      position: { x: width / 2, y: firstRelatedY + index * rowGap },
      size: relatedSize,
    };
  });
  return { width, height, edgeOrientation: 'vertical', primaryPosition, primarySize, work };
}

function splitMindMapSides(items: RelatedWork[]): { left: RelatedWork[]; right: RelatedWork[] } {
  const left: RelatedWork[] = [];
  const right: RelatedWork[] = [];
  for (const item of items) {
    const { incoming, outgoing } = relationDirection(item);
    const onlySymmetricRelations = item.relations.every((relation) => relation.relationKey === 'related-to');
    if (onlySymmetricRelations || incoming === outgoing) {
      (left.length <= right.length ? left : right).push(item);
    } else if (incoming) {
      left.push(item);
    } else {
      right.push(item);
    }
  }
  return { left, right };
}

function expandedLayout(items: RelatedWork[], availableWidth?: number): DiagramLayout {
  const width = Math.max(120, availableWidth ?? 1000);
  if (width < 900) {
    const horizontalPadding = Math.min(20, width * 0.04);
    const primarySize = { width: Math.max(96, width - horizontalPadding * 2), height: 136 };
    const relatedSize = { width: primarySize.width * 0.75, height: 132 };
    const primaryPosition = { x: width / 2, y: primarySize.height / 2 + 12 };
    const firstRelatedY = primaryPosition.y + primarySize.height / 2 + 30 + relatedSize.height / 2;
    const rowGap = relatedSize.height + 18;
    const height = items.length === 0
      ? primarySize.height + 24
      : firstRelatedY + (items.length - 1) * rowGap + relatedSize.height / 2 + 14;
    return {
      width,
      height,
      edgeOrientation: 'vertical',
      primaryPosition,
      primarySize,
      work: items.map((item, index) => ({
        item,
        position: { x: width / 2, y: firstRelatedY + index * rowGap },
        size: relatedSize,
      })),
    };
  }
  const primarySize = { width: Math.max(320, width * 0.36), height: 144 };
  const relatedSize = { width: primarySize.width * 0.75, height: 132 };
  const { left, right } = splitMindMapSides(items);
  const maxSideCount = Math.max(left.length, right.length, 1);
  const rowGap = 150;
  const height = Math.max(370, (maxSideCount - 1) * rowGap + 220);
  const primaryPosition = { x: width / 2, y: height / 2 };
  const sideInset = relatedSize.width / 2 + 22;
  const yPositions = (count: number) => {
    if (count === 0) return [];
    const total = (count - 1) * rowGap;
    const start = (height - total) / 2;
    return Array.from({ length: count }, (_, index) => start + index * rowGap);
  };
  const leftY = yPositions(left.length);
  const rightY = yPositions(right.length);
  return {
    width,
    height,
    edgeOrientation: 'horizontal',
    primaryPosition,
    primarySize,
    work: [
      ...left.map((item, index) => ({ item, position: { x: sideInset, y: leftY[index] }, size: relatedSize })),
      ...right.map((item, index) => ({ item, position: { x: width - sideInset, y: rightY[index] }, size: relatedSize })),
    ],
  };
}

function HotspotRelationLegend({ relationKeys }: { relationKeys: string[] }) {
  const { locale, t } = useI18n();
  return (
    <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-x-3 gap-y-1">
        <span className="inline-flex items-center gap-1.5 ldvh-caption text-ldvh-text-secondary">
          <span
            className="ldvh-chip inline-flex h-[18px] items-center justify-center gap-1 rounded-md border border-ldvh-accent/25 bg-ldvh-accent/5 px-[5px] text-[10px] font-medium leading-3 text-ldvh-accent"
            aria-hidden="true"
          >
            <History size={12} />
            1
          </span>
          <span>{t('cognition.commitHotspots.commitRefs')}</span>
        </span>
        {relationKeys.map((relationKey) => {
          const color = RELATION_COLORS[relationKey] ?? '#64748b';
          const label = getFieldLabel(`relation_${relationKey.replace(/-/g, '_')}`, locale);
          return (
            <span key={relationKey} className="inline-flex items-center gap-1 ldvh-caption text-ldvh-text-secondary" title={relationKey}>
              <svg width="29" height="10" viewBox="0 0 29 10" aria-hidden="true">
                <path
                  d="M 1 5 H 23"
                  fill="none"
                  stroke={color}
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeDasharray={relationKeyDashArray(relationKey)}
                />
                <path d="M 22 1.7 L 28 5 L 22 8.3 z" fill={color} />
              </svg>
              <span>{label}</span>
            </span>
          );
        })}
    </div>
  );
}

export function CommitHotspotLegend({
  totalEvents,
  hotspotTotal,
  relationTotal,
  relationKeys,
}: {
  totalEvents: number;
  hotspotTotal: number;
  relationTotal: number;
  relationKeys: string[];
}) {
  const { t } = useI18n();
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-y border-ldvh-border/70 py-2.5">
      <span className="ldvh-caption text-ldvh-text-secondary">
        {t('cognition.commitHotspots.totalCommits', { count: String(totalEvents) })}
      </span>
      <span className="ldvh-caption text-ldvh-text-secondary">
        {t('cognition.commitHotspots.summary', { hotspots: String(hotspotTotal), relations: String(relationTotal) })}
      </span>
      <HotspotRelationLegend relationKeys={relationKeys} />
    </div>
  );
}

export function CommitHotspotRelationLegend({ relationKeys }: { relationKeys: string[] }) {
  return <HotspotRelationLegend relationKeys={relationKeys} />;
}

function AccessibleRelationList({
  cluster,
  workItems,
}: {
  cluster: CognitionRecentHotspotCluster;
  workItems: RelatedWork[];
}) {
  const { locale } = useI18n();
  const primaryTitle = getLocalizedObjectTitle(cluster.primary, locale, cluster.primary.id);

  return (
    <ul className="sr-only">
      {workItems.flatMap((item) => item.relations.map((relation) => {
        const relatedTitle = getLocalizedObjectTitle(item.node, locale, item.node.id);
        const relationLabel = getFieldLabel(`relation_${relation.relationKey.replace(/-/g, '_')}`, locale);
        const source = relation.direction === 'outgoing' ? primaryTitle : relatedTitle;
        const target = relation.direction === 'outgoing' ? relatedTitle : primaryTitle;
        return <li key={`${nodeKey(item.node)}:${relation.direction}:${relation.relationKey}`}>{source} — {relationLabel} → {target}</li>;
      }))}
    </ul>
  );
}

function HotspotNodeCard({
  node,
  role,
  mode,
  relationLabels: labels = [],
  style,
  dimmed = false,
  highlighted = false,
  onHighlight,
}: {
  node: CognitionRecentHotspotNode;
  role: NodeRole;
  mode: DiagramMode;
  relationLabels?: string[];
  style: CSSProperties;
  dimmed?: boolean;
  highlighted?: boolean;
  onHighlight?: (active: boolean) => void;
}) {
  const { locale, t } = useI18n();
  const { openPanel } = usePanel();
  const title = getLocalizedObjectTitle(node, locale, node.id);
  const status = node.status ?? (node.type === 'workcase' ? node.progress_group : undefined);
  const roleLabel = t(`cognition.commitHotspots.nodeRole.${role}` as LocaleKey);
  const primary = role === 'primary';
  const expanded = mode === 'expanded';
  const titleFontSize = primary ? (expanded ? 18 : 16) : 14;
  const titleIconSize = titleFontSize;

  return (
    <button
      type="button"
      onClick={() => openPanel({ type: 'object', title, objectType: node.type, objectId: node.id })}
      onMouseEnter={() => onHighlight?.(true)}
      onMouseLeave={() => onHighlight?.(false)}
      onFocus={() => onHighlight?.(true)}
      onBlur={() => onHighlight?.(false)}
      aria-label={`${roleLabel}: ${title}${node.activityRefs.length > 0 ? ` · ${t('cognition.commitHotspots.commitRefs')} ${node.activityRefs.length}` : ''}${labels.length > 0 ? ` · ${labels.join(' · ')}` : ''}`}
      className={`absolute min-w-0 rounded-xl border bg-ldvh-panel text-left transition-[opacity,border-color,box-shadow,transform] duration-200 hover:border-ldvh-accent/50 hover:shadow-lg focus-visible:z-20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ldvh-accent/60 ${
        primary
          ? `border-ldvh-accent/55 shadow-lg ${expanded ? 'ring-4 ring-ldvh-accent/10' : ''}`
          : 'border-ldvh-border shadow-sm'
      } ${dimmed ? 'opacity-40' : 'opacity-100'} ${highlighted ? 'z-10 -translate-y-0.5 shadow-xl' : ''}`}
      style={{
        ...style,
        transform: `${style.transform ?? ''}${highlighted ? ' translateY(-2px)' : ''}`.trim(),
        borderTopColor: node.typeColor,
        borderTopWidth: primary ? 3 : 2,
      }}
    >
      <div className="flex h-full min-w-0 flex-col items-center justify-center gap-2 px-3 py-2.5">
        <div data-hotspot-node-header className="flex min-w-0 shrink-0 flex-wrap items-center justify-center gap-x-2 gap-y-1">
          <span
            className="ldvh-chip inline-flex h-[18px] shrink-0 items-center justify-center rounded-md border px-1.5 text-[10px] font-medium leading-3"
            style={{ backgroundColor: `${node.typeColor}18`, borderColor: `${node.typeColor}55`, color: node.typeColor }}
          >
            {getTypeLabel(node.type, locale)}
          </span>
          <PriorityIcon source={node} type={node.type} locale={locale} size="xs" />
          {node.activityRefs.length > 0 && (
            <span
              className="ldvh-chip inline-flex h-[18px] shrink-0 items-center justify-center gap-1 rounded-md border border-ldvh-accent/25 bg-ldvh-accent/5 px-[5px] text-[10px] font-medium leading-3 text-ldvh-accent"
              title={t('cognition.commitHotspots.commitRefs')}
            >
              <History size={12} aria-hidden="true" />
              {node.activityRefs.length}
            </span>
          )}
          {status && <StatusBadge status={status} statusLabel={getObjectStatusLocale(node.type, status, locale)} objectType={node.type} size="xs" variant="compact" />}
        </div>
        <div className="ldvh-object-title-tray flex min-w-0 w-full items-center justify-center px-3 py-2 text-center">
          <div className="inline-grid min-w-0 max-w-full grid-cols-[auto_minmax(0,1fr)] items-center gap-2">
            <ObjectTypeIcon
              type={node.type}
              size={titleIconSize}
              className="shrink-0"
              style={{ color: node.typeColor }}
            />
            <span
              data-hotspot-node-title
              title={title}
              className={`block min-w-0 max-w-full overflow-hidden break-words text-center text-ldvh-text-primary ${primary ? (expanded ? 'text-lg font-semibold leading-6' : 'text-base font-semibold leading-[22px]') : 'text-sm font-medium leading-5'}`}
              style={{ display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: expanded ? 3 : 2 }}
            >
              {title}
            </span>
          </div>
        </div>
      </div>
    </button>
  );
}

function DiagramEdges({
  index,
  mode,
  layout,
  highlightedKey,
}: {
  index: number;
  mode: DiagramMode;
  layout: DiagramLayout;
  highlightedKey: string | null;
}) {
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" viewBox={`0 0 ${layout.width} ${layout.height}`} aria-hidden="true">
      <defs>
        {layout.work.map(({ item }) => {
          const color = relationColor(item);
          const markerId = `hotspot-edge-${index}-${mode}-${safeId(nodeKey(item.node))}`;
          return (
            <marker key={markerId} id={markerId} markerWidth="8" markerHeight="8" refX="6.5" refY="4" orient="auto-start-reverse">
              <path d="M 0.5 0.7 L 7 4 L 0.5 7.3 z" fill={color} />
            </marker>
          );
        })}
      </defs>
      {layout.work.map(({ item, position, size }, edgeIndex) => {
        const key = nodeKey(item.node);
        const color = relationColor(item);
        const directions = relationDirection(item);
        const markerId = `hotspot-edge-${index}-${mode}-${safeId(key)}`;
        const anchors = mode === 'expanded' && layout.edgeOrientation === 'horizontal'
          ? expandedMindMapAnchors(layout.primaryPosition, layout.primarySize, position, size)
          : {
              start: rectangleEdgePoint(layout.primaryPosition, position, layout.primarySize),
              end: rectangleEdgePoint(position, layout.primaryPosition, size),
            };
        const { start, end } = anchors;
        const active = highlightedKey === null || highlightedKey === key;
        return (
          <path
            key={key}
            d={mode === 'compact' && layout.edgeOrientation === 'vertical'
              ? compactMultiRoutePath(start, end, edgeIndex, layout.width)
              : curvedPath(start, end, layout.edgeOrientation === 'horizontal')}
            fill="none"
            stroke={color}
            strokeOpacity={active ? (mode === 'expanded' ? 0.82 : 0.58) : 0.14}
            strokeWidth={mode === 'expanded' ? (highlightedKey === key ? 2.8 : 2.1) : 1.6}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={relationDashArray(item)}
            markerStart={directions.incoming ? `url(#${markerId})` : undefined}
            markerEnd={directions.outgoing ? `url(#${markerId})` : undefined}
            vectorEffect="non-scaling-stroke"
            className="transition-[stroke-opacity,stroke-width] duration-200"
          />
        );
      })}
    </svg>
  );
}

function CompactHotspotDiagram({
  cluster,
  index,
  workItems,
}: {
  cluster: CognitionRecentHotspotCluster;
  index: number;
  workItems: RelatedWork[];
}) {
  const { t } = useI18n();
  const hostRef = useRef<HTMLDivElement>(null);
  const width = useMeasuredWidth(hostRef);
  const [highlightedKey, setHighlightedKey] = useState<string | null>(null);
  const displayed = workItems.slice(0, COMPACT_WORK_LIMIT);
  const layout = useMemo(() => compactLayout(displayed, width), [displayed, width]);

  return (
    <div ref={hostRef} className="mt-2 min-w-0">
      <AccessibleRelationList cluster={cluster} workItems={workItems} />
      <div className="relative mx-auto" style={{ width: `${layout.width}px`, maxWidth: '100%', height: `${layout.height}px` }}>
        <DiagramEdges index={index} mode="compact" layout={layout} highlightedKey={highlightedKey} />
        <HotspotNodeCard
          node={cluster.primary}
          role="primary"
          mode="compact"
          highlighted={highlightedKey !== null}
          style={{
            left: layout.primaryPosition.x,
            top: layout.primaryPosition.y,
            width: layout.primarySize.width,
            height: layout.primarySize.height,
            transform: 'translate(-50%, -50%)',
          }}
        />
        {layout.work.map(({ item, position, size }) => {
          const key = nodeKey(item.node);
          return (
            <HotspotNodeCard
              key={key}
              node={item.node}
              role={getNodeRole(item.node)}
              mode="compact"
              dimmed={highlightedKey !== null && highlightedKey !== key}
              highlighted={highlightedKey === key}
              onHighlight={(active) => setHighlightedKey(active ? key : null)}
              style={{ left: position.x, top: position.y, width: size.width, height: size.height, transform: 'translate(-50%, -50%)' }}
            />
          );
        })}
      </div>
      {workItems.length > displayed.length && (
        <p className="mt-1 text-center ldvh-caption text-ldvh-text-secondary/70">
          {t('cognition.commitHotspots.moreWorkInExpanded', { count: String(workItems.length - displayed.length) })}
        </p>
      )}
    </div>
  );
}

function ExpandedHotspotMindMap({
  cluster,
  index,
  workItems,
}: {
  cluster: CognitionRecentHotspotCluster;
  index: number;
  workItems: RelatedWork[];
}) {
  const { locale, t } = useI18n();
  const hostRef = useRef<HTMLDivElement>(null);
  const width = useMeasuredWidth(hostRef);
  const [highlightedKey, setHighlightedKey] = useState<string | null>(null);
  const layout = useMemo(() => expandedLayout(workItems, width), [workItems, width]);

  return (
    <div ref={hostRef} className="mt-3 min-w-0 overflow-hidden rounded-xl border border-ldvh-border/70 bg-ldvh-panel/75">
      <AccessibleRelationList cluster={cluster} workItems={workItems} />
      <div
        role="group"
        aria-label={t('cognition.commitHotspots.mindMapLabel', { count: String(index + 1) })}
        className="relative mx-auto transition-[height,width] duration-300"
        style={{
          width: `${layout.width}px`,
          maxWidth: '100%',
          height: `${layout.height}px`,
          backgroundImage: 'radial-gradient(circle at center, rgba(16, 185, 129, 0.08) 0, transparent 42%), radial-gradient(circle, rgba(100, 116, 139, 0.22) 0.7px, transparent 0.8px)',
          backgroundSize: 'auto, 18px 18px',
        }}
      >
        <DiagramEdges index={index} mode="expanded" layout={layout} highlightedKey={highlightedKey} />
        <HotspotNodeCard
          node={cluster.primary}
          role="primary"
          mode="expanded"
          highlighted={highlightedKey !== null}
          style={{
            left: layout.primaryPosition.x,
            top: layout.primaryPosition.y,
            width: layout.primarySize.width,
            height: layout.primarySize.height,
            transform: 'translate(-50%, -50%)',
          }}
        />
        {layout.work.map(({ item, position, size }) => {
          const key = nodeKey(item.node);
          return (
            <HotspotNodeCard
              key={key}
              node={item.node}
              role={getNodeRole(item.node)}
              mode="expanded"
              relationLabels={relationLabels(item, locale, t)}
              dimmed={highlightedKey !== null && highlightedKey !== key}
              highlighted={highlightedKey === key}
              onHighlight={(active) => setHighlightedKey(active ? key : null)}
              style={{ left: position.x, top: position.y, width: size.width, height: size.height, transform: 'translate(-50%, -50%)' }}
            />
          );
        })}
      </div>
    </div>
  );
}

export function CommitHotspotCluster({
  cluster,
  index,
  canExpand,
  expanded,
  onExpandedChange,
}: {
  cluster: CognitionRecentHotspotCluster;
  index: number;
  canExpand: boolean;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
}) {
  const { t } = useI18n();
  const workItems = useMemo(() => relatedWorkItems(cluster.relations), [cluster.relations]);
  const contentId = `cognition-hotspot-cluster-${index}`;

  return (
    <section
      data-hotspot-mode={expanded ? 'expanded' : 'compact'}
      className={`flex min-w-0 flex-col overflow-hidden rounded-lg border bg-ldvh-bg/35 p-3 transition-[border-color,box-shadow] duration-300 ${expanded ? 'border-ldvh-accent/30 shadow-lg' : 'border-ldvh-border/75'}`}
      style={expanded ? { gridColumn: '1 / -1' } : undefined}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <p className="ldvh-caption-strong text-ldvh-text-secondary">{t('cognition.commitHotspots.cluster', { count: String(index + 1) })}</p>
        <span className="ldvh-caption text-ldvh-text-secondary/65">
          {t('cognition.commitHotspots.clusterSummary', {
            commits: String(cluster.primary.activityRefs.length),
            work: String(workItems.length),
          })}
        </span>
        {canExpand && (
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={contentId}
            onClick={() => onExpandedChange(!expanded)}
            className="ml-auto inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-transparent text-ldvh-text-secondary transition-colors hover:border-ldvh-border hover:bg-ldvh-panel hover:text-ldvh-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ldvh-accent/50"
            title={t(expanded ? 'cognition.commitHotspots.restoreClusterWidth' : 'cognition.commitHotspots.expandClusterWidth')}
          >
            {expanded ? <Minimize2 size={15} aria-hidden="true" /> : <Maximize2 size={15} aria-hidden="true" />}
            <span className="sr-only">{t(expanded ? 'cognition.commitHotspots.restoreClusterWidth' : 'cognition.commitHotspots.expandClusterWidth')}</span>
          </button>
        )}
      </div>

      <div id={contentId}>
        {expanded ? (
          <ExpandedHotspotMindMap cluster={cluster} index={index} workItems={workItems} />
        ) : (
          <CompactHotspotDiagram cluster={cluster} index={index} workItems={workItems} />
        )}
      </div>
    </section>
  );
}
