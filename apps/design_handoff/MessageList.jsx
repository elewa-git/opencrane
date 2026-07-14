
function MessageList({ messages = [] }) {
  const scopeColors = {
    org:     { bg: '#e8e8e4', color: '#4a4845' },
    dept:    { bg: '#fef0d0', color: '#7a5010' },
    project: { bg: '#e0f0e8', color: '#1a5c38' },
    personal:{ bg: '#fce8e4', color: '#c1392b' },
  };
  const typeColors = {
    R: { bg: '#ddeeff', color: '#1d4d8a' },
    P: { bg: '#fef0d0', color: '#7a5010' },
    A: { bg: '#d8f0e4', color: '#1a5c38' },
  };
  const statusColors = {
    applied: '#9a6b2a', done: '#2a7d4f', pending: '#c1392b', resolved: '#8a8682',
  };

  return React.createElement('div', null,
    messages.map(msg => {
      if (msg.role === 'user') {
        return React.createElement('div', {
          key: msg.id,
          style: { display: 'flex', justifyContent: 'flex-end', marginBottom: 28 },
        },
          React.createElement('div', {
            style: { background: '#1a1918', color: '#fff', borderRadius: '14px 14px 3px 14px', padding: '11px 16px', maxWidth: '72%', fontSize: 14.5, lineHeight: 1.6, fontFamily: 'inherit' },
          }, msg.text)
        );
      }

      const cits = (msg.citations || []).map(c => {
        const tc = typeColors[c.type] || typeColors.R;
        const sc = scopeColors[c.scope] || scopeColors.org;
        const sc2 = c.status ? statusColors[c.status] : null;
        return React.createElement('div', {
          key: c.id,
          style: { display: 'flex', alignItems: 'center', gap: 7, padding: '7px 11px', background: '#fff', border: '1px solid #e8e5de', borderLeft: '2.5px solid ' + tc.color, borderRadius: '0 7px 7px 0', flexWrap: 'wrap', marginBottom: 5 },
        },
          React.createElement('span', { style: { fontSize: 10.5, fontWeight: 700, padding: '2px 6px', borderRadius: 3, background: tc.bg, color: tc.color, fontFamily: "'DM Mono',monospace", flexShrink: 0 } }, c.id),
          React.createElement('span', { style: { fontSize: 12.5, color: '#3a3835', flex: 1, minWidth: 0 } }, c.title),
          React.createElement('span', { style: { fontSize: 11, padding: '2px 6px', borderRadius: 3, background: sc.bg, color: sc.color, flexShrink: 0 } }, c.scope),
          React.createElement('code', { style: { fontFamily: "'DM Mono',monospace", fontSize: 11, color: '#9a9690', flexShrink: 0 } }, c.source),
          sc2 ? React.createElement('span', { style: { fontSize: 11, padding: '2px 7px', borderRadius: 3, border: '1px solid ' + sc2, color: sc2, flexShrink: 0 } }, c.status) : null
        );
      });

      return React.createElement('div', { key: msg.id, style: { marginBottom: 32 } },
        React.createElement('div', { style: { fontSize: 15, lineHeight: 1.7, color: '#1a1918', whiteSpace: 'pre-wrap', fontFamily: 'inherit', marginBottom: cits.length ? 12 : 0 } }, msg.text),
        ...cits
      );
    })
  );
}

window.MessageList = MessageList;
