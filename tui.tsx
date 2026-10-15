/** @jsxImportSource @opentui/solid */
import type { Context } from "@opencode/plugin/tui/context";
import { Plugin } from "@opencode/plugin/tui";
import { RGBA, type ScrollBoxRenderable } from "@opentui/core";
import { useTerminalDimensions } from "@opentui/solid";
import { createEffect, createMemo, createSignal, For, on, onCleanup, onMount, Show } from "solid-js";
import { UniiChatRpc } from "./rpc.ts";

const POLL_INTERVAL_MS = 2_000;
const rpcClient = (ctx: Context) => ctx.client.rpc(UniiChatRpc);
type Status = Awaited<ReturnType<ReturnType<typeof rpcClient>["status"]>>;

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error !== null && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  return String(error);
}

function usageLabel(usage: Status["lastTurn"]): string {
  if (!usage) return "not available";
  const cost = Number.isFinite(usage.cost) ? ` · $${usage.cost.toFixed(4)}` : "";
  return `cache read/write ${usage.cacheRead}/${usage.cacheWrite}${cost}`;
}

const LINE = /^(\d+)\+(\d+)\|/;
const WORK = /^work: \[([^\]\s]+)\]/;

// One screen of the browser: the live view, the two lines a zoom opened, or a whole message.
type Level =
  | { kind: "list"; title: string; lines: string[]; selected: number }
  | { kind: "text"; title: string; text: string; agent?: string };

