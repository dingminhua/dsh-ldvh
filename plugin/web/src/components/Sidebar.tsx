import { NavLink, useLocation } from 'react-router-dom';
import { useState } from 'react';
import type { ElementType } from 'react';
import {
  LayoutDashboard,
  Globe,
  FolderTree,
  GitPullRequestArrow,
  MapPinned,
  Sun,
  Moon,
  Monitor,
  PanelLeft,
  RefreshCw,
  ExternalLink,
  type LucideProps,
} from 'lucide-react';
import { useI18n } from '@/i18n/context';
import { useTheme } from '@/hooks/useTheme';
import { getLanguageSwitchKey, getOppositeLanguageNameKey, getOppositeLocale, type LocaleKey } from '@/i18n/locales';
import { OBJECT_TYPE_ICONS } from '@/components/SemanticIcon';
import ProjectSwitcher from '@/components/ProjectSwitcher';
import ldvhPluginIcon from '@/assets/ldvh-plugin-icon.png';

type NavIcon = ElementType<LucideProps>;

const NAV_ITEMS: { to: string; labelKey: LocaleKey; icon: NavIcon }[] = [
  { to: '/', labelKey: 'nav.cognition', icon: LayoutDashboard },
  { to: '/objects/spark', labelKey: 'nav.sparks', icon: OBJECT_TYPE_ICONS.spark },
  { to: '/objects/workcase', labelKey: 'nav.workcases', icon: OBJECT_TYPE_ICONS.workcase },
  { to: '/objects/research', labelKey: 'nav.studies', icon: OBJECT_TYPE_ICONS.research },
  { to: '/objects/adr', labelKey: 'nav.adrs', icon: OBJECT_TYPE_ICONS.adr },
  { to: '/objects/pitfall', labelKey: 'nav.pitfalls', icon: OBJECT_TYPE_ICONS.pitfall },
  { to: '/objects/friction', labelKey: 'nav.frictions', icon: OBJECT_TYPE_ICONS.friction },
  { to: '/objects/norm', labelKey: 'nav.norms', icon: OBJECT_TYPE_ICONS.norm },
  { to: '/project-files', labelKey: 'nav.projectFiles', icon: FolderTree },
  { to: '/changes', labelKey: 'nav.changes', icon: GitPullRequestArrow },
  { to: '/changelog', labelKey: 'nav.changelog', icon: OBJECT_TYPE_ICONS.changelog },
  // 帮助=带钉地图（导览/漫游指南；Human 定案 2026-09-12 终选——历经
  // CircleHelp→MapPinned→单独问号→回到 MapPinned）。
  { to: '/help', labelKey: 'nav.help', icon: MapPinned },
];

/** 联邦作用域导航（全部管辖计划 Step 4）：
 * 聚焦→联邦聚焦页；七类对象→联邦聚合列表；目录/变更/提交是单项目专属页，联邦态灰显。 */
const FEDERATION_NAV_ITEMS: { to: string; labelKey: LocaleKey; icon: NavIcon; disabled?: boolean }[] = [
  { to: '/federation', labelKey: 'nav.cognition', icon: LayoutDashboard },
  { to: '/federation/objects/spark', labelKey: 'nav.sparks', icon: OBJECT_TYPE_ICONS.spark },
  { to: '/federation/objects/workcase', labelKey: 'nav.workcases', icon: OBJECT_TYPE_ICONS.workcase },
  { to: '/federation/objects/research', labelKey: 'nav.studies', icon: OBJECT_TYPE_ICONS.research },
  { to: '/federation/objects/adr', labelKey: 'nav.adrs', icon: OBJECT_TYPE_ICONS.adr },
  { to: '/federation/objects/pitfall', labelKey: 'nav.pitfalls', icon: OBJECT_TYPE_ICONS.pitfall },
  { to: '/federation/objects/friction', labelKey: 'nav.frictions', icon: OBJECT_TYPE_ICONS.friction },
  { to: '/federation/objects/norm', labelKey: 'nav.norms', icon: OBJECT_TYPE_ICONS.norm },
  { to: '/project-files', labelKey: 'nav.projectFiles', icon: FolderTree, disabled: true },
  { to: '/changes', labelKey: 'nav.changes', icon: GitPullRequestArrow, disabled: true },
  { to: '/changelog', labelKey: 'nav.changelog', icon: OBJECT_TYPE_ICONS.changelog, disabled: true },
  { to: '/help', labelKey: 'nav.help', icon: MapPinned },
];

