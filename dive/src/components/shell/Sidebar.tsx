import { useEffect, useState } from "react";
import { Languages, Moon, Plus, Sun, Trash2 } from "lucide-react";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { useTheme } from "../../hooks/useTheme";
import {
  useProjectSessionStore,
  selectCurrentProject,
  selectHasConnectedProvider,
} from "../../stores/project-session";
import { NewProjectDialog } from "../onboarding/NewProjectDialog";
import { useLocale, useLocaleStore, useT } from "../../i18n";

interface SidebarProps {
  className?: string;
}

export function Sidebar({ className }: SidebarProps) {
  const { theme, toggleTheme } = useTheme();
  const t = useT();
  const locale = useLocale();
  const setLocale = useLocaleStore((s) => s.setLocale);
  const themeSwitchLabel =
    theme === "dark" ? t("sidebar.theme_to_light") : t("sidebar.theme_to_dark");
  const [projectDialogOpen, setProjectDialogOpen] = useState(false);

  const loaded = useProjectSessionStore((s) => s.loaded);
  const loadAll = useProjectSessionStore((s) => s.loadAll);
  const projects = useProjectSessionStore((s) => s.projects);
  const sessions = useProjectSessionStore((s) => s.sessions);
  const currentProject = useProjectSessionStore(selectCurrentProject);
  const currentSessionId = useProjectSessionStore((s) => s.currentSessionId);
  const hasProvider = useProjectSessionStore(selectHasConnectedProvider);
  const providers = useProjectSessionStore((s) => s.providers);
  const selectProject = useProjectSessionStore((s) => s.selectProject);
  const deleteProject = useProjectSessionStore((s) => s.deleteProject);
  const createSession = useProjectSessionStore((s) => s.createSession);
  const selectSession = useProjectSessionStore((s) => s.selectSession);
  const deleteSession = useProjectSessionStore((s) => s.deleteSession);

  useEffect(() => {
    if (!loaded) void loadAll().catch(() => undefined);
  }, [loaded, loadAll]);

  const handleNewSession = async () => {
    if (!currentProject) return;
    await createSession(currentProject.id);
  };

  const handleDeleteProject = async (id: number) => {
    const ok = window.confirm(t("sidebar.delete_project_confirm"));
    if (!ok) return;
    await deleteProject(id, false);
  };

  const handleDeleteSession = async (id: number) => {
    const ok = window.confirm(t("sidebar.delete_session_confirm"));
    if (!ok) return;
    await deleteSession(id);
  };

  const providerLabel =
    providers.find((p) => p.is_connected)?.kind ??
    (hasProvider ? t("sidebar.provider_connected") : t("sidebar.provider_not_connected"));

  return (
    <aside
      className={cn(
        "flex h-full flex-col gap-4 border-r bg-bg-panel px-4 py-5",
        "overflow-y-auto",
        className,
      )}
      data-testid="sidebar"
      aria-label={t("a11y.region_sidebar")}
    >
      <div className="flex items-center gap-2 px-1">
        <span className="text-xl font-bold tracking-tight text-accent">DIVE</span>
      </div>

      <SidebarSection label={t("sidebar.section_projects")}>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start"
          onClick={() => setProjectDialogOpen(true)}
          data-testid="btn-new-project"
        >
          <Plus className="h-3.5 w-3.5" />
          {t("sidebar.new_project")}
        </Button>
        {projects.length === 0 ? (
          <EmptyLine text={t("sidebar.empty_projects")} />
        ) : (
          <ul className="flex flex-col gap-0.5" data-testid="project-list">
            {projects.map((p) => (
              <li key={p.id} className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => void selectProject(p.id)}
                  className={cn(
                    "flex-1 rounded-md px-3 py-1.5 text-left text-sm text-fg hover:bg-bg-panel2",
                    currentProject?.id === p.id && "bg-accent-subtle text-fg",
                  )}
                  data-testid="project-item"
                  data-project-id={p.id}
                  data-active={currentProject?.id === p.id ? "true" : "false"}
                >
                  <div className="truncate font-medium">{p.name}</div>
                  <div className="truncate text-[10px] text-fg-muted">{p.path}</div>
                </button>
                <button
                  type="button"
                  onClick={() => void handleDeleteProject(p.id)}
                  className="rounded p-1 text-fg-muted hover:bg-bg-panel2 hover:text-danger"
                  aria-label={t("sidebar.delete_project_title", { name: p.name })}
                  data-testid="project-delete"
                  data-project-id={p.id}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </SidebarSection>

      <SidebarSection label={t("sidebar.section_sessions")}>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start"
          onClick={() => void handleNewSession()}
          disabled={!currentProject}
          data-testid="btn-new-session"
        >
          <Plus className="h-3.5 w-3.5" />
          {t("sidebar.new_session")}
        </Button>
        {currentProject ? (
          sessions.length === 0 ? (
            <EmptyLine text={t("sidebar.empty_sessions")} />
          ) : (
            <ul className="flex flex-col gap-0.5" data-testid="session-list">
              {sessions.map((s) => (
                <li key={s.id} className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => selectSession(s.id)}
                    className={cn(
                      "flex-1 rounded-md px-3 py-1.5 text-left text-xs text-fg hover:bg-bg-panel2",
                      currentSessionId === s.id && "bg-accent-subtle",
                      s.status === "archived" && "opacity-60",
                    )}
                    data-testid="session-item"
                    data-session-id={s.id}
                    data-active={currentSessionId === s.id ? "true" : "false"}
                  >
                    <div className="truncate">{s.title}</div>
                    {s.status === "archived" ? (
                      <div className="text-[9px] text-fg-muted">{t("sidebar.archived")}</div>
                    ) : null}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDeleteSession(s.id)}
                    className="rounded p-1 text-fg-muted hover:bg-bg-panel2 hover:text-danger"
                    aria-label={t("sidebar.delete_session_title", { title: s.title })}
                    data-testid="session-delete"
                    data-session-id={s.id}
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : (
          <EmptyLine text={t("sidebar.select_project_first")} />
        )}
      </SidebarSection>

      <div className="mt-auto flex flex-col gap-2 pt-4">
        <button
          type="button"
          aria-label={t("sidebar.open_settings")}
          onClick={() => {
            const url = new URL(window.location.href);
            url.searchParams.delete("demo");
            url.searchParams.set("route", "settings");
            window.history.pushState({}, "", url.toString());
            window.dispatchEvent(new PopStateEvent("popstate"));
          }}
          className="block w-full text-left rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
          data-testid="btn-open-settings"
        >
          <Card className="px-3 py-2.5 hover:bg-bg-panel2">
            <div className="text-xs text-fg-muted">{t("sidebar.current_model")}</div>
            <div className="truncate text-sm font-medium text-fg" data-testid="provider-label">
              {providerLabel}
            </div>
          </Card>
        </button>

        <div
          role="group"
          aria-label={t("sidebar.language")}
          className="flex items-center gap-1 rounded-md border border-border bg-bg-panel2 p-1"
          data-testid="language-switch"
        >
          <Languages className="mx-1 h-3.5 w-3.5 text-fg-muted" aria-hidden="true" />
          {(["ko", "en"] as const).map((code) => (
            <button
              key={code}
              type="button"
              onClick={() => setLocale(code)}
              aria-pressed={locale === code}
              className={cn(
                "flex-1 rounded px-2 py-1 text-xs font-medium transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                locale === code
                  ? "bg-accent-subtle text-fg"
                  : "text-fg-muted hover:text-fg hover:bg-bg-panel",
              )}
              data-testid={`lang-${code}`}
              data-active={locale === code ? "true" : "false"}
            >
              {code === "ko" ? t("sidebar.lang_ko") : t("sidebar.lang_en")}
            </button>
          ))}
        </div>

        <Button
          variant="ghost"
          size="sm"
          onClick={toggleTheme}
          aria-label={themeSwitchLabel}
          className="w-full justify-start"
        >
          {theme === "dark" ? <Sun /> : <Moon />}
          {themeSwitchLabel}
        </Button>
      </div>

      <NewProjectDialog open={projectDialogOpen} onOpenChange={setProjectDialogOpen} />
    </aside>
  );
}

function SidebarSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="px-1 text-xs font-semibold uppercase tracking-wider text-fg-muted">
        {label}
      </div>
      {children}
    </div>
  );
}

function EmptyLine({ text }: { text: string }) {
  return <div className="px-3 py-1.5 text-xs text-fg-subtle">{text}</div>;
}

export default Sidebar;
