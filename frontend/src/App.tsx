import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import Overview from './tabs/Overview';
import TagManagement from './tabs/TagManagement';
import Settings, { TagDictionarySection } from './tabs/Configuration';
import Setup from './tabs/Setup';
import Regions from './tabs/Regions';
import { ToastProvider } from './components/Toast';
import apiClient, { WorkspaceInfo, normalizeWorkspaceUrl } from './api/client';
import { useTheme } from './hooks/useTheme';

type Tab = 'overview' | 'tags' | 'dictionary' | 'settings' | 'regions' | 'health';

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

function IcoRegions({ active }: { active: boolean }) {
  const c = active ? 'text-white' : 'text-gray-400 group-hover:text-white';
  return (
    <svg className={`w-4 h-4 shrink-0 ${c}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round"
        d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 004 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
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
  { id: 'settings',    label: 'Settings',          Icon: IcoSettings  },
  { id: 'regions',     label: 'Metastore Regions', Icon: IcoRegions  },
  { id: 'health',      label: 'Health Check',      Icon: IcoHealth    },
];

// ─── Header helpers ───────────────────────────────────────────────────────────

function ActiveRegionLabel({ workspace, workspaces }: { workspace: string; workspaces: WorkspaceInfo[] }) {
  const current = workspaces.find((w) => w.workspace_url === workspace);
  const name = current?.display_name || current?.workspace_url || workspace || '…';
  const isPrimary = !!current?.is_primary;
  return (
    <div className="flex items-center gap-2 text-sm text-white/80">
      <span className="w-2 h-2 rounded-full shrink-0 bg-green-400" />
      <span className="hidden sm:block font-medium text-white">{name}</span>
      {isPrimary && (
        <span className="hidden sm:block text-xs text-white/50 font-normal">primary</span>
      )}
    </div>
  );
}

// ─── App ─────────────────────────────────────────────────────────────────────

function IcoSun() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <circle cx="12" cy="12" r="5" strokeLinecap="round" strokeLinejoin="round" />
      <path strokeLinecap="round" strokeLinejoin="round"
        d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
    </svg>
  );
}

function IcoMoon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round"
        d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
    </svg>
  );
}

export default function App() {
  const [theme, toggleTheme] = useTheme();
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

  const currentWorkspace = workspaces.find(
    (w) => normalizeWorkspaceUrl(w.workspace_url) === normalizeWorkspaceUrl(workspace)
  ) ?? null;

  return (
    <ToastProvider>
      <div className="min-h-screen bg-gray-50 text-gray-900 dark:bg-gray-900 dark:text-gray-100">
        <header className="bg-brand-dark text-white">
          <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
            <h1 className="text-xl font-semibold">Unity Catalog Metadata Manager</h1>
            <div className="flex items-center gap-3 shrink-0">
              <ActiveRegionLabel workspace={workspace} workspaces={workspaces} />
              <button
                onClick={toggleTheme}
                title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                className="p-1.5 rounded-md text-white/70 hover:text-white hover:bg-white/10 transition-colors"
              >
                {theme === 'dark' ? <IcoSun /> : <IcoMoon />}
              </button>
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
          {tab === 'overview'   && <Overview key={workspace} workspace={workspace} />}
          {tab === 'tags'       && <TagManagement workspace={workspace} />}
          {tab === 'dictionary' && <TagDictionarySection />}
          {tab === 'settings'   && (
            <Settings
              currentWorkspace={currentWorkspace}
            />
          )}
          {tab === 'regions' && (
            <Regions workspace={workspace} onWorkspaceChange={handleWorkspaceChange} />
          )}
          {tab === 'health' && <Setup workspace={workspace} workspaces={workspaces} />}
        </main>
      </div>
    </ToastProvider>
  );
}