function Popup(props: { ctx: Context; sessionID: string }) {
  const ctx = props.ctx;
  const rpc = rpcClient(ctx);
  const controller = new AbortController();
  const options = { location: ctx.location, signal: controller.signal };
  const dimensions = useTerminalDimensions();
  // The dialog is centered and adds one row of top padding. Give the popup a fixed
  // height that fits the terminal and let the scrollbox take what the header leaves,
  // so the bottom of the view is never drawn past the screen.
  const outer = () => Math.max(12, dimensions().height - 6);
  const page = () => Math.max(1, (scroll?.viewport.height ?? outer()) - 1);
  const [status, setStatus] = createSignal<Status>();
  const [lines, setLines] = createSignal<string[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [statusError, setStatusError] = createSignal<string>();
  const [viewError, setViewError] = createSignal<string>();
  // The live view is the root; Enter pushes a zoom, Escape pops it.
  const [rootSelected, setRootSelected] = createSignal<number>();
  const [stack, setStack] = createSignal<Level[]>([]);
  const [busy, setBusy] = createSignal(false);
  const [zoomError, setZoomError] = createSignal<string>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let scroll: ScrollBoxRenderable | undefined;

  const top = () => stack().at(-1);
  const current = (): Level => top() ?? {
    kind: "list",
    title: "View",
    lines: lines(),
    selected: Math.min(rootSelected() ?? lines().length - 1, lines().length - 1),
  };
  const select = (index: number) => {
    const level = current();
    if (level.kind !== "list" || level.lines.length === 0) return;
    const next = Math.max(0, Math.min(level.lines.length - 1, index));
    if (stack().length === 0) setRootSelected(next >= lines().length - 1 ? undefined : next);
    else setStack((levels) => [...levels.slice(0, -1), { ...level, selected: next }]);
  };

  // Keep the selected line on screen, but only when the selection or level changes, so a
  // poll does not undo mouse-wheel scrolling.
  const focus = createMemo(() => {
    const level = current();
    return level.kind === "list" ? `${stack().length}:${level.selected}` : undefined;
  });
  createEffect(on(focus, (key) => {
    if (key === undefined) return;
    const index = Number(key.split(":")[1]);
    // Rows of a new level or a first load are laid out after this effect runs.
    setTimeout(() => {
      const row = scroll?.getChildren()[index];
      if (row) scroll?.scrollChildIntoView(row.id);
    }, 0);
  }));

  // PgUp/PgDn move the selection by about a screen of rows; lines wrap, so count rows, not lines.
  const pageSelect = (direction: 1 | -1) => {
    const level = current();
    if (level.kind !== "list") return;
    const rows = scroll?.getChildren() ?? [];
    let budget = page();
    let index = level.selected;
    while (budget > 0) {
      const next = index + direction;
      if (next < 0 || next >= rows.length) break;
      budget -= Math.max(1, rows[next]!.height);
      index = next;
    }
    select(index);
  };

  const refresh = async () => {
    const input = { sessionID: props.sessionID };
    await Promise.allSettled([
      rpc.status(input, options).then((next) => {
        if (controller.signal.aborted) return;
        setStatus(next);
        setStatusError(undefined);
      }).catch((cause) => {
        if (!controller.signal.aborted) setStatusError(errorMessage(cause));
      }),
      rpc.view(input, options).then((view) => {
        if (controller.signal.aborted) return;
        setLines(view);
        setViewError(undefined);
      }).catch((cause) => {
        if (!controller.signal.aborted) setViewError(errorMessage(cause));
      }).finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      }),
    ]);
    if (!controller.signal.aborted) {
      timer = setTimeout(() => void refresh(), POLL_INTERVAL_MS);
    }
  };

  const open = async (title: string, input: { id: number; n: number } | { name: string }) => {
    if (busy()) return;
    setBusy(true);
    setZoomError(undefined);
    try {
      const text = await rpc.archive({ sessionID: props.sessionID, ...input }, options);
      if (controller.signal.aborted) return;
      const level: Level = "n" in input && input.n > 1
        ? { kind: "list", title, lines: text.split("\n").filter(Boolean), selected: 0 }
        : { kind: "text", title, text: text || "(empty)", agent: "n" in input ? WORK.exec(text)?.[1] : undefined };
      setStack((levels) => [...levels, level]);
      scroll?.scrollTo(0);
    } catch (cause) {
      if (!controller.signal.aborted) setZoomError(errorMessage(cause));
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  };

  const zoomIn = () => {
    const level = current();
    if (level.kind === "text") {
      if (level.agent) void open(`agent ${level.agent}`, { name: level.agent });
      return;
    }
    const match = LINE.exec(level.lines[level.selected] ?? "");
    if (match) void open(`${match[1]}+${match[2]}`, { id: Number(match[1]), n: Number(match[2]) });
  };

  const back = () => {
    setZoomError(undefined);
    if (stack().length === 0) {
      ctx.ui.dialog.clear();
      return;
    }
    setStack((levels) => levels.slice(0, -1));
  };

  // Bound in the modal layer, like OpenCode's own dialogs: a raw key handler loses
  // PgUp/PgDn to the session's global page commands, which also close the dialog.
  // Priority lets Escape step back out of a zoom before the dialog's own Escape closes it.
  const isList = () => current().kind === "list";
  ctx.keymap.layer(() => ({
    mode: "modal",
    priority: 10,
    commands: [
      { bind: "escape", title: "Back / close", group: "UniiChat", run: back },
      { bind: "return", title: "Zoom in", group: "UniiChat", run: zoomIn },
      { bind: "up", title: "Previous line", group: "UniiChat", run: () => isList() ? select((current() as { selected: number }).selected - 1) : scroll?.scrollBy(-1) },
      { bind: "down", title: "Next line", group: "UniiChat", run: () => isList() ? select((current() as { selected: number }).selected + 1) : scroll?.scrollBy(1) },
      { bind: "pageup", title: "Previous page", group: "UniiChat", run: () => isList() ? pageSelect(-1) : scroll?.scrollBy(-page()) },
      { bind: "pagedown", title: "Next page", group: "UniiChat", run: () => isList() ? pageSelect(1) : scroll?.scrollBy(page()) },
      { bind: "home", title: "Top", group: "UniiChat", run: () => isList() ? select(0) : scroll?.scrollTo(0) },
      { bind: "end", title: "Bottom", group: "UniiChat", run: () => isList() ? select(Infinity) : scroll?.scrollTo(scroll.scrollHeight) },
    ],
  }));

  onMount(() => void refresh());
  onCleanup(() => {
    controller.abort();
    if (timer !== undefined) clearTimeout(timer);
  });

  const crumbs = () => ["View", ...stack().map((level) => level.title)].join(" › ");
  const hint = () => {
    const level = current();
    if (level.kind === "list") return "↑/↓ select · Enter or click zoom · Esc " + (stack().length ? "back" : "close");
    return `↑/↓ scroll${level.agent ? ` · Enter open agent ${level.agent}` : ""} · Esc back`;
  };

  return (
    <box height={outer() - 1} paddingLeft={2} paddingRight={2} paddingBottom={1} gap={1}>
      <box flexDirection="row" justifyContent="space-between" flexShrink={0}>
        <text fg={ctx.theme.text.base}><b>UniiChat</b></text>
        <text fg={ctx.theme.text.muted} onMouseUp={() => ctx.ui.dialog.clear()}>esc</text>
      </box>
      <Show when={status()} fallback={
        <Show when={!statusError()}><text flexShrink={0} fg={ctx.theme.text.muted}>Loading status…</text></Show>
      }>
        {(current) => (
          <box flexShrink={0}>
            <text fg={ctx.theme.text.base}>
              {`${current().on ? "ON" : "OFF"} · pending compactions ${current().chat?.pending ?? 0} · active ${current().chat?.inFlight ?? 0} · view ${((current().chat?.viewBytes ?? 0) / 1000).toFixed(1)} KB`}
            </text>
            <text fg={ctx.theme.text.muted}>
              {`Turn: ${usageLabel(current().lastTurn)}${current().lastTurn?.ms !== undefined ? ` · ${current().lastTurn?.ms} ms` : ""}`}
            </text>
            <text fg={ctx.theme.text.muted}>
              {`Compaction: ${usageLabel(current().chat?.last ?? null)}${current().chat?.last ? ` · ${current().chat!.last!.ms} ms` : ""}`}
            </text>
            <Show when={current().chat?.lastError}>
              {(message) => <text fg={ctx.theme.text.feedback.error.base} wrapMode="none">{`Last error: ${message().split("\n")[0]}`}</text>}
            </Show>
          </box>
        )}
      </Show>
      <Show when={statusError()}>
        {(message) => <text flexShrink={0} fg={ctx.theme.text.feedback.error.base}>{`Status error: ${message()}`}</text>}
      </Show>
      <text flexShrink={0} fg={ctx.theme.text.base}>
        {crumbs()}
        <span style={{ fg: ctx.theme.text.muted }}>{` · ${hint()}`}</span>
      </text>
      <Show when={busy() || zoomError() || (stack().length === 0 && (viewError() || loading() || lines().length === 0))}>
        <text flexShrink={0} fg={zoomError() || viewError() ? ctx.theme.text.feedback.error.base : ctx.theme.text.muted}>
          {busy() ? "Loading…"
            : zoomError() ? `Zoom error: ${zoomError()}`
            : viewError() ? `View error: ${viewError()}`
            : loading() ? "Loading view…" : "View empty."}
        </text>
      </Show>
      <scrollbox
        ref={(element: ScrollBoxRenderable) => (scroll = element)}
        flexGrow={1}
        flexShrink={1}
        minHeight={1}
        scrollX={false}
        contentOptions={{ minHeight: 0 }}
        scrollbarOptions={{ visible: false }}
      >
        <Show when={current().kind === "list" ? current() as Extract<Level, { kind: "list" }> : undefined} fallback={
          <text fg={ctx.theme.text.base}>{(current() as Extract<Level, { kind: "text" }>).text}</text>
        }>
          {(level) => (
            <For each={level().lines}>
              {(line, index) => (
                <box
                  backgroundColor={index() === level().selected ? ctx.theme.background.action.primary.focused : RGBA.fromInts(0, 0, 0, 0)}
                  onMouseDown={() => select(index())}
                  onMouseUp={() => {
                    select(index());
                    zoomIn();
                  }}
                >
                  <text fg={index() === level().selected ? ctx.theme.text.action.primary.focused : ctx.theme.text.base}>{line}</text>
                </box>
              )}
            </For>
          )}
        </Show>
      </scrollbox>
    </box>
  );
}

