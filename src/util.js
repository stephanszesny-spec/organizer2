/**
 * Formatiert einen Fehler inkl. err.cause (Netzwerk-/TLS-/Proxy-Grund),
 * damit Verbindungstests konkrete Meldungen ausgeben können.
 */
export function describeError(err) {
  if (!err) return 'Unbekannter Fehler';
  const cause = err.cause
    ? ` (Ursache: ${err.cause.code || ''} ${err.cause.message || err.cause})`.replace(/\s+/g, ' ').trimEnd()
    : '';
  return `${err.message || err}${cause}`;
}

/**
 * Liest eine fetch-Response als JSON. Ist die Antwort kein JSON (z.B. eine
 * HTML-Proxy-/Login-/Fehlerseite), wird ein klarer Fehler geworfen statt eines
 * kryptischen "Unexpected token '<'".
 */
export async function parseJsonResponse(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    const ct = res.headers.get('content-type') || 'unbekannt';
    const snippet = text.replace(/\s+/g, ' ').trim().slice(0, 160);
    throw new Error(
      `Antwort ist kein JSON (HTTP ${res.status}, Content-Type: ${ct}) – ` +
        `wahrscheinlich eine Proxy-/Login-/Fehlerseite statt der API. Auszug: ${snippet}`,
    );
  }
}

