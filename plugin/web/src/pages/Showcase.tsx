/**
 * 展示台（`/showcase`）——**用真组件、真样式渲染真实数据**的形态沟通页。
 *
 * 为什么要有它：此前用「手写 HTML 的演示页」沟通形态，样式是仿的，与正式列表必然
 * 有差距（Human 2026-09-30：「演示页面的样式和正式的有差距，导致我不敢用」）。本页
 * 走**正式应用的同一条代码路径**：同一套 Tailwind/`index.css`、同一批组件、同一处
 * 卡片装配（`WorkCaseListCard`，与 `/objects/workcase` 共用），数据取自真实 API。
 *
 * 边界：本页**只读**——不提供任何写入口（不呈现按钮式动作），不构成第二事实源；
 * 它渲染的是事实源的真实对象，不是另造一份样例。
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import PageHeader from '@/components/PageHeader';
import { fetchObjects, type ObjectItem } from '@/utils/api';
import { useI18n } from '@/i18n/context';
import { getWorkCaseGroupLabel } from '@/i18n/locales';
import { WorkCaseListCard } from '@/pages/ObjectList';

/** 分组标题（10 §5.5 的四个派生组）。 */
const GROUP_ORDER = ['pending_gate1', 'executing', 'awaiting_gate2', 'closed'] as const;

export default function Showcase() {
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const [items, setItems] = useState<ObjectItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetchObjects('workcase')
      .then((result) => {
        if (cancelled) return;
        setItems(result.data?.items ?? []);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const grouped = useMemo(() => {
    const map = new Map<string, ObjectItem[]>();
    for (const group of GROUP_ORDER) map.set(group, []);
    for (const item of items) {
      const key = item.group ?? 'closed';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(item);
    }
    return map;
  }, [items]);

  const openObject = (objId: string) => {
    navigate(`/objects/workcase/${objId}`);
  };

  return (
    <div className="min-w-0">
      <PageHeader
        title={t('showcase.title')}
        subtitle={t('showcase.subtitle')}
      />

      {/* 构建标识：让"改了到底生效没有"可自证，不必在缓存上猜。
          `__BUILD_STAMP__` 由 vite define 注入（git 短 hash + 构建时刻）。 */}
      <p className="ldvh-meta-muted mb-4" data-showcase-build={__BUILD_STAMP__}>
        {t('showcase.build')}{__BUILD_STAMP__}
      </p>

      {error !== null && (
        <p className="ldvh-card-decision-body mb-4 rounded-md border border-red-500/30 bg-red-500/[0.07] px-3 py-2 text-red-400">
          {error}
        </p>
      )}

      {loading ? (
        <div className="ldvh-body-muted py-20 text-center">{t('showcase.loading')}</div>
      ) : (
        GROUP_ORDER.map((group) => {
          const groupItems = grouped.get(group) ?? [];
          if (groupItems.length === 0) return null;
          return (
            <section key={group} className="mb-8 min-w-0">
              <h2 className="ldvh-section-title mb-3">
                {getWorkCaseGroupLabel(group, locale)}
                <span className="ldvh-body-muted ml-2 font-normal">{groupItems.length}</span>
              </h2>
              {/* 与正式列表**同一个网格 class**，故卡片宽度/间距也一致。 */}
              <div className="ldvh-section-grid">
                {groupItems.map((obj) => (
                  <WorkCaseListCard key={obj.id} obj={obj} locale={locale} onOpen={openObject} />
                ))}
              </div>
            </section>
          );
        })
      )}

      <p className="ldvh-body-muted mt-8">{t('showcase.footnote')}</p>
    </div>
  );
}
