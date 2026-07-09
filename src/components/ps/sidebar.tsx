import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FolderClosed, Pencil, Trash2, Plus, Check, X, Inbox, History, Share2, Sparkles, LogOut, Sun, Moon, Settings, Lock, Search, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTheme } from "@/hooks/use-theme";

export type Folder = { id: string; name: string; kind?: "system" | "user"; sort_order?: number };
export type SidebarView = "workspace" | "history" | "shares" | "search" | "extension" | "settings";

type Props = {
  folders: Folder[];
  activeFolder: string | null;
  view: SidebarView;
  onView: (v: SidebarView) => void;
  onSelect: (id: string | null) => void;
  onCreate: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onSignOut: () => void;
  userEmail?: string | null;
};

function sortFolders(folders: Folder[]): Folder[] {
  return [...folders].sort((a, b) => {
    const aSys = a.kind === "system";
    const bSys = b.kind === "system";
    if (aSys !== bSys) return aSys ? -1 : 1;
    if (aSys && bSys) {
      if (a.name === "Unknown") return 1;
      if (b.name === "Unknown") return -1;
      return (a.sort_order ?? 0) - (b.sort_order ?? 0);
    }
    return a.name.localeCompare(b.name);
  });
}

export function PsSidebar({ folders, activeFolder, view, onView, onSelect, onCreate, onRename, onDelete, onSignOut, userEmail }: Props) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const { theme, toggle } = useTheme();

  const startCreate = () => onCreate("New Folder");
  const sorted = sortFolders(folders);

  const navBtn = (key: SidebarView, label: string, Icon: typeof Inbox, isActive: boolean) => (
    <button
      onClick={() => { onView(key); if (key === "workspace") onSelect(null); }}
      className={cn("w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors",
        isActive ? "bg-sidebar-accent" : "hover:bg-sidebar-accent/60")}
    >
      <Icon className="h-4 w-4" /> {label}
    </button>
  );

  return (
    <div className="bg-sidebar text-sidebar-foreground flex flex-col h-full w-full">
      <div className="p-4 flex items-center gap-2 border-b border-sidebar-border">
        <div className="h-8 w-8 rounded-md bg-primary flex items-center justify-center">
          <Sparkles className="h-4 w-4 text-primary-foreground" />
        </div>
        <div>
          <div className="font-semibold text-sm tracking-tight">PageSprint AI</div>
          <div className="text-[10px] text-muted-foreground -mt-0.5">Study fast. Stay sharp.</div>
        </div>
      </div>

      <nav className="px-2 py-3 space-y-1">
        {navBtn("workspace", "Workspace", Inbox, view === "workspace" && !activeFolder)}
        {navBtn("history", "History", History, view === "history")}
        {navBtn("shares", "Share History", Share2, view === "shares")}
        {navBtn("search", "Global Search", Search, view === "search")}
        {navBtn("extension", "Extension", Zap, view === "extension")}
      </nav>

      <div className="px-3 pt-2 pb-1 flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Folders</span>
        <button onClick={startCreate} className="text-muted-foreground hover:text-foreground" title="Create folder">
          <Plus className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-0.5">
        {sorted.length === 0 && (
          <p className="px-2 py-6 text-xs text-muted-foreground text-center">
            No folders yet.<br />Click <span className="inline-flex items-center"><Plus className="h-3 w-3" /></span> to create one.
          </p>
        )}
        {sorted.map((f) => {
          const active = activeFolder === f.id;
          const isSystem = f.kind === "system";
          if (editing === f.id && !isSystem) {
            return (
              <div key={f.id} className="flex items-center gap-1 px-1">
                <Input
                  autoFocus value={draft} onChange={(e) => setDraft(e.target.value)}
                  className="h-7 text-sm" onKeyDown={(e) => {
                    if (e.key === "Enter") { onRename(f.id, draft.trim() || f.name); setEditing(null); }
                    if (e.key === "Escape") setEditing(null);
                  }}
                />
                <button onClick={() => { onRename(f.id, draft.trim() || f.name); setEditing(null); }} className="text-primary"><Check className="h-4 w-4" /></button>
                <button onClick={() => setEditing(null)} className="text-muted-foreground"><X className="h-4 w-4" /></button>
              </div>
            );
          }
          return (
            <div key={f.id}
              className={cn("group flex items-center gap-2 px-2 py-1.5 rounded-md text-sm cursor-pointer transition-colors",
                active ? "bg-sidebar-accent" : "hover:bg-sidebar-accent/60")}
              onClick={() => { onView("workspace"); onSelect(f.id); }}
            >
              <FolderClosed className={cn("h-4 w-4 shrink-0", isSystem ? "text-primary" : "text-muted-foreground")} />
              <span className="truncate flex-1">{f.name}</span>
              {isSystem ? (
                <Lock className="h-3 w-3 text-muted-foreground/60" aria-label="Mandatory folder" />
              ) : (
                <>
                  <button
                    onClick={(e) => { e.stopPropagation(); setDraft(f.name); setEditing(f.id); }}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-foreground sm:h-7 sm:w-7"
                    title="Rename"
                  ><Pencil className="h-3.5 w-3.5" /></button>
                  <button
                    onClick={(e) => { e.stopPropagation(); if (confirm(`Delete folder "${f.name}"?`)) onDelete(f.id); }}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-destructive sm:h-7 sm:w-7"
                    title="Delete"
                  ><Trash2 className="h-3.5 w-3.5" /></button>
                </>
              )}
            </div>
          );
        })}
      </div>

      <div className="border-t border-sidebar-border p-3 space-y-2">
        <button
          onClick={toggle}
          className="w-full flex items-center justify-between px-2 py-1.5 rounded-md text-xs hover:bg-sidebar-accent/60 transition-colors"
          title="Toggle theme"
        >
          <span className="text-muted-foreground">Theme</span>
          <span className="inline-flex items-center gap-1.5 font-medium">
            {theme === "dark" ? <><Moon className="h-3.5 w-3.5" /> Dark</> : <><Sun className="h-3.5 w-3.5" /> Light</>}
          </span>
        </button>
        <button
          onClick={() => onView("settings")}
          className={cn("w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors",
            view === "settings" ? "bg-sidebar-accent" : "hover:bg-sidebar-accent/60")}
        >
          <Settings className="h-4 w-4" /> Settings
        </button>
        <Button variant="outline" size="sm" className="w-full justify-between" onClick={onSignOut}>
          <span className="truncate text-xs">{userEmail ?? "Account"}</span>
          <LogOut className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
