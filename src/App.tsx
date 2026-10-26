import { useCallback, useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { createDemoStore, demoStorageStatus, resetDemoStorage, type DemoStorageStatus } from "./lib/demoStore.ts";
import { errorMessage } from "./lib/format.ts";
import { createRemoteStore } from "./lib/remoteStore.ts";
import type { HuntRepository, Workspace } from "./lib/repository.ts";
import { getSupabase } from "./lib/supabase.ts";
import { BoardScreen } from "./ui/BoardScreen.tsx";
import { PostingScreen } from "./ui/PostingScreen.tsx";
import { ProfileScreen } from "./ui/ProfileScreen.tsx";
import { ResultsScreen } from "./ui/ResultsScreen.tsx";
import { SetupScreen } from "./ui/SetupScreen.tsx";
import { RecoveryScreen } from "./ui/RecoveryScreen.tsx";

export type View = "profile" | "postings" | "board" | "results";

const VIEWS: Array<{ id: View; label: string }> = [
  { id: "profile", label: "Profile" },
  { id: "postings", label: "Postings & packets" },
  { id: "board", label: "Board" },
  { id: "results", label: "Results" },
];

const DEMO_CHOICE_KEY = "job-hunt-copilot-demo-chosen";

function readDemoChoice(): boolean {
  try {
    return sessionStorage.getItem(DEMO_CHOICE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeDemoChoice(chosen: boolean) {
  try {
    if (chosen) sessionStorage.setItem(DEMO_CHOICE_KEY, "1");
    else sessionStorage.removeItem(DEMO_CHOICE_KEY);
  } catch {
    // storage unavailable: the choice lasts until reload
  }
}

export function App() {
  const client = getSupabase();
  const [repo, setRepo] = useState<HuntRepository | null>(null);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [view, setView] = useState<View>("profile");
  const [error, setError] = useState<string | null>(null);
  const [demoStatus, setDemoStatus] = useState<DemoStorageStatus>(() => demoStorageStatus());
  const [selectedApplicationId, setSelectedApplicationId] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [recovery, setRecovery] = useState(false);
  const recovering = useRef(false);
  // Once the person explicitly chooses the demo, a leftover auth session must not replace it. The choice is
  // remembered for this tab only (sessionStorage), so a reload stays in the demo.
  const preferDemo = useRef(readDemoChoice());
  // The adapter whose data may be shown. Results of a load started for another adapter are dropped, so a
  // slow remote load can never land under the demo banner (or the reverse).
  const activeRepo = useRef<HuntRepository | null>(null);

  const activate = useCallback((next: HuntRepository | null) => {
    activeRepo.current = next;
    setRepo(next);
    if (!next) setWorkspace(null);
  }, []);

  const refresh = useCallback(async (target: HuntRepository | null = activeRepo.current) => {
    if (!target) return;
    try {
      const loaded = await target.load();
      if (activeRepo.current !== target) return;
      setWorkspace(loaded);
      setError(null);
    } catch (caught) {
      if (activeRepo.current !== target) return;
      setError(errorMessage(caught));
    }
  }, []);

  const applySession = useCallback(
    (session: Session | null) => {
      if (preferDemo.current || recovering.current || !client) return;
      if (!session) {
        activate(null);
        return;
      }
      const remote = createRemoteStore(client, session.user.id);
      activate(remote);
      void refresh(remote);
    },
    [client, refresh, activate],
  );

  useEffect(() => {
    if (preferDemo.current && demoStorageStatus() !== "incompatible") chooseDemo();
    if (!client) return;
    let active = true;
    void client.auth.getSession().then(({ data }) => {
      if (active) applySession(data.session);
    });
    const { data } = client.auth.onAuthStateChange((event, session) => {
      if (preferDemo.current) return;
      if (event === "PASSWORD_RECOVERY" && session) {
        recovering.current = true;
        setRecovery(true);
        activate(null);
      } else if (event === "SIGNED_OUT") {
        recovering.current = false;
        setRecovery(false);
        activate(null);
      } else applySession(session);
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [client]);

  function chooseDemo() {
    try {
      const demo = createDemoStore();
      preferDemo.current = true;
      writeDemoChoice(true);
      activate(demo);
      void refresh(demo);
    } catch (caught) {
      setError(errorMessage(caught));
      setDemoStatus(demoStorageStatus());
    }
  }

  function resetDemo() {
    resetDemoStorage();
    setConfirmReset(false);
    setDemoStatus(demoStorageStatus());
    if (repo?.mode === "demo") {
      const demo = createDemoStore();
      activate(demo);
      setSelectedApplicationId(null);
      void refresh(demo);
    }
  }

  function leave() {
    if (repo?.mode === "remote" && client) void client.auth.signOut();
    preferDemo.current = false;
    writeDemoChoice(false);
    activate(null);
    setSelectedApplicationId(null);
    setView("profile");
    setDemoStatus(demoStorageStatus());
  }

  if (recovery && client) {
    return <RecoveryScreen client={client} onDone={async () => {
      const result = await client.auth.signOut();
      if (result.error) throw result.error;
      recovering.current = false;
      setRecovery(false);
      activate(null);
    }} />;
  }

  if (!repo || !workspace) {
    return (
      <SetupScreen
        client={client}
        demoStatus={demoStatus}
        error={error}
        onDemo={chooseDemo}
        onResetDemo={resetDemo}
        onSession={applySession}
      />
    );
  }

  const shared = { repo, workspace, onChanged: () => refresh() };

  return (
    <div className="shell">
      <header className="topbar">
        <h1>Job Hunt Copilot</h1>
        <nav className="nav" aria-label="Views">
          {VIEWS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={view === item.id ? "" : "quiet"}
              aria-current={view === item.id ? "page" : undefined}
              onClick={() => setView(item.id)}
            >
              {item.label}
            </button>
          ))}
          <button type="button" className="quiet" onClick={leave}>
            {repo.mode === "demo" ? "Leave demo" : "Sign out"}
          </button>
        </nav>
      </header>
      {repo.mode === "demo" ? (
        <p className="banner" role="status">
          Synthetic demo. Data stays in this browser only (key job-hunt-copilot-demo-v2). Nothing is sent anywhere;
          approvals here are demo-local with no server receipt.{" "}
          {confirmReset ? (
            <>
              <button type="button" className="link" onClick={resetDemo}>Confirm reset</button>{" "}
              <button type="button" className="link" onClick={() => setConfirmReset(false)}>Cancel</button>
            </>
          ) : (
            <button type="button" className="link" onClick={() => setConfirmReset(true)}>Reset demo</button>
          )}
        </p>
      ) : (
        <p className="banner live" role="status">Signed in. Approval and stage changes are decided by the server.</p>
      )}
      {error ? <p className="error" role="alert">{error}</p> : null}
      {view === "profile" ? <ProfileScreen {...shared} /> : null}
      {view === "postings" ? (
        <PostingScreen key={selectedApplicationId ?? "none"} {...shared} selectedApplicationId={selectedApplicationId} onSelect={setSelectedApplicationId} />
      ) : null}
      {view === "board" ? (
        <BoardScreen
          {...shared}
          onOpenPacket={(applicationId) => {
            setSelectedApplicationId(applicationId);
            setView("postings");
          }}
        />
      ) : null}
      {view === "results" ? <ResultsScreen mode={repo.mode} /> : null}
    </div>
  );
}
