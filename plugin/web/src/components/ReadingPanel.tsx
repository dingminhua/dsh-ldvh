import { useEffect, useRef, useState, useCallback } from 'react';
import { ChevronLeft, ChevronRight, X, GripVertical } from 'lucide-react';
import { usePanel } from '@/utils/panelContext';
import { useI18n } from '@/i18n/context';
import { EmptyPanelPreview, PanelContentRenderer } from '@/components/reading-panel/PanelContent';

const MIN_WIDTH = 280;
const MAX_WIDTH_RATIO = 0.58;
const DEFAULT_WIDTH = 380;
const DEFAULT_DOC_WIDTH = 680;
const SNAP_THRESHOLD = 40;
// Compact 断点（Human 2026-10-16：640 → 1024）。**必须与侧栏 Tailwind `lg:` 断点同值**：
// 二者不同值时会拼出「展开侧栏 + 底部抽屉」或「图标栏 + 右侧面板」的错配组合
// （`docs/01` §1.6 只登记了两种窄屏结构变化，均以同一个 Compact 断点为界）。
// 命名不取 `MOBILE_*`：1024 已覆盖平板与窄桌面，该名会误导后续读者。
const COMPACT_BREAKPOINT = 1024;

export default function ReadingPanel() {
  const { isOpen, content, canGoBack, canGoForward, goBack, goForward, closePanel } = usePanel();
  const { t } = useI18n();
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [isDragging, setIsDragging] = useState(false);
  const [isCompact, setIsCompact] = useState(false);
  const [bottomSheetHeight, setBottomSheetHeight] = useState(50);
  const [draggingSheet, setDraggingSheet] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const startXRef = useRef(0);
  const startWidthRef = useRef(DEFAULT_WIDTH);
  const startYRef = useRef(0);
  const startHeightRef = useRef(50);

  useEffect(() => {
    const check = () => setIsCompact(window.innerWidth < COMPACT_BREAKPOINT);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  const maxWidth = Math.floor(window.innerWidth * MAX_WIDTH_RATIO);
  const clamp = useCallback(
    (w: number) => Math.max(MIN_WIDTH, Math.min(w, maxWidth)),
    [maxWidth],
  );

  useEffect(() => {
    if (!isCompact && (content?.type === 'doc' || content?.type === 'web')) {
      setWidth((prev) => clamp(Math.max(prev, DEFAULT_DOC_WIDTH)));
    }
  }, [clamp, content?.type, isCompact]);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    startXRef.current = e.clientX;
    startWidthRef.current = width;
  }, [width]);

  useEffect(() => {
    if (!isDragging) return;
    const onMouseMove = (e: MouseEvent) => {
      const dx = startXRef.current - e.clientX;
      let newW = startWidthRef.current + dx;
      if (newW > maxWidth - SNAP_THRESHOLD) newW = maxWidth;
      if (newW < MIN_WIDTH + SNAP_THRESHOLD) newW = MIN_WIDTH;
      setWidth(clamp(newW));
    };
    const onMouseUp = () => {
      setIsDragging(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
  }, [isDragging, clamp, maxWidth]);

  useEffect(() => {
    const onResize = () => {
      setWidth(prev => Math.min(prev, Math.floor(window.innerWidth * MAX_WIDTH_RATIO)));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [clamp]);

  // Bottom sheet drag handlers
  const onSheetHandleDown = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    setDraggingSheet(true);
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    startYRef.current = clientY;
    startHeightRef.current = bottomSheetHeight;
  }, [bottomSheetHeight]);

  useEffect(() => {
    if (!draggingSheet) return;
    const onMove = (e: MouseEvent | TouchEvent) => {
      const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
      const dy = startYRef.current - clientY;
      const vh = window.innerHeight;
      const newH = Math.max(20, Math.min(95, startHeightRef.current + (dy / vh) * 100));
      setBottomSheetHeight(newH);
    };
    const onUp = () => {
      setDraggingSheet(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      // Snap close if dragged below 30%
      if (bottomSheetHeight < 30) closePanel();
    };
    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.addEventListener('touchmove', onMove);
    document.addEventListener('touchend', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onUp);
    };
  }, [draggingSheet, bottomSheetHeight, closePanel]);

  if (!isOpen && !content) return null;

  const panelTitle = content?.title || t('readingPanel.title');
  const preview = content ? <PanelContentRenderer content={content} /> : <EmptyPanelPreview />;

  if (isCompact && !isOpen) return null;

  const navigationControls = (
    <div className="flex shrink-0 items-center gap-1">
      <button
        type="button"
        onClick={goBack}
        disabled={!canGoBack}
        className="inline-flex h-11 w-11 items-center justify-center rounded text-ldvh-text-secondary transition-colors hover:bg-ldvh-border/30 hover:text-ldvh-text-primary disabled:cursor-default disabled:opacity-35 lg:h-7 lg:w-7"
        title={t('readingPanel.previous')}
        aria-label={t('readingPanel.previous')}
      >
        <ChevronLeft size={14} />
      </button>
      <button
        type="button"
        onClick={goForward}
        disabled={!canGoForward}
        className="inline-flex h-11 w-11 items-center justify-center rounded text-ldvh-text-secondary transition-colors hover:bg-ldvh-border/30 hover:text-ldvh-text-primary disabled:cursor-default disabled:opacity-35 lg:h-7 lg:w-7"
        title={t('readingPanel.next')}
        aria-label={t('readingPanel.next')}
      >
        <ChevronRight size={14} />
      </button>
    </div>
  );

  // Compact（< 1024px）：底部阅读抽屉
  if (isCompact) {
    return (
      <>
        <div className="fixed inset-0 z-40 bg-black/40" onClick={closePanel} />
        <div
          ref={panelRef}
          className="fixed bottom-0 left-0 right-0 z-50 flex flex-col rounded-t-xl border-t border-ldvh-border bg-ldvh-panel shadow-lg shadow-black/20 transition-transform duration-300 ease-out"
          style={{ height: `${bottomSheetHeight}vh` }}
        >
          <div className="z-10 flex min-h-11 shrink-0 items-center justify-between gap-1 border-b border-ldvh-border bg-ldvh-panel/95 px-2 backdrop-blur">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              {navigationControls}
              <div
                className="relative flex min-h-11 min-w-0 flex-1 cursor-ns-resize flex-col items-center justify-center px-2"
                onMouseDown={onSheetHandleDown}
                onTouchStart={onSheetHandleDown}
                aria-label={panelTitle}
              >
                <span className="ldvh-card-title w-full truncate text-center">{panelTitle}</span>
                <div className="absolute bottom-1 h-0.5 w-8 rounded-full bg-ldvh-border" />
              </div>
            </div>
            <button
              type="button"
              onClick={closePanel}
              title={t('readingPanel.close')}
              aria-label={t('readingPanel.close')}
              className="inline-flex h-11 w-11 items-center justify-center rounded text-ldvh-text-secondary hover:bg-ldvh-border/30"
            >
              <X size={14} />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {preview}
          </div>
        </div>
      </>
    );
  }

  // 桌面（≥ 1024px）：右侧扩展阅读面板
  return (
    <div
      ref={panelRef}
      className={`relative flex h-full flex-shrink-0 flex-col border-l border-ldvh-border bg-ldvh-panel transition-[width,opacity] duration-200 ease-in-out ${
        isOpen ? 'opacity-100' : 'w-0 overflow-hidden opacity-0 border-l-0'
      }`}
      style={{ width: isOpen ? width : 0 }}
    >
      <div
        className="absolute left-0 top-0 z-10 flex h-full w-2 cursor-col-resize items-center justify-center transition-colors hover:bg-ldvh-accent/20"
        onMouseDown={onMouseDown}
      >
        <div className="flex h-12 w-1.5 flex-col items-center justify-center rounded-full bg-ldvh-border/50 opacity-0 transition-opacity hover:opacity-100" />
      </div>
      <div className="z-10 flex shrink-0 items-center justify-between gap-2 border-b border-ldvh-border bg-ldvh-panel/95 px-4 py-3 backdrop-blur">
        <div className="flex min-w-0 items-center gap-2">
          <GripVertical size={14} className="flex-shrink-0 text-ldvh-text-secondary" />
          {navigationControls}
        </div>
        <button
          type="button"
          onClick={closePanel}
          title={t('readingPanel.close')}
          aria-label={t('readingPanel.close')}
          className="inline-flex h-7 w-7 items-center justify-center rounded text-ldvh-text-secondary hover:bg-ldvh-border/30"
        >
          <X size={14} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {preview}
      </div>
    </div>
  );
}


export { CommitDetailContent, CommitDetailIdentity } from '@/components/reading-panel/PanelContent';
