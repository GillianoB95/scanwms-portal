import { ReactNode, useEffect, useRef } from 'react';

/** Retain the existing table controls while labelling vertical phone records. */
export function WarehouseMobileContent({ children }: { children: ReactNode }) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const labelCells = () => {
      root.querySelectorAll('table').forEach(table => {
        const headings = Array.from(table.querySelectorAll('thead tr:first-child th'))
          .map(heading => heading.textContent?.trim() || 'Actions');
        table.querySelectorAll('tbody > tr, tfoot > tr').forEach(row => {
          let column = 0;
          Array.from(row.children).forEach(cell => {
            if (!(cell instanceof HTMLTableCellElement)) return;
            const label = cell.colSpan > 1 ? '' : headings[column] || '';
            if (cell.dataset.mobileLabel !== label) cell.dataset.mobileLabel = label;
            column += cell.colSpan;
          });
        });
      });
    };
    labelCells();
    const observer = new MutationObserver(labelCells);
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, []);

  return <div ref={rootRef} className="warehouse-mobile-content min-w-0">{children}</div>;
}