import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Overview from './tabs/Overview';
import TagManagement from './tabs/TagManagement';
import CommentManagement from './tabs/CommentManagement';
import Settings from './tabs/Configuration';
import { ToastProvider } from './components/Toast';
import apiClient, { AppIdentity, WorkspaceInfo } from './api/client';

type Tab = 'overview' | 'tags' | 'comments' | 'settings';

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'tags', label: 'Tag Management' },
  { id: 'comments', label: 'Comment Management' },
  { id: 'settings', label: 'Settings' },
];

function initials(name: string): string {
  return name
    .split(/[\s._@-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
}

function UserAvatar() {
  const { data, isLoading } = useQuery<AppIdentity>({
    queryKey: ['app-identity'],
    queryFn: apiClient.getAppIdentity,
  });

  if (isLoading) {
    return <div className="w-8 h-8 rounded-full bg-white/20 animate-pulse" />;
  }
  if (!data) return null;

  const abbr = initials(data.display_name || data.user_name || '?') || '?';
  const label = data.display_name !== data.user_name
    ? `${data.display_name} (${data.user_name})`
    : data.user_name;

  return (
    <div
      title={label}
      className="w-9 h-9 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center text-white text-sm font-semibold cursor-default select-none transition-colors"
    >
      {abbr}
    </div>
  );
}

function WorkspaceLabel({ workspace, workspaces }: { workspace: string; workspaces: WorkspaceInfo[] }) {
  const current = workspaces.find((w) => w.workspace_url === workspace);
  const dot = current?.is_primary ? 'bg-green-400' : 'bg-purple-400';
  return (
    <div className="flex items-center gap-2 text-sm text-white/80">
      <span className={`w-2 h-2 rounded-full shrink-0 ${dot}`} />
      <span className="hidden sm:block">{current?.display_name ?? '…'}</span>
    </div>
  );
}

export default function App() {
  const [tab, setTab] = useState<Tab>('overview');
  const [workspace, setWorkspace] = useState<string>(
    () => localStorage.getItem('selectedWorkspace') ?? ''
  );

  const { data: workspaces = [] } = useQuery<WorkspaceInfo[]>({
    queryKey: ['workspaces'],
    queryFn: apiClient.getWorkspaces,
  });

  // Once workspaces load, validate the stored selection.
  // 'primary' (old sentinel) and unknown URLs fall back to the first workspace.
  useEffect(() => {
    if (!workspaces.length) return;
    const validUrls = workspaces.map((w) => w.workspace_url);
    if (!workspace || workspace === 'primary' || !validUrls.includes(workspace)) {
      const first = workspaces[0].workspace_url;
      setWorkspace(first);
      localStorage.setItem('selectedWorkspace', first);
    }
  }, [workspaces]);

  const handleWorkspaceChange = (ws: string) => {
    setWorkspace(ws);
    localStorage.setItem('selectedWorkspace', ws);
  };

  const currentWorkspace = workspaces.find((w) => w.workspace_url === workspace) ?? null;

  return (
    <ToastProvider>
      <div className="min-h-screen bg-gray-50 text-gray-900">
        <header className="bg-brand-dark text-white">
          <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
            <h1 className="text-xl font-semibold">Unity Catalog Metadata Manager</h1>
            <div className="flex items-center gap-3 shrink-0">
              <WorkspaceLabel workspace={workspace} workspaces={workspaces} />
              <UserAvatar />
            </div>
          </div>
          <nav className="max-w-7xl mx-auto px-6 flex gap-1">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                  tab === t.id
                    ? 'border-brand text-white'
                    : 'border-transparent text-gray-300 hover:text-white'
                }`}
              >
                {t.label}
              </button>
            ))}
          </nav>
        </header>

        <main className="max-w-7xl mx-auto px-6 py-6">
          {tab === 'overview' && <Overview workspace={workspace} />}
          {tab === 'tags' && <TagManagement workspace={workspace} />}
          {tab === 'comments' && <CommentManagement workspace={workspace} />}
          {tab === 'settings' && (
            <Settings
              currentWorkspace={currentWorkspace}
              workspaces={workspaces}
              onWorkspaceChange={handleWorkspaceChange}
            />
          )}
        </main>
      </div>
    </ToastProvider>
  );
}