function getNavItemLabel(item: (typeof NAV_ITEMS)[number], t: (key: LocaleKey) => string): string {
  return t(item.labelKey);
}

function ThemeIcon({ mode }: { mode: 'system' | 'light' | 'dark' }) {
  if (mode === 'light') return <Sun size={16} />;
  if (mode === 'dark') return <Moon size={16} />;
  return <Monitor size={16} />;
}

function BrandMark() {
  return (
    <img src={ldvhPluginIcon} alt="" className="h-9 w-9 rounded-md" aria-hidden="true" />
  );
}

type TooltipPosition = { top: number; left: number };

function IconTooltip({ label, visible, position }: { label: string; visible: boolean; position?: TooltipPosition }) {
  if (!visible) return null;
  return (
    <span
      aria-hidden="true"
      style={position}
      className={`ldvh-chip pointer-events-none z-[100] -translate-y-1/2 whitespace-nowrap rounded-md border border-ldvh-border bg-ldvh-bg px-2 py-1 text-ldvh-text-primary shadow-lg shadow-black/10 ${
        position ? 'fixed' : 'absolute left-full top-1/2 ml-2'
      }`}
    >
      {label}
    </span>
  );
}

interface SidebarProps {
  collapsed: boolean;
  compact?: boolean;
  onToggle?: () => void;
}

