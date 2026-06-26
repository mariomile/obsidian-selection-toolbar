import { spawn } from "child_process";
import { tmpdir, homedir } from "os";
import { existsSync, readdirSync } from "fs";
import { dirname } from "path";

/** A resolved CLI invocation: the binary plus an enriched PATH for the spawn. */
export interface ResolvedCli {
  bin: string;
  pathEnv: string;
}

export interface CliStreamParams {
  cli: ResolvedCli;
  /** Model alias/id, or "default"/"" to use Claude Code's configured model. */
  model: string;
  system: string;
  user: string;
  signal: AbortSignal;
  onDelta: (text: string) => void;
}

/**
 * Stream a completion from the local Claude Code CLI, using the user's logged-in
 * subscription (no API key, no metered API billing).
 *
 * Spawns `claude -p` in headless streaming mode and parses its JSONL output.
 * Each line is a wrapper `{type:"stream_event", event:{...}}` carrying a raw
 * Anthropic stream event; text deltas are `content_block_delta` / `text_delta`.
 * Thinking deltas and hook/system events are ignored.
 *
 * Runs lean: neutral cwd (no project CLAUDE.md), `--strict-mcp-config` (no MCP),
 * and `--system-prompt` to replace the default Claude Code persona.
 */
export function streamCompletion(p: CliStreamParams): Promise<void> {
  const args = [
    "-p",
    "--output-format", "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--strict-mcp-config",
    // Load only `project` settings (none, since cwd is a temp dir) so the user's
    // global hooks don't fire on every edit — much leaner + faster. Auth is not
    // a "setting source", so the subscription login still resolves. (`--bare`
    // would also skip hooks but breaks auth by skipping keychain reads.)
    "--setting-sources", "project",
    // SECURITY (defense in depth): this is a text transform — Claude must never
    // execute anything. Deny every standard tool so even a prompt-injection in
    // the selected text cannot run a command, read, or write files. Unknown
    // names just log a harmless stderr warning (ignored on success).
    "--disallowedTools",
    "Bash,BashOutput,KillShell,Edit,MultiEdit,Write,NotebookEdit,Read,Glob,Grep,LS,WebFetch,WebSearch,Task,TodoWrite,SlashCommand",
    "--system-prompt", p.system,
  ];
  if (p.model && p.model !== "default") args.push("--model", p.model);

  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      p.signal.removeEventListener("abort", onAbort);
      fn();
    };

    const child = spawn(p.cli.bin, args, {
      cwd: tmpdir(),
      env: { ...process.env, PATH: p.cli.pathEnv },
    });

    const onAbort = () => {
      try {
        child.kill("SIGTERM");
      } catch {
        /* ignore */
      }
    };
    if (p.signal.aborted) onAbort();
    p.signal.addEventListener("abort", onAbort);

    let buf = "";
    let resultError: string | null = null;
    let resultText = "";
    let streamed = false;
    let stderr = "";

    child.on("error", (err) => finish(() => reject(err))); // e.g. ENOENT

    child.stdout.on("data", (chunk: Buffer | string) => {
      buf += chunk.toString();
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let obj: {
          type?: string;
          event?: { type?: string; delta?: { type?: string; text?: string } };
          is_error?: boolean;
          result?: string;
          subtype?: string;
        };
        try {
          obj = JSON.parse(line);
        } catch {
          continue;
        }
        if (obj.type === "stream_event") {
          const ev = obj.event;
          if (ev?.type === "content_block_delta" && ev.delta?.type === "text_delta" && ev.delta.text) {
            streamed = true;
            p.onDelta(ev.delta.text);
          }
        } else if (obj.type === "result") {
          if (obj.is_error) resultError = obj.result || obj.subtype || "Claude CLI returned an error.";
          else if (typeof obj.result === "string") resultText = obj.result;
        }
      }
    });

    child.stderr.on("data", (d: Buffer | string) => {
      stderr += d.toString();
    });

    child.on("close", (code) =>
      finish(() => {
        if (p.signal.aborted) {
          reject(makeAbortError());
        } else if (resultError) {
          reject(new Error(resultError));
        } else if (code !== 0) {
          reject(new Error(stderr.trim() || `claude exited with code ${code ?? "null"}`));
        } else {
          // Fallback: some short replies arrive only in the final `result`,
          // not as streamed text_delta — emit it so the panel never shows blank.
          if (!streamed && resultText) p.onDelta(resultText);
          resolve();
        }
      })
    );

    child.stdin.on("error", () => {
      /* broken pipe if the process died early — handled via close/error */
    });
    child.stdin.write(p.user);
    child.stdin.end();
  });
}