// Bumped after /unii on|off so the sidebar refreshes at once instead of at the next poll.
const [stateVersion, bumpState] = createSignal(0);

function SidebarIndicator(props: { ctx: Context; sessionID: string }) {
  const ctx = props.ctx;
  const [on, setOn] = createSignal<boolean>();
  const [failed, setFailed] = createSignal(false);
  const [chatError, setChatError] = createSignal(false);

  createEffect(() => {
    const sessionID = props.sessionID;
    stateVersion();
    setOn(undefined);
    setFailed(false);
    setChatError(false);
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const status = await rpcClient(ctx).status(
          { sessionID },
          { location: ctx.location, signal: controller.signal },
        );
        if (controller.signal.aborted) return;
        setOn(status.on);
        setChatError(status.chat?.lastError !== undefined);
        setFailed(false);
      } catch {
        if (!controller.signal.aborted) setFailed(true);
      }
      if (!controller.signal.aborted) timer = setTimeout(() => void poll(), POLL_INTERVAL_MS);
    };
    void poll();
    onCleanup(() => {
      controller.abort();
      if (timer !== undefined) clearTimeout(timer);
    });
  });

  const label = () => failed() ? "error" : on() === undefined ? "…" : on() ? "enabled" : "disabled";
  const color = () => failed()
    ? ctx.theme.text.feedback.error.base
    : on() ? ctx.theme.text.feedback.success.base : ctx.theme.text.muted;

  return (
    <text>
      <span style={{ fg: ctx.theme.text.muted }}>UniiChat: </span>
      <span style={{ fg: color() }}>{label()}</span>
      {chatError() && !failed()
        ? <span style={{ fg: ctx.theme.text.feedback.error.base }}>{" · compaction error (/unii)"}</span>
        : null}
    </text>
  );
}

