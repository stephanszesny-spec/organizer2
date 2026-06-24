import 'dotenv/config';
import { setGlobalDispatcher, ProxyAgent } from 'undici';

/**
 * Firmennetz-Unterstützung: Node/fetch nutzt System-Proxy-Einstellungen NICHT
 * automatisch. Ist in der .env ein Proxy gesetzt (HTTPS_PROXY/HTTP_PROXY),
 * leiten wir alle ausgehenden fetch-Aufrufe (JIRA, M365, Freshdesk, Claude)
 * darüber. Ohne gesetzten Proxy ändert sich nichts.
 *
 * Für TLS-Prüfung mit Firmen-Zertifikat: NODE_EXTRA_CA_CERTS auf die
 * Zertifikatsdatei setzen (siehe README / .env.example) – das wertet Node
 * selbst aus, dafür ist hier kein Code nötig.
 */
const proxy =
  process.env.HTTPS_PROXY ||
  process.env.https_proxy ||
  process.env.HTTP_PROXY ||
  process.env.http_proxy;

if (proxy) {
  setGlobalDispatcher(new ProxyAgent(proxy));
  console.log(`  Proxy aktiv: ${proxy}`);
}