/* --------------------------- CLI resolution --------------------------- */

/**
 * Resolve the `claude` binary + a usable PATH. GUI apps (Obsidian) don't inherit
 * the shell PATH, and tools like nvm only export PATH from `.zshrc` (interactive
 * shells). So we (1) honor an explicit setting, (2) probe the filesystem directly
 * — no shell needed, most reliable — then (3) fall back to an *interactive* login
 * shell lookup, and finally (4) plain "claude".
 */
export async function resolveCli(configured: string): Promise<ResolvedCli> {
  const bin =
    (configured && configured.trim()) ||
    probeFilesystem() ||
    (await probeLoginShell()) ||
    "claude";
  return { bin, pathEnv: buildPathEnv(bin) };
}

function probeFilesystem(): string | null {
  const home = homedir();
  const fixed = [
    `${home}/.claude/local/claude`,
    `${home}/.local/bin/claude`,
    `${home}/.local/node/bin/claude`,
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude",
  ];
  for (const c of fixed) {
    if (safeExists(c)) return c;
  }
  // nvm: newest version dir that ships a `claude`.
  try {
    const nvmRoot = `${home}/.nvm/versions/node`;
    const versions = readdirSync(nvmRoot).sort().reverse();
    for (const v of versions) {
      const p = `${nvmRoot}/${v}/bin/claude`;
      if (safeExists(p)) return p;
    }
  } catch {
    /* no nvm */
  }
  return null;
}

function probeLoginShell(): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const shell = process.env.SHELL || "/bin/zsh";
      // `-i` so the shell sources .zshrc (where nvm/path setup usually lives).
      const c = spawn(shell, ["-ilc", "command -v claude"], { env: process.env });
      let out = "";
      const done = (val: string | null) => resolve(val);
      c.stdout.on("data", (d: Buffer | string) => (out += d.toString()));
      c.on("error", () => done(null));
      c.on("close", () => {
        const lines = out.split("\n").map((s) => s.trim()).filter(Boolean);
        for (const l of lines.reverse()) {
          if (l.startsWith("/") && safeExists(l)) return done(l);
        }
        done(null);
      });
      // Safety: interactive rc files can stall — give up after 6s.
      setTimeout(() => {
        try {
          c.kill("SIGKILL");
        } catch {
          /* ignore */
        }
        done(null);
      }, 6000);
    } catch {
      resolve(null);
    }
  });
}

function buildPathEnv(bin: string): string {
  const home = homedir();
  const dirs = [
    bin.includes("/") ? dirname(bin) : "",
    `${home}/.local/bin`,
    `${home}/.local/node/bin`,
    "/opt/homebrew/bin",
    "/usr/local/bin",
    process.env.PATH || "",
  ];
  return dirs.filter(Boolean).join(":");
}

function safeExists(p: string): boolean {
  try {
    return existsSync(p);
  } catch {
    return false;
  }
}

/* ------------------------------ errors -------------------------------- */

function makeAbortError(): Error {
  const e = new Error("Aborted");
  e.name = "AbortError";
  return e;
}

/** True when the error is our own abort (cancel / restart). */
export function isAbort(e: unknown): boolean {
  return e instanceof Error && e.name === "AbortError";
}

/** Run a tiny call to verify the CLI is found, logged in, and responding. */
export async function testConnection(cli: ResolvedCli, model: string): Promise<{ ok: boolean; message: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  let out = "";
  try {
    await streamCompletion({
      cli,
      model: model || "default",
      system: "You are a connectivity check. Reply with exactly: ok",
      user: "ping",
      signal: ctrl.signal,
      onDelta: (d) => (out += d),
    });
    clearTimeout(timer);
    return { ok: true, message: `Connected — ${cli.bin}` };
  } catch (e) {
    clearTimeout(timer);
    if (isAbort(e)) return { ok: false, message: "Timed out after 30s." };
    return { ok: false, message: describeError(e) };
  }
}

/** Map a spawn/CLI error to a short, user-facing message. */
export function describeError(e: unknown): string {
  if (e && typeof e === "object" && "code" in e && (e as { code?: string }).code === "ENOENT") {
    return "Claude CLI not found. Run `which claude` in a terminal and paste the path in Selection Toolbar settings.";
  }
  if (e instanceof Error) {
    const msg = e.message || "";
    if (/not logged in|unauthorized|authentication/i.test(msg)) {
      return "Claude Code is not logged in — run `claude` once in a terminal to sign in.";
    }
    return msg || "Claude CLI error.";
  }
  return "Unknown error.";
}
