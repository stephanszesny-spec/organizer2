import 'dotenv/config';
import net from 'node:net';
import fs from 'node:fs';
import tls from 'node:tls';
import crypto from 'node:crypto';
import { setGlobalDispatcher, Agent, ProxyAgent } from 'undici';

/**
 * Netzwerk-Setup für ausgehende fetch-Aufrufe (JIRA, M365, Freshdesk, Claude).
 *
 * 1) Proxy (Firmennetz): Ist HTTPS_PROXY/HTTP_PROXY gesetzt, wird beim Start
 *    geprüft, ob der Proxy erreichbar ist. Erreichbar -> nutzen; nicht
 *    erreichbar (z.B. außerhalb des Firmennetzes) -> direkte Verbindung.
 *
 * 2) Zusätzliche CA: Wird HTTPS auf dem Rechner aufgebrochen (Antivirus/Endpoint-
 *    Schutz, Firmen-Proxy mit TLS-Inspektion), kennt Node die Prüf-CA nicht
 *    (Fehler UNABLE_TO_GET_ISSUER_CERT_LOCALLY). Dann die Root-CA als PEM-Datei
 *    exportieren und in der .env CA_CERT_FILE (oder NODE_EXTRA_CA_CERTS) auf den
 *    Pfad setzen – sie wird hier zur Vertrauensliste hinzugefügt.
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

// Zusätzliche CA(s) laden. undici akzeptiert nur PEM – daher DER-Dateien (so
// exportiert Windows die .crt meist) hier automatisch nach PEM konvertieren.
// PEM-Bundles (mehrere Zertifikate) bleiben unverändert. Mehrere Pfade per ";"/"," möglich.
let ca;
if (caFiles.length) {
  const extra = [];
  for (const f of caFiles) {
    try {
      const raw = fs.readFileSync(f);
      const looksPem = raw.toString('latin1').includes('-----BEGIN CERTIFICATE-----');
      const pem = looksPem ? raw.toString('utf8') : new crypto.X509Certificate(raw).toString();
      extra.push(pem);
      console.log(`  Zusätzliches CA-Zertifikat geladen: ${f}${looksPem ? '' : ' (DER → PEM konvertiert)'}`);
    } catch (err) {
      console.log(`  CA-Zertifikat konnte nicht geladen werden (${f}): ${err.message}`);
    }
  }
  if (extra.length) ca = [...tls.rootCertificates, ...extra];
}
const requestTls = ca ? { ca } : undefined;

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
  if (ca) dispatcher = new Agent({ connect: { ca } });
}
if (dispatcher) setGlobalDispatcher(dispatcher);
