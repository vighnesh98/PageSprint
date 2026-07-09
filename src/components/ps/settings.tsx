import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Loader2, LogOut, Trash2, UserX, BookOpen, Image as ImageIcon } from "lucide-react";
import { toast } from "sonner";
import {
  getProfile, updateProfile, syncCourseFolders, switchCourse, deleteAllHistory, deleteAccount, COURSE_FOLDERS,
} from "@/lib/settings.functions";
import { supabase } from "@/integrations/supabase/client";

export function PsSettings({ userEmail, onGoDeleteHistory }: { userEmail?: string | null; onGoDeleteHistory?: () => void }) {
  const qc = useQueryClient();
  const fGet = useServerFn(getProfile);
  const fUpdate = useServerFn(updateProfile);
  const fSync = useServerFn(syncCourseFolders);
  const fSwitch = useServerFn(switchCourse);
  const fDelHist = useServerFn(deleteAllHistory);
  const fDelAcct = useServerFn(deleteAccount);

  const profileQ = useQuery({ queryKey: ["profile"], queryFn: () => fGet() });
  const profile = profileQ.data;

  const [savingCourse, setSavingCourse] = useState(false);
  const [pendingCourse, setPendingCourse] = useState<"A" | "B" | null>(null);

  const requestCourseChange = (course: "A" | "B") => {
    if (!profile?.course) {
      // First-time set — no wipe needed (no data yet)
      void doInitialCourse(course);
      return;
    }
    if (course === profile.course) return;
    setPendingCourse(course);
  };

  const doInitialCourse = async (course: "A" | "B") => {
    setSavingCourse(true);
    try {
      await fUpdate({ data: { course } });
      await fSync({ data: { course } });
      await qc.invalidateQueries({ queryKey: ["profile"] });
      await qc.invalidateQueries({ queryKey: ["folders"] });
      toast.success(`Course ${course} selected`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSavingCourse(false);
    }
  };

  const confirmSwitch = async () => {
    if (!pendingCourse) return;
    setSavingCourse(true);
    try {
      await fSwitch({ data: { course: pendingCourse } });
      // Clear any client-side state we own
      try {
        Object.keys(localStorage).forEach((k) => { if (k.startsWith("ps:")) localStorage.removeItem(k); });
      } catch {/* ignore */}
      await qc.invalidateQueries();
      toast.success(`Switched to Course ${pendingCourse} — workspace reset`);
      setPendingCourse(null);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSavingCourse(false);
    }
  };

  const toggleDiagrams = async (v: boolean) => {
    try {
      await fUpdate({ data: { diagrams_enabled: v } });
      await qc.invalidateQueries({ queryKey: ["profile"] });
      toast.success(v ? "Diagrams enabled" : "Diagrams disabled");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const delHistMut = useMutation({
    mutationFn: () => fDelHist(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["summaries"] });
      qc.invalidateQueries({ queryKey: ["my-shares"] });
      toast.success("All history deleted");
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const delAcctMut = useMutation({
    mutationFn: () => fDelAcct(),
    onSuccess: async () => {
      await supabase.auth.signOut();
      toast.success("Account deleted");
      window.location.href = "/login";
    },
    onError: (e) => toast.error((e as Error).message),
  });

  if (profileQ.isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-5 max-w-2xl">
      {/* Course */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-primary" /> Course
          </CardTitle>
          <CardDescription>
            Determines your mandatory folders and how new summaries get auto-classified.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RadioGroup
            value={profile?.course ?? ""}
            onValueChange={(v) => requestCourseChange(v as "A" | "B")}
            className="grid sm:grid-cols-2 gap-3"
          >
            {(["A", "B"] as const).map((c) => (
              <Label
                key={c}
                htmlFor={`course-${c}`}
                className="flex items-start gap-3 rounded-lg border p-3 cursor-pointer hover:bg-accent/50 transition-colors has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5"
              >
                <RadioGroupItem value={c} id={`course-${c}`} className="mt-0.5" />
                <div className="space-y-1">
                  <div className="text-sm font-medium">Course {c}</div>
                  <div className="text-[11px] text-muted-foreground leading-relaxed">
                    {COURSE_FOLDERS[c].join(" · ")}
                  </div>
                </div>
              </Label>
            ))}
          </RadioGroup>
          {savingCourse && (
            <div className="mt-3 text-xs text-muted-foreground flex items-center gap-1.5">
              <Loader2 className="h-3 w-3 animate-spin" /> Working…
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={!!pendingCourse} onOpenChange={(o) => !o && setPendingCourse(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Switch to Course {pendingCourse}?</AlertDialogTitle>
            <AlertDialogDescription>
              Changing courses will <strong>permanently delete all folders and history</strong> associated with Course {profile?.course}. This cannot be undone. Proceed?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={confirmSwitch}
            >
              {savingCourse ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : null}
              Wipe &amp; switch
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>


      {/* Diagrams */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <ImageIcon className="h-4 w-4 text-primary" /> Diagrams
          </CardTitle>
          <CardDescription>
            When on, the system extracts cropped diagrams from your notes and shows them under their matching topic.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-between gap-3">
          <div className="text-sm">
            <div className="font-medium">Extract diagrams</div>
            <div className="text-xs text-muted-foreground">
              Diagrams appear only under the topic they belong to.
            </div>
          </div>
          <Switch
            checked={!!profile?.diagrams_enabled}
            onCheckedChange={toggleDiagrams}
          />
        </CardContent>
      </Card>

      {/* Data controls */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Data controls</CardTitle>
          <CardDescription>{userEmail}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <Button
            variant="outline"
            className="w-full justify-start"
            onClick={async () => {
              await supabase.auth.signOut();
              toast.success("Signed out");
            }}
          >
            <LogOut className="h-4 w-4 mr-2" /> Log out
          </Button>

          <Button
            variant="outline"
            className="w-full justify-start"
            onClick={() => {
              if (onGoDeleteHistory) onGoDeleteHistory();
              else toast.message("Open History to delete summaries");
            }}
          >
            <Trash2 className="h-4 w-4 mr-2" /> Delete history
            <span className="ml-auto text-[10.5px] text-muted-foreground">Pick what to remove →</span>
          </Button>

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" className="w-full justify-start">
                <UserX className="h-4 w-4 mr-2" /> Delete account
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete your account?</AlertDialogTitle>
                <AlertDialogDescription>
                  This permanently removes your profile, all folders, all summaries, and your sign-in. This cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  onClick={() => delAcctMut.mutate()}
                >
                  {delAcctMut.isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : null}
                  Delete account
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardContent>
      </Card>
    </div>
  );
}
