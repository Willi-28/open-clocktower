/**
 * Mobile workspace navigation.
 *
 * On narrow screens the table, communication, and tools areas become separate
 * workspaces; this nav lets users switch between them without long scrolling.
 */

export type MobileWorkspaceView = 'table' | 'communication' | 'tools';

type MobileWorkspaceNavProps = {
  activeView: MobileWorkspaceView;
  onSelectView: (view: MobileWorkspaceView) => void;
};

/**
 * Keeps the three dense game areas reachable on narrow screens without
 * forcing players through one very long scrolling workspace.
 */
export function MobileWorkspaceNav({ activeView, onSelectView }: MobileWorkspaceNavProps) {
  const views: Array<{ id: MobileWorkspaceView; label: string }> = [
    { id: 'table', label: 'Table' },
    { id: 'communication', label: 'Chat & Voice' },
    { id: 'tools', label: 'Tools' },
  ];

  return (
    <nav aria-label="Mobile workspace" className="mobile-workspace-nav">
      {views.map((view) => (
        <button
          aria-pressed={activeView === view.id}
          className={activeView === view.id ? 'active' : ''}
          key={view.id}
          onClick={() => onSelectView(view.id)}
          type="button"
        >
          {view.label}
        </button>
      ))}
    </nav>
  );
}