export default Plugin.define({
  id: "uniichat",
  setup(ctx) {
    if (!ctx.ui || typeof ctx.ui.slot !== "function") return;
    const removeSidebar = ctx.ui.slot({
      append: "sidebar.content",
      render: (input) => <SidebarIndicator ctx={ctx} sessionID={input.sessionID} />,
    });
    const removeCommand = ctx.ui.slot({
      append: "app",
      render: () => {
        ctx.keymap.layer(() => ({
          mode: "global",
          commands: [{
            id: "plugin.uniichat.open",
            title: "UniiChat",
            description: "View UniiChat memory or switch it on or off",
            group: "Plugin",
            palette: true,
            slash: { name: "unii", arguments: true },
            async run(input) {
              const argument = input?.trim().toLowerCase() ?? "";
              if (argument !== "" && argument !== "on" && argument !== "off") {
                ctx.ui.toast.show({ variant: "warning", message: "Use /unii, /unii on, or /unii off." });
                return;
              }
              const route = ctx.ui.router.current();
              if (route.type !== "session") {
                if (argument === "off") {
                  ctx.ui.toast.show({ variant: "warning", message: "No session open: nothing to turn off." });
                  return;
                }
                // No session yet: start one with UniiChat already on, then open it.
                try {
                  const session = await ctx.client.session.create(ctx.location ? { location: ctx.location } : {});
                  await rpcClient(ctx).set({ sessionID: session.id, on: true }, { location: ctx.location });
                  ctx.ui.router.navigate({ type: "session", sessionID: session.id });
                  ctx.ui.toast.show({ variant: "success", message: "New session with UniiChat on" });
                } catch (cause) {
                  ctx.ui.toast.show({ variant: "error", message: errorMessage(cause) });
                }
                return;
              }
              if (!argument) {
                ctx.ui.dialog.show(() => <Popup ctx={ctx} sessionID={route.sessionID} />);
                ctx.ui.dialog.set({ size: "large", centered: true });
                return;
              }
              try {
                const result = await rpcClient(ctx).set(
                  { sessionID: route.sessionID, on: argument === "on" },
                  { location: ctx.location },
                );
                bumpState((n) => n + 1);
                ctx.ui.toast.show({
                  variant: "success",
                  message: `UniiChat ${result.on ? "on" : "off"} - takes effect at the next turn`,
                });
              } catch (cause) {
                ctx.ui.toast.show({ variant: "error", message: errorMessage(cause) });
              }
            },
          }],
        }));
        return null;
      },
    });
    return () => {
      removeSidebar();
      removeCommand();
    };
  },
});
