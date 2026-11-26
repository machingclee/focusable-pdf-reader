/**
 * Single Page / Two Pages, as two icon buttons on the toolbar.
 *
 * The chosen layout is the highlighted icon. Choosing one does not change the
 * zoom — both pages of a pair already share it.
 */
import type { PageLayout } from "../pageLayout";

function SinglePageIcon() {
  return (
    <svg className="page-layout-glyph" viewBox="0 0 16 18" width="14" height="16" aria-hidden>
      <rect x="3.2" y="1.2" width="9.6" height="15.6" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function TwoPagesIcon() {
  return (
    <svg className="page-layout-glyph" viewBox="0 0 20 16" width="16" height="13" aria-hidden>
      <rect x="1.1" y="1.2" width="8.2" height="13.6" rx="1.1" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <rect x="10.7" y="1.2" width="8.2" height="13.6" rx="1.1" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

const OPTIONS: { id: PageLayout; label: string }[] = [
  { id: "single", label: "Single Page" },
  { id: "two", label: "Two Pages" },
];

export function PageLayoutMenu({
  layout,
  onChange,
}: {
  layout: PageLayout;
  onChange: (layout: PageLayout) => void;
}) {
  return (
    <div className="page-layout-bar" role="radiogroup" aria-label="Page layout">
      {OPTIONS.map((option) => {
        const checked = layout === option.id;
        return (
          <button
            key={option.id}
            type="button"
            className={checked ? "page-layout-button active" : "page-layout-button"}
            role="radio"
            aria-checked={checked}
            aria-label={option.label}
            title={option.label}
            onClick={() => onChange(option.id)}
          >
            {option.id === "two" ? <TwoPagesIcon /> : <SinglePageIcon />}
          </button>
        );
      })}
    </div>
  );
}
