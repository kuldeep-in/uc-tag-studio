import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import Overview from './tabs/Overview';
import TagManagement from './tabs/TagManagement';
import Settings, { TagDictionarySection } from './tabs/Configuration';
import Setup from './tabs/Setup';
import { ToastProvider } from './components/Toast';
import apiClient, { WorkspaceInfo } from './api/client';

type Tab = 'overview' | 'tags' | 'dictionary' | 'settings' | 'health';

// ─── Tab icons ────────────────────────────────────────────────────────────────

function IcoOverview({ active }: { active: boolean }) {
  const c = active ? 'text-white' : 'text-gray-400 group-hover:text-white';
  return (
    <svg className={`w-4 h-4 shrink-0 ${c}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <rect x="3" y="12" width="4" height="9" rx="1" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="10" y="7" width="4" height="14" rx="1" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="17" y="3" width="4" height="18" rx="1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IcoTag({ active }: { active: boolean }) {
  const c = active ? 'text-white' : 'text-gray-400 group-hover:text-white';
  return (
    <svg className={`w-4 h-4 shrink-0 ${c}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round"
        d="M7 7h.01M3 3h8.5L21 12.5l-8.5 8.5L3 11.5V3z" />
    </svg>
  );
}

function IcoBook({ active }: { active: boolean }) {
  const c = active ? 'text-white' : 'text-gray-400 group-hover:text-white';
  return (
    <svg className={`w-4 h-4 shrink-0 ${c}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round"
        d="M12 6.5A6.5 6.5 0 015.5 3H3v17h2.5A6.5 6.5 0 0112 17.5m0-11A6.5 6.5 0 0118.5 3H21v17h-2.5A6.5 6.5 0 0112 17.5m0-11v11" />
    </svg>
  );
}

function IcoSettings({ active }: { active: boolean }) {
  const c = active ? 'text-white' : 'text-gray-400 group-hover:text-white';
  return (
    <svg className={`w-4 h-4 shrink-0 ${c}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round"
        d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  );
}

function IcoHealth({ active }: { active: boolean }) {
  const c = active ? 'text-white' : 'text-gray-400 group-hover:text-white';
  return (
    <svg className={`w-4 h-4 shrink-0 ${c}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round"
        d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
    </svg>
  );
}

const TABS: { id: Tab; label: string; Icon: (p: { active: boolean }) => JSX.Element }[] = [
  { id: 'overview',    label: 'Overview',       Icon: IcoOverview  },
  { id: 'tags',        label: 'Tag Management', Icon: IcoTag       },
  { id: 'dictionary',  label: 'Tag Dictionary', Icon: IcoBook      },
  { id: 'settings',    label: 'Settings',       Icon: IcoSettings  },
  { id: 'health',      label: 'Health Check',   Icon: IcoHealth    },
];

// ─── Header helpers ───────────────────────────────────────────────────────────

function WorkspaceLabel({ workspace, workspaces }: { workspace: string; workspaces: WorkspaceInfo[] }) {
  const current = workspaces.find((w) => w.workspace_url === workspace);
  const dot = 'bg-green-400';
  const label = current
    ? current.display_name
      ? `${current.display_name} (${current.workspace_url})`
      : current.workspace_url
    : workspace || '…';
  return (
    <div className="flex items-center gap-2 text-sm text-white/80">
      <span className={`w-2 h-2 rounded-full shrink-0 ${dot}`} />
      <span className="hidden sm:block">{label}</span>
    </div>
  );
}

// ─── App ─────────────────────────────────────────────────────────────────────

export default function App() {
  const [tab, setTab] = useState<Tab>('overview');
  const [workspace, setWorkspace] = useState<string>(
    () => localStorage.getItem('selectedWorkspace') ?? ''
  );

  const { data: workspaces = [] } = useQuery<WorkspaceInfo[]>({
    queryKey: ['workspaces'],
    queryFn: apiClient.getWorkspaces,
  });

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
            </div>
          </div>
          <nav className="max-w-7xl mx-auto px-6 flex gap-0.5">
            {TABS.map(({ id, label, Icon }) => {
              const active = tab === id;
              return (
                <button
                  key={id}
                  onClick={() => setTab(id)}
                  className={`group flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                    active
                      ? 'border-white text-white'
                      : 'border-transparent text-gray-300 hover:text-white'
                  }`}
                >
                  <Icon active={active} />
                  {label}
                </button>
              );
            })}
          </nav>
        </header>

        <main className="max-w-7xl mx-auto px-6 py-6">
          {tab === 'overview'   && <Overview workspace={workspace} />}
          {tab === 'tags'       && <TagManagement workspace={workspace} />}
          {tab === 'dictionary' && <TagDictionarySection />}
          {tab === 'settings'   && (
            <Settings
              currentWorkspace={currentWorkspace}
              workspaces={workspaces}
              onWorkspaceChange={handleWorkspaceChange}
            />
          )}
          {tab === 'health' && <Setup workspace={workspace} workspaces={workspaces} />}
        </main>
      </div>
    </ToastProvider>
  );
}
