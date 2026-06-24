import 'dotenv/config';
import net from 'node:net';
import fs from 'node:fs';
import tls from 'node:tls';
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

const caFile = process.env.CA_CERT_FILE || process.env.NODE_EXTRA_CA_CERTS || '';

// Zusätzliche CA laden (Node-Standardzertifikate + Firmen-/Antivirus-Root-CA)
let ca;
if (caFile) {
  try {
    const extra = fs.readFileSync(caFile, 'utf8');
    ca = [...tls.rootCertificates, extra];
    console.log(`  Zusätzliches CA-Zertifikat geladen: ${caFile}`);
  } catch (err) {
    console.log(`  CA-Zertifikat konnte nicht geladen werden (${caFile}): ${err.message}`);
  }
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
