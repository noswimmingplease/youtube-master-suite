import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { chromium, firefox } from "playwright";

const INSTALLED_BROWSERS = {
  chrome: { folders: ["Google", "Chrome", "Application"], executable: "chrome.exe", product: "Google Chrome", engine: "chromium" },
  edge: { folders: ["Microsoft", "Edge", "Application"], executable: "msedge.exe", product: "Microsoft Edge", engine: "chromium" },
  "installed-firefox": { folders: ["Mozilla Firefox"], executable: "firefox.exe", product: "Firefox", engine: "gecko" },
  zen: { folders: ["Zen Browser"], executable: "zen.exe", product: "Zen", engine: "gecko" },
};

function windowsPowerShell() {
  const systemRoot = process.env.SystemRoot;
  if (process.platform !== "win32" || !systemRoot || !path.isAbsolute(systemRoot)) {
    throw new Error("Windows SystemRoot is unavailable");
  }
  return path.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
}

function assertNoReparseAncestors(directory) {
  const validation = spawnSync(windowsPowerShell(), ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", `
    $ErrorActionPreference = 'Stop'
    $cursor = [Environment]::GetEnvironmentVariable('YT_SUITE_TEST_VALIDATION_DIRECTORY')
    while ($null -ne $cursor) {
      $attributes = [IO.File]::GetAttributes($cursor)
      if (($attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Reparse point rejected' }
      if (($attributes -band [IO.FileAttributes]::Directory) -eq 0) { throw 'Directory required' }
      $parent = [IO.Directory]::GetParent($cursor)
      $cursor = if ($null -eq $parent) { $null } else { $parent.FullName }
    }
    Write-Output 'validated'
  `], {
    env: { ...process.env, YT_SUITE_TEST_VALIDATION_DIRECTORY: directory },
    encoding: "utf8", timeout: 10000, windowsHide: true,
  });
  if (validation.error || validation.status !== 0 || validation.stdout.trim() !== "validated") {
    throw new Error("Fixture test directories must exist without reparse-point ancestors");
  }
}

function ownedTestDirectories(name) {
  const requestedRoot = process.env.YT_SUITE_TEST_ROOT;
  if (requestedRoot === undefined) return null;
  if (!requestedRoot || !path.isAbsolute(requestedRoot) || process.platform !== "win32") {
    throw new Error("YT_SUITE_TEST_ROOT must name an existing absolute Windows directory");
  }
  const root = path.normalize(requestedRoot);
  const resolved = path.resolve(root);
  if (resolved.toLowerCase() !== root.toLowerCase() ||
      !/^[a-z]:\\$/i.test(path.parse(resolved).root) ||
      path.basename(resolved).toLowerCase() !== name ||
      !existsSync(resolved) || !statSync(resolved).isDirectory()) {
    throw new Error("YT_SUITE_TEST_ROOT must be an existing, fully qualified, per-browser test subtree");
  }
  assertNoReparseAncestors(resolved);
  const id = randomUUID();
  const profile = path.join(resolved, `profile-${id}`);
  const artifacts = path.join(resolved, `artifacts-${id}`);
  // Never reuse or copy an existing profile. Explicit directories deliberately
  // remain for the invoking owner to audit processes and delete after the run.
  mkdirSync(profile);
  mkdirSync(artifacts);
  assertNoReparseAncestors(profile);
  assertNoReparseAncestors(artifacts);
  return { profile, artifacts };
}

async function launch(browserType, options, name) {
  const owned = ownedTestDirectories(name);
  if (!owned) return browserType.launch(options);
  const context = await browserType.launchPersistentContext(owned.profile, {
    ...options, artifactsDir: owned.artifacts, acceptDownloads: false,
  });
  const browser = context.browser();
  if (!browser) {
    await context.close();
    throw new Error("The explicit fixture profile did not expose its owned browser");
  }
  // The persistent default context is not used by fixtures. Keep its blank page
  // isolated too; each test still creates and intercepts its own fresh context.
  try {
    await context.route("**/*", route => route.abort());
    return browser;
  } catch (error) {
    try { await browser.close(); }
    catch (cleanupError) { throw new AggregateError([error, cleanupError], "Fixture launch and cleanup failed"); }
    throw error;
  }
}

function installedExecutable(name, definition) {
  if (process.platform !== "win32") throw new Error("Installed-browser fixture checks currently require Windows");
  const roots = [process.env.ProgramFiles, process.env["ProgramFiles(x86)"], process.env.LOCALAPPDATA]
    .filter(root => root && path.isAbsolute(root));
  const candidates = new Map();
  for (const root of roots) {
    const candidate = path.join(root, ...definition.folders, definition.executable);
    if (!existsSync(candidate) || !statSync(candidate).isFile()) continue;
    const resolved = realpathSync(candidate);
    candidates.set(resolved.toLowerCase(), resolved);
  }
  if (candidates.size !== 1) {
    throw new Error(`Expected exactly one installed ${name} executable; found ${candidates.size}`);
  }
  const executablePath = candidates.values().next().value;
  const identity = spawnSync(windowsPowerShell(), ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", `
    $ErrorActionPreference = 'Stop'
    $executable = [Environment]::GetEnvironmentVariable('YT_SUITE_TEST_IDENTITY_EXECUTABLE')
    $info = [Diagnostics.FileVersionInfo]::GetVersionInfo($executable)
    [pscustomobject]@{productName = $info.ProductName; originalFilename = $info.OriginalFilename} | ConvertTo-Json -Compress
  `], {
    env: { ...process.env, YT_SUITE_TEST_IDENTITY_EXECUTABLE: executablePath },
    encoding: "utf8", timeout: 10000, windowsHide: true,
  });
  if (identity.error || identity.status !== 0) throw new Error(`Could not verify the installed ${name} executable identity`);
  let metadata;
  try { metadata = JSON.parse(identity.stdout.replace(/^\uFEFF/, "").trim()); }
  catch { throw new Error(`The installed ${name} executable identity was unreadable`); }
  if (metadata.productName !== definition.product ||
      metadata.originalFilename?.toLowerCase() !== definition.executable) {
    throw new Error(`The installed ${name} executable has unexpected product metadata`);
  }
  return executablePath;
}

/**
 * Default CI behaviour remains Playwright's patched Firefox. Opt-in installed
 * browsers always get fresh disposable profiles, never an existing user-data
 * directory, browser connection, extension or personal profile. An explicit test
 * root keeps profile/artifact deletion under the invoking owner's control.
 * Existing tests retain their per-context fixture-only network interception.
 */
export async function launchFixtureBrowser() {
  const name = process.env.YT_SUITE_TEST_BROWSER || "firefox";
  if (name === "firefox") return launch(firefox, { headless: true }, name);
  const definition = INSTALLED_BROWSERS[name];
  if (!Object.hasOwn(INSTALLED_BROWSERS, name)) throw new Error(`Unsupported fixture browser: ${name}`);
  const executablePath = installedExecutable(name, definition);
  if (definition.engine === "chromium") {
    return launch(chromium, { executablePath, headless: true }, name);
  }
  // The pinned Playwright 1.64 dispatches moz-* channels to native WebDriver
  // BiDi. Ordinary installed Firefox/Zen do not provide its patched Juggler API.
  // Test-only isolation prevents browser remoting to an existing user session.
  return launch(firefox, {
    channel: "moz-firefox", executablePath, headless: true,
    args: ["-no-remote", "-new-instance"],
    firefoxUserPrefs: { "browser.shell.checkDefaultBrowser": false, "zen.welcome-screen.seen": true },
  }, name);
}

function fixtureDiagnosticText(value, limit = 4000) {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/(?:file:\/\/\/)?[a-z]:[\\/][^\r\n"'<>]*/gi, "<local-path>")
    .slice(0, limit);
}

/** Preserve the health assertions and deadlines; add bounded fixture-only evidence on failure. */
export async function waitForSuiteHealth(page, moduleCount, {
  timeoutMs, requireReady = false, errors = [],
} = {}) {
  try {
    await page.waitForFunction(({ count, ready }) => {
      const health = JSON.parse(document.documentElement.getAttribute("data-yt-master-suite") || "null");
      return health?.healthy && (!ready || health.ready) && health.initialisedModules.length === count;
    }, { count: moduleCount, ready: requireReady }, { timeout: timeoutMs });
  } catch (error) {
    let diagnostic;
    try {
      diagnostic = await page.evaluate(() => ({
        health: document.documentElement?.getAttribute("data-yt-master-suite"),
        runtimeErrors: document.documentElement?.getAttribute("data-yt-master-runtime-errors"),
        fixture: {
          readyState: document.readyState,
          app: Boolean(document.querySelector("ytd-app")),
          masthead: Boolean(document.querySelector("ytd-masthead")),
          player: Boolean(document.getElementById("movie_player")),
          video: Boolean(document.querySelector("video")),
          comments: Boolean(document.querySelector("ytd-comments")),
          fixtureApi: typeof window.fixture === "object" && window.fixture !== null,
        },
      }));
      diagnostic.health = fixtureDiagnosticText(diagnostic.health);
      diagnostic.runtimeErrors = fixtureDiagnosticText(diagnostic.runtimeErrors);
    } catch {
      diagnostic = { unavailable: "Fixture page closed or unavailable" };
    }
    diagnostic.pageErrors = errors.slice(0, 10).map(message => fixtureDiagnosticText(message, 1000));
    throw new Error(`${error.message}\nSuite fixture health diagnostic: ${JSON.stringify(diagnostic)}`, { cause: error });
  }
}