export default function Sidebar({ collapsed, compact = false, onToggle }: SidebarProps) {
  const { locale, setLocale, t } = useI18n();
  const { mode, cycleTheme } = useTheme();
  const [visibleTooltip, setVisibleTooltip] = useState<{ key: string; position: TooltipPosition } | null>(null);
  const location = useLocation();
  const federationActive = location.pathname === '/federation' || location.pathname.startsWith('/federation/');
  const navItems: { to: string; labelKey: LocaleKey; icon: NavIcon; disabled?: boolean }[] = federationActive ? FEDERATION_NAV_ITEMS : NAV_ITEMS;
  const isCollapsed = compact || collapsed;
  const languageLabel = t(getLanguageSwitchKey(locale));
  const sidebarToggleLabel = isCollapsed ? t('nav.expandSidebar') : t('nav.collapseSidebar');
  const themeLabel =
    mode === 'system' ? t('theme.system') :
    mode === 'light' ? t('theme.light') :
    t('theme.dark');
  const refreshLabel = t('nav.refreshReading');
  const openInBrowserLabel = t('nav.openInBrowser');
  const showTooltip = (key: string, element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    setVisibleTooltip({ key, position: { top: rect.top + rect.height / 2, left: rect.right + 8 } });
  };
  /**
   * 在浏览器中打开当前页面。
   *
   * 取当前文档的 origin + pathname（含 vite base，如 `/ldvh/`）+ search 拼出地址：
   * 与用户在地址栏看到的同一页，深链接参数与原页面一致。`noopener,noreferrer` 是
   * 必需的——DSH 侧栏 iframe 处于不透明源沙箱，新窗口不应回指 opener。
   */
  const openInBrowser = () => {
    setVisibleTooltip(null);
    const { origin, pathname, search } = window.location;
    window.open(`${origin}${pathname}${search}`, '_blank', 'noopener,noreferrer');
  };
  /**
   * 整页重载（Human 2026-10-17 指令：点刷新要能看到「改了代码」的变化）。
   *
   * 为什么不能只重取数据：`useReadingRefresh` 的档位只让各读取方重发 /api 请求，
   * 不重新下载 JS。而 bundle 的文件名带内容 hash，新 hash 只存在于**新的
   * index.html** 里；旧文档永远不会自己换 bundle——这正是「改码后必须关掉重开
   * 侧栏才生效」的成因。
   *
   * 为什么不能只调 `location.reload()`：重载文档时浏览器可对 index.html 做条件
   * 重验证（304），拿回的可能仍是缓存副本。故改用 `location.replace()` 导航到
   * 带时间戳的同一地址：查询串唯一 ⇒ 文档必然重新请求 ⇒ 拿到新 HTML 与新 hash。
   *
   * `replace()` 而非 `assign()`：不往历史里堆一条假记录，后退不会在两份同一页
   * 之间来回横跳。时间戳参数对应用无意义（路由只读 pathname/search 之外的部分
   * 不受影响），重载后随即被下次导航冲掉。
   *
   * 已知边界：重载会丢失页内滚动位置与展开态等非持久状态——这是「看到新代码」
   * 的必要代价，已在 Human 侧确认。
   */
  const hardReload = () => {
    setVisibleTooltip(null);
    const { origin, pathname, search } = window.location;
    const params = new URLSearchParams(search);
    params.set('__reload', String(Date.now()));
    window.location.replace(`${origin}${pathname}?${params.toString()}`);
  };

  return (
    <aside
      className={`flex h-full min-h-0 flex-shrink-0 flex-col border-r border-ldvh-border bg-ldvh-panel transition-[width] duration-200 ease-in-out ${
        isCollapsed ? 'w-14' : 'w-[186px]'
      }`}
    >
      <div className={`border-b border-ldvh-border ${isCollapsed ? 'px-2 py-3' : 'px-3 py-4'}`}>
        <div className={isCollapsed ? 'flex flex-col items-center gap-2' : 'flex min-w-0 items-center gap-2'}>
          <div className={`flex min-w-0 items-center ${isCollapsed ? 'justify-center' : ''}`}>
            <div
              onMouseEnter={(event) => showTooltip('brand', event.currentTarget)}
              onMouseLeave={() => setVisibleTooltip(null)}
              className="relative flex h-10 w-10 flex-shrink-0 items-center justify-center"
            >
              <BrandMark />
              {isCollapsed && <IconTooltip label="LDVH" visible={visibleTooltip?.key === 'brand'} position={visibleTooltip?.position} />}
            </div>
          </div>
          <ProjectSwitcher collapsed={isCollapsed} />
        </div>
      </div>
      <nav
        className={`min-h-0 flex-1 px-2 py-3 ${
          isCollapsed && !compact ? 'overflow-visible' : 'overscroll-contain overflow-x-hidden overflow-y-auto'
        }`}
      >
        <ul className="flex flex-col gap-0.5">
          {navItems.map((item) => (
            <li key={item.to}>
              {item.disabled ? (
                <span
                  aria-disabled="true"
                  title={t('federation.singleProjectOnly')}
                  className={`ldvh-card-title relative flex cursor-not-allowed items-center rounded-md opacity-40 ${
                    isCollapsed ? 'h-10 justify-center px-0' : 'gap-2.5 px-3 py-2'
                  } text-ldvh-text-secondary`}
                >
                  <item.icon size={16} className="flex-shrink-0" />
                  {!isCollapsed && <span className="truncate">{getNavItemLabel(item, t)}</span>}
                </span>
              ) : (
              <NavLink
                to={item.to}
                end={item.to === '/' || item.to === '/federation'}
                aria-label={isCollapsed ? getNavItemLabel(item, t) : undefined}
                title={isCollapsed ? getNavItemLabel(item, t) : undefined}
                onMouseEnter={(event) => showTooltip(`nav-${item.to}`, event.currentTarget)}
                onMouseLeave={() => setVisibleTooltip(null)}
                onFocus={(event) => showTooltip(`nav-${item.to}`, event.currentTarget)}
                onBlur={() => setVisibleTooltip(null)}
                onClick={() => setVisibleTooltip(null)}
                className={({ isActive }) =>
                  `ldvh-card-title relative flex items-center rounded-md transition-colors ${
                    isCollapsed ? 'h-10 justify-center px-0' : 'gap-2.5 px-3 py-2'
                  } ${
                    isActive
                      ? 'bg-ldvh-accent/10 text-ldvh-accent'
                      : 'text-ldvh-text-secondary hover:bg-ldvh-border/50 hover:text-ldvh-text-primary'
                  }`
                }
              >
                <item.icon size={16} className="flex-shrink-0" />
                {!isCollapsed && <span className="truncate">{getNavItemLabel(item, t)}</span>}
                {isCollapsed && (
                  <IconTooltip
                    label={getNavItemLabel(item, t)}
                    visible={visibleTooltip?.key === `nav-${item.to}`}
                    position={visibleTooltip?.position}
                  />
                )}
              </NavLink>
              )}
            </li>
          ))}
        </ul>
      </nav>
      <div className={`border-t border-ldvh-border ${isCollapsed ? 'px-2 py-3' : 'px-3 py-3'}`}>
        {/* 底部工具区两行：语言独占一行（名称需完整可读，不与图标抢宽）；其余图标独
            占一行。展开态两行都靠左，与上方导航条目同一基线（Human 2026-09-19：三个
            图标左对齐）；收起态两行都退化为居中的图标 rail。 */}
        <div className={isCollapsed ? 'flex flex-col items-center gap-1' : 'flex flex-col gap-1.5'}>
          <div className={`flex min-w-0 ${isCollapsed ? 'justify-center' : 'w-full'}`}>
            <button
              onClick={() => {
                setVisibleTooltip(null);
                setLocale(getOppositeLocale(locale));
              }}
              onMouseEnter={(event) => showTooltip('language', event.currentTarget)}
              onMouseLeave={() => setVisibleTooltip(null)}
              onFocus={(event) => showTooltip('language', event.currentTarget)}
              onBlur={() => setVisibleTooltip(null)}
              aria-label={languageLabel}
              className={`ldvh-card-title relative flex items-center rounded-md text-ldvh-text-secondary transition-colors hover:bg-ldvh-border/50 hover:text-ldvh-text-primary ${
                isCollapsed ? 'h-9 w-9 justify-center px-0' : 'w-full min-w-0 gap-2 px-3 py-1.5'
              }`}
            >
              <Globe size={16} className="shrink-0" />
              {!isCollapsed && <span className="truncate">{t(getOppositeLanguageNameKey(locale))}</span>}
              {isCollapsed && <IconTooltip label={languageLabel} visible={visibleTooltip?.key === 'language'} position={visibleTooltip?.position} />}
            </button>
          </div>
          <div className={`flex items-center gap-1 ${isCollapsed ? 'flex-col' : 'justify-start'}`}>
            <button
              onClick={() => {
                setVisibleTooltip(null);
                cycleTheme();
              }}
              onMouseEnter={(event) => showTooltip('theme', event.currentTarget)}
              onMouseLeave={() => setVisibleTooltip(null)}
              onFocus={(event) => showTooltip('theme', event.currentTarget)}
              onBlur={() => setVisibleTooltip(null)}
              aria-label={themeLabel}
              className="relative flex h-9 w-9 items-center justify-center rounded-md text-ldvh-text-secondary transition-colors hover:bg-ldvh-border/50 hover:text-ldvh-text-primary"
            >
              <ThemeIcon mode={mode} />
              <IconTooltip label={themeLabel} visible={visibleTooltip?.key === 'theme'} position={isCollapsed ? visibleTooltip?.position : undefined} />
            </button>
            {!compact && onToggle && (
              <button
                onClick={() => {
                  setVisibleTooltip(null);
                  onToggle();
                }}
                onMouseEnter={(event) => showTooltip('sidebar-toggle', event.currentTarget)}
                onMouseLeave={() => setVisibleTooltip(null)}
                onFocus={(event) => showTooltip('sidebar-toggle', event.currentTarget)}
                onBlur={() => setVisibleTooltip(null)}
                aria-label={sidebarToggleLabel}
                className="relative flex h-9 w-9 items-center justify-center rounded-md text-ldvh-text-secondary transition-colors hover:bg-ldvh-border/50 hover:text-ldvh-text-primary"
              >
                <PanelLeft size={16} className={isCollapsed ? 'rotate-180' : ''} />
                <IconTooltip label={sidebarToggleLabel} visible={visibleTooltip?.key === 'sidebar-toggle'} position={isCollapsed ? visibleTooltip?.position : undefined} />
              </button>
            )}
            <button
              onClick={openInBrowser}
              onMouseEnter={(event) => showTooltip('open-in-browser', event.currentTarget)}
              onMouseLeave={() => setVisibleTooltip(null)}
              onFocus={(event) => showTooltip('open-in-browser', event.currentTarget)}
              onBlur={() => setVisibleTooltip(null)}
              aria-label={openInBrowserLabel}
              className="relative flex h-9 w-9 items-center justify-center rounded-md text-ldvh-text-secondary transition-colors hover:bg-ldvh-border/50 hover:text-ldvh-text-primary"
            >
              <ExternalLink size={16} />
              <IconTooltip label={openInBrowserLabel} visible={visibleTooltip?.key === 'open-in-browser'} position={isCollapsed ? visibleTooltip?.position : undefined} />
            </button>
            <button
              onClick={() => {
                setVisibleTooltip(null);
                hardReload();
              }}
              onMouseEnter={(event) => showTooltip('refresh', event.currentTarget)}
              onMouseLeave={() => setVisibleTooltip(null)}
              onFocus={(event) => showTooltip('refresh', event.currentTarget)}
              onBlur={() => setVisibleTooltip(null)}
              aria-label={refreshLabel}
              className="relative flex h-9 w-9 items-center justify-center rounded-md text-ldvh-text-secondary transition-colors hover:bg-ldvh-border/50 hover:text-ldvh-text-primary"
            >
              <RefreshCw size={16} />
              <IconTooltip label={refreshLabel} visible={visibleTooltip?.key === 'refresh'} position={isCollapsed ? visibleTooltip?.position : undefined} />
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}
