import { useId, type KeyboardEvent, type ReactNode } from 'react';

export type SegmentedControlItem<T extends string> = {
  value: T;
  label: string;
  icon: ReactNode;
};

type SegmentedControlProps<T extends string> = {
  ariaLabel: string;
  items: readonly SegmentedControlItem<T>[];
  onValueChange: (value: T) => void;
  value: T;
};

/** A compact, single-choice control for mutually exclusive toolbar options. */
export default function SegmentedControl<T extends string>({
  ariaLabel,
  items,
  onValueChange,
  value,
}: SegmentedControlProps<T>) {
  const groupId = useId();

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (items.length === 0) return;

    const isPrevious = event.key === 'ArrowLeft' || event.key === 'ArrowUp';
    const isNext = event.key === 'ArrowRight' || event.key === 'ArrowDown';
    const isBoundary = event.key === 'Home' || event.key === 'End';
    if (!isPrevious && !isNext && !isBoundary) return;

    event.preventDefault();
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? items.length - 1
        : (index + (isPrevious ? -1 : 1) + items.length) % items.length;
    const nextItem = items[nextIndex];
    onValueChange(nextItem.value);
    document.getElementById(`${groupId}-${nextItem.value}`)?.focus();
  };

  return (
    <div className="ldvh-segmented-control" role="radiogroup" aria-label={ariaLabel}>
      {items.map((item, index) => {
        const selected = item.value === value;
        return (
          <button
            key={item.value}
            id={`${groupId}-${item.value}`}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={item.label}
            title={item.label}
            tabIndex={selected ? 0 : -1}
            onClick={() => onValueChange(item.value)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={`ldvh-segmented-control-button ${selected
              ? 'ldvh-segmented-control-button-active'
              : 'ldvh-segmented-control-button-idle'}`}
          >
            {item.icon}
          </button>
        );
      })}
    </div>
  );
}
