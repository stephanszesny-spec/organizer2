import 'dotenv/config';
import net from 'node:net';
import { setGlobalDispatcher, ProxyAgent } from 'undici';

/**
 * Firmennetz-Unterstützung mit automatischer Erkennung.
 *
 * Node/fetch nutzt System-Proxy-Einstellungen nicht automatisch. Ist in der .env
 * ein Proxy gesetzt (HTTPS_PROXY/HTTP_PROXY), prüfen wir beim Start einmalig, ob
 * dieser Proxy ERREICHBAR ist:
 *  - erreichbar (z.B. im Firmennetz)  -> alle ausgehenden fetch-Aufrufe gehen darüber
 *  - nicht erreichbar (z.B. zu Hause) -> direkte Verbindung, der Proxy wird ignoriert
 *
 * So kann HTTPS_PROXY dauerhaft gesetzt bleiben und funktioniert an beiden Orten.
 *
 * Für TLS-Prüfung mit Firmen-Zertifikat: NODE_EXTRA_CA_CERTS auf die
 * Zertifikatsdatei setzen (siehe README / .env.example).
 */
const proxyUrl =
  process.env.HTTPS_PROXY ||
  process.env.https_proxy ||
  process.env.HTTP_PROXY ||
  process.env.http_proxy;

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

if (proxyUrl) {
  if (await proxyReachable(proxyUrl)) {
    setGlobalDispatcher(new ProxyAgent(proxyUrl));
    console.log(`  Proxy aktiv: ${proxyUrl}`);
  } else {
    console.log(`  Proxy ${proxyUrl} nicht erreichbar – direkte Verbindung (z.B. außerhalb des Firmennetzes).`);
  }
}
