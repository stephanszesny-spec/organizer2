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
