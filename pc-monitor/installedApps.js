// installedApps.js — lists installed Windows applications by reading the
// Uninstall registry keys (HKLM + WOW6432Node + HKCU) via PowerShell.
// Returns [{ name, version, publisher, date, size }].
const { execFile } = require("child_process");

const PS_SCRIPT = [
  "$ErrorActionPreference='SilentlyContinue';",
  "$paths=@(",
  "'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',",
  "'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',",
  "'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*');",
  "$apps = foreach($p in $paths){ Get-ItemProperty $p | Where-Object { $_.DisplayName } | ForEach-Object {",
  "  [pscustomobject]@{",
  "    Name=[string]$_.DisplayName;",
  "    Version=[string]$_.DisplayVersion;",
  "    Publisher=[string]$_.Publisher;",
  "    InstallDate=[string]$_.InstallDate;",
  "    SizeBytes=[int64]([double]$_.EstimatedSize * 1024)",
  "  }",
  "} };",
  'ConvertTo-Json -InputObject $apps -Compress -Depth 2',
].join("\n");

function runListApps() {
  return new Promise((resolve, reject) => {
    // -EncodedCommand avoids all quoting issues with $ and quotes on Windows.
    const encoded = Buffer.from(PS_SCRIPT, "utf16le").toString("base64");
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded],
      { windowsHide: true, timeout: 60000, maxBuffer: 32 * 1024 * 1024 },
      (err, stdout) => {
        if (err) return resolve([]); // best-effort: empty list on failure
        try {
          let arr = JSON.parse(stdout.trim());
          if (!Array.isArray(arr)) arr = arr ? [arr] : [];
          resolve(arr);
        } catch {
          resolve([]);
        }
      }
    );
  });
}

const fmtDate = (d) => {
  if (!d) return "";
  const s = String(d);
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  return s;
};

async function getInstalledApps() {
  const raw = await runListApps();
  const seen = new Set();
  const list = [];
  for (const a of raw) {
    if (!a || !a.Name) continue;
    const key = a.Name.toLowerCase();
    if (seen.has(key)) continue; // dedupe x86/x64 twin entries
    seen.add(key);
    list.push({
      name: a.Name,
      version: a.Version || "",
      publisher: a.Publisher || "",
      date: fmtDate(a.InstallDate),
      size: Number(a.SizeBytes) || 0,
    });
  }
  list.sort((x, y) => x.name.localeCompare(y.name));
  return list;
}

module.exports = { getInstalledApps };