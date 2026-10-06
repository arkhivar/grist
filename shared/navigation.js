// Personal recent-student navigation between companion widgets in one document.
// The document identifier and embedding origin keep unrelated Grist views apart.
function studentNavigationGroup(value) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 100) : 'students';
}

function studentNavigationVisit(value) {
  if (!value || typeof value !== 'object') return null;
  if (typeof value.tableId === 'string' && value.tableId && Array.isArray(value.ids)) {
    const ids = [...new Set(value.ids.map(Number))];
    if (ids.length !== 1 || !Number.isSafeInteger(ids[0]) || ids[0] <= 0) return null;
    return { tableId: value.tableId, ids };
  }
  if (typeof value.text === 'string' && value.text.trim()) return { text: value.text };
  return null;
}

function studentNavigationEmbeddingOrigin() {
  try {
    if (document.referrer) return new URL(document.referrer).origin;
  } catch (_) { /* A missing or invalid referrer is normal outside Grist. */ }
  const ancestors = window.location.ancestorOrigins;
  return ancestors && ancestors.length ? String(ancestors[0]) : window.location.origin;
}

async function studentNavigationConnect(group, onVisit, onPeer) {
  if (typeof BroadcastChannel !== 'function' || typeof grist === 'undefined'
      || !grist.docApi || typeof grist.docApi.getDocName !== 'function') return null;
  const docId = await grist.docApi.getDocName();
  if (typeof docId !== 'string' || !docId) return null;
  const scope = JSON.stringify([window.location.origin, studentNavigationEmbeddingOrigin(),
    docId, studentNavigationGroup(group)]);
  const channel = new BroadcastChannel(`grist-student-navigation:${scope}`);
  let latest = null;
  let closed = false;
  const send = (kind, visit) => {
    if (!closed) channel.postMessage({ protocol: 'grist-student-navigation-v1', kind,
      ...(visit ? { visit } : {}) });
  };
  channel.onmessage = event => {
    const message = event.data;
    if (closed || !message || message.protocol !== 'grist-student-navigation-v1') return;
    if (message.kind === 'request') {
      send('ready');
      if (typeof onPeer === 'function') onPeer();
      if (latest) send('visit', latest);
    } else if (message.kind === 'ready') {
      if (typeof onPeer === 'function') onPeer();
    } else if (message.kind === 'visit') {
      const visit = studentNavigationVisit(message.visit);
      if (visit && typeof onVisit === 'function') onVisit(visit);
    }
  };
  send('request');
  return {
    scope,
    publish(value, announce = true) {
      const visit = studentNavigationVisit(value);
      if (!visit || closed) return false;
      latest = visit;
      if (announce) send('visit', visit);
      return true;
    },
    clear() { latest = null; },
    close() {
      closed = true;
      latest = null;
      channel.close();
    },
  };
}
