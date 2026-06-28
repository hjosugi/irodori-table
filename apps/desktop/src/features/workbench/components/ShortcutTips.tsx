export type ShortcutTip = {
  label: string;
  shortcut: string | null;
};

type ShortcutTipsProps = {
  className?: string;
  items: readonly ShortcutTip[];
};

export function ShortcutTips({ className, items }: ShortcutTipsProps) {
  const visibleItems = items.filter((item) => item.shortcut);

  if (visibleItems.length === 0) {
    return null;
  }

  return (
    <dl className={["shortcut-tips", className].filter(Boolean).join(" ")}>
      {visibleItems.map((item) => (
        <div className="shortcut-tip" key={item.label}>
          <dt>{item.label}</dt>
          <dd>{renderShortcut(item.shortcut ?? "")}</dd>
        </div>
      ))}
    </dl>
  );
}

function renderShortcut(shortcut: string) {
  return shortcut.split(" ").map((chord, chordIndex) => (
    <span className="shortcut-chord" key={`${chord}-${chordIndex}`}>
      {renderChord(chord)}
    </span>
  ));
}

function renderChord(chord: string) {
  const parts = chord.includes("+") ? chord.split("+") : [chord];
  return parts.map((part, index) => <kbd key={`${part}-${index}`}>{part}</kbd>);
}
