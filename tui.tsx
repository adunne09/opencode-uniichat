/** @jsxImportSource @opentui/solid */
import type { Context } from "@opencode/plugin/tui/context";
import { Plugin } from "@opencode/plugin/tui";
import type { ScrollBoxRenderable } from "@opentui/core";
import { useKeyboard, useTerminalDimensions } from "@opentui/solid";
import { createEffect, createSignal, For, onCleanup, onMount, Show } from "solid-js";
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

function Popup(props: { ctx: Context; sessionID: string }) {
  const ctx = props.ctx;
  const rpc = rpcClient(ctx);
  const controller = new AbortController();
  const options = { location: ctx.location, signal: controller.signal };
  const dimensions = useTerminalDimensions();
  const height = () => Math.max(4, Math.floor(dimensions().height * 0.5));
  const [tab, setTab] = createSignal<"view" | "archive">("view");
  const [status, setStatus] = createSignal<Status>();
  const [lines, setLines] = createSignal<string[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [statusError, setStatusError] = createSignal<string>();
  const [viewError, setViewError] = createSignal<string>();
  const [query, setQuery] = createSignal("");
  const [archive, setArchive] = createSignal("Enter an id+n, id n, or agent Name above.");
  const [archiveBusy, setArchiveBusy] = createSignal(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let scroll: ScrollBoxRenderable | undefined;

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

  const zoom = async () => {
    const value = query().trim();
    if (!value || archiveBusy()) return;
    const match = /^(\d+)(?:\s*\+\s*|\s+)(\d+)$/.exec(value);
    const input = match
      ? { sessionID: props.sessionID, id: Number(match[1]), n: Number(match[2]) }
      : /^\d+$/.test(value)
        ? { sessionID: props.sessionID, id: Number(value), n: 1 }
        : { sessionID: props.sessionID, name: value };
    setArchiveBusy(true);
    try {
      const result = await rpc.archive(input, options);
      if (controller.signal.aborted) return;
      setArchive(result || "No archive text.");
      scroll?.scrollTo(0);
    } catch (cause) {
      if (!controller.signal.aborted) setArchive(`Error: ${errorMessage(cause)}`);
    } finally {
      if (!controller.signal.aborted) setArchiveBusy(false);
    }
  };

  useKeyboard((event) => {
    if (event.name === "escape") {
      event.preventDefault();
      event.stopPropagation();
      ctx.ui.dialog.clear();
      return;
    }
    if (event.name === "tab") {
      event.preventDefault();
      event.stopPropagation();
      setTab((current) => current === "view" ? "archive" : "view");
      scroll?.scrollTo(0);
      return;
    }
    const delta = event.name === "up" ? -1
      : event.name === "down" ? 1
        : event.name === "pageup" ? -height()
          : event.name === "pagedown" ? height() : undefined;
    if (delta !== undefined) {
      event.preventDefault();
      event.stopPropagation();
      scroll?.scrollBy(delta);
    }
    if (tab() === "view" && (event.name === "home" || event.name === "end")) {
      event.preventDefault();
      event.stopPropagation();
      scroll?.scrollTo(event.name === "home" ? 0 : scroll.scrollHeight);
    }
  });

  onMount(() => void refresh());
  onCleanup(() => {
    controller.abort();
    if (timer !== undefined) clearTimeout(timer);
  });

  return (
    <box paddingLeft={2} paddingRight={2} paddingBottom={1} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={ctx.theme.text.base}><b>UniiChat</b></text>
        <text fg={ctx.theme.text.muted} onMouseUp={() => ctx.ui.dialog.clear()}>esc</text>
      </box>
      <Show when={status()} fallback={
        <Show when={!statusError()}><text fg={ctx.theme.text.muted}>Loading status…</text></Show>
      }>
        {(current) => (
          <box>
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
              {(message) => <text fg={ctx.theme.text.feedback.error.base}>{`Last error: ${message()}`}</text>}
            </Show>
          </box>
        )}
      </Show>
      <Show when={statusError()}>
        {(message) => <text fg={ctx.theme.text.feedback.error.base}>{`Status error: ${message()}`}</text>}
      </Show>
      <text fg={ctx.theme.text.base}>
        {tab() === "view" ? "[View]  Archive" : "View  [Archive]"}
        <span style={{ fg: ctx.theme.text.muted }}> · Tab switch · ↑/↓ or PgUp/PgDn scroll</span>
      </text>
      <Show when={tab() === "archive"}>
        <input
          value={query()}
          placeholder="id+n, id n, or Name; Enter to zoom"
          focused
          onInput={setQuery}
          onSubmit={() => void zoom()}
          textColor={ctx.theme.text.base}
          backgroundColor={ctx.theme.background.base}
          focusedTextColor={ctx.theme.text.base}
          focusedBackgroundColor={ctx.theme.background.base}
        />
      </Show>
      <scrollbox
        ref={(element: ScrollBoxRenderable) => (scroll = element)}
        height={height()}
        scrollX={false}
        contentOptions={{ minHeight: 0 }}
        scrollbarOptions={{ visible: false }}
      >
        <Show when={tab() === "view"} fallback={
          <text fg={ctx.theme.text.base}>{archiveBusy() ? "Loading archive…" : archive()}</text>
        }>
          <Show when={viewError()}>
            {(message) => <text fg={ctx.theme.text.feedback.error.base}>{`View error: ${message()}`}</text>}
          </Show>
          <Show when={!loading()} fallback={<text fg={ctx.theme.text.muted}>Loading view…</text>}>
            <Show when={lines().length > 0} fallback={
              <Show when={!viewError()}><text fg={ctx.theme.text.muted}>View empty.</text></Show>
            }>
              <For each={lines()}>{(line) => <text fg={ctx.theme.text.base}>{line}</text>}</For>
            </Show>
          </Show>
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

  createEffect(() => {
    const sessionID = props.sessionID;
    stateVersion();
    setOn(undefined);
    setFailed(false);
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
                ctx.ui.dialog.set({ size: "large" });
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
