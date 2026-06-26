import 'dotenv/config';
import net from 'node:net';
import fs from 'node:fs';
import tls from 'node:tls';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { setGlobalDispatcher, Agent, ProxyAgent } from 'undici';

/**
 * Netzwerk-Setup für ausgehende fetch-Aufrufe (JIRA, M365, Freshdesk, Claude).
 *
 * 1) Vertrauensanker: Node-Standard (Mozilla) + der BETRIEBSSYSTEM-Speicher.
 *    Damit vertraut die App genau dem, was Browser/Outlook auch nutzen – inkl.
 *    firmeneigener bzw. von Antivirus/Zscaler installierter Root-/Zwischen-CAs.
 *    Optional zusätzlich CA_CERT_FILE (PEM oder DER; mehrere per ";"/",").
 *
 * 2) Proxy (Firmennetz): Ist HTTPS_PROXY/HTTP_PROXY gesetzt, wird beim Start
 *    geprüft, ob der Proxy erreichbar ist. Erreichbar -> nutzen; nicht
 *    erreichbar (z.B. außerhalb des Firmennetzes) -> direkte Verbindung.
 */
const proxyUrl =
  process.env.HTTPS_PROXY ||
  process.env.https_proxy ||
  process.env.HTTP_PROXY ||
  process.env.http_proxy;

const caFiles = (process.env.CA_CERT_FILE || process.env.NODE_EXTRA_CA_CERTS || '')
  .split(/[;,]/)
  .map((s) => s.trim())
  .filter(Boolean);

// --- Vertrauensanker aufbauen ---
const ca = [...tls.rootCertificates];

// Betriebssystem-Zertifikatspeicher einbinden (Node >= 22.15). Liefert auf
// Windows allerdings nur einen Teil (i.d.R. LocalMachine\Root).
try {
  if (typeof tls.getCACertificates === 'function') {
    const sys = tls.getCACertificates('system') || [];
    if (sys.length) {
      ca.push(...sys);
      console.log(`  System-Zertifikatspeicher eingebunden: ${sys.length} Zertifikate`);
    }
  }
} catch (err) {
  console.log(`  System-Zertifikatspeicher nicht verfügbar: ${err.message}`);
}

// Windows: ALLE relevanten Speicher per PowerShell auslesen (Root + Zwischen-CAs,
// LocalMachine + CurrentUser) – genau das, was Browser/Outlook vertrauen. Damit
// werden auch Zscaler-/Antivirus-CAs erfasst, die Node oben nicht liefert.
if (process.platform === 'win32') {
  try {
    const cmd =
      "$ErrorActionPreference='SilentlyContinue';" +
      "$s='Cert:\\LocalMachine\\Root','Cert:\\LocalMachine\\CA','Cert:\\LocalMachine\\AuthRoot'," +
      "'Cert:\\CurrentUser\\Root','Cert:\\CurrentUser\\CA';" +
      "Get-ChildItem $s | ForEach-Object { '-----BEGIN CERTIFICATE-----';" +
      "[Convert]::ToBase64String($_.RawData,'InsertLineBreaks');'-----END CERTIFICATE-----' }";
    const out = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', cmd], {
      encoding: 'utf8',
      timeout: 20000,
      maxBuffer: 64 * 1024 * 1024,
      windowsHide: true,
    });
    const winCerts = out.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) || [];
    if (winCerts.length) {
      ca.push(...winCerts);
      console.log(`  Windows-Zertifikatspeicher (alle Stores) eingebunden: ${winCerts.length} Zertifikate`);
    }
  } catch (err) {
    console.log(`  Windows-Zertifikatspeicher konnte nicht gelesen werden: ${err.message}`);
  }
}

// Optionale CA-Dateien. undici akzeptiert nur PEM -> DER automatisch konvertieren.
for (const f of caFiles) {
  try {
    const raw = fs.readFileSync(f);
    const looksPem = raw.toString('latin1').includes('-----BEGIN CERTIFICATE-----');
    const pem = looksPem ? raw.toString('utf8') : new crypto.X509Certificate(raw).toString();
    ca.push(pem);
    console.log(`  Zusätzliches CA-Zertifikat geladen: ${f}${looksPem ? '' : ' (DER → PEM konvertiert)'}`);
  } catch (err) {
    console.log(`  CA-Zertifikat konnte nicht geladen werden (${f}): ${err.message}`);
  }
}

const requestTls = { ca };

/** Prüft per TCP-Verbindung, ob host:port des Proxys erreichbar ist. */
function proxyReachable(urlStr, timeoutMs = 2000) {
  return new Promise((resolve) => {
    let u;
    try {
      u = new URL(urlStr);
    } catch {
      return resolve(false);
    }
    const port = u.port ? Number(u.port) : u.protocol === 'https:' ? 443 : 80;
    const socket = net.connect({ host: u.hostname, port });
    const finish = (ok) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

let dispatcher;
if (proxyUrl && (await proxyReachable(proxyUrl))) {
  dispatcher = new ProxyAgent({ uri: proxyUrl, requestTls });
  console.log(`  Proxy aktiv: ${proxyUrl}`);
} else {
  if (proxyUrl) {
    console.log(`  Proxy ${proxyUrl} nicht erreichbar – direkte Verbindung (z.B. außerhalb des Firmennetzes).`);
  }
  dispatcher = new Agent({ connect: { ca } });
}
setGlobalDispatcher(dispatcher);
