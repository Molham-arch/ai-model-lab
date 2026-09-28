export function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
}

function inline(text) {
  return escapeHtml(text).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

// Small, deliberately restricted Markdown renderer: raw HTML and links stay text.
export function renderMarkdown(text) {
  return String(text).split(/```/).map((part, index) => {
    if (index % 2) {
      const code = part.replace(/^[\w+-]*\r?\n/, '').trimEnd();
      return `<pre><code>${escapeHtml(code)}</code></pre>`;
    }
    return part.split(/\n\s*\n/).filter(Boolean).map(block => {
      if (/^#{1,4}\s/.test(block)) return `<h4>${inline(block.replace(/^#{1,4}\s/, ''))}</h4>`;
      const lines = block.split('\n');
      if (lines.every(line => /^\s*[-*]\s/.test(line))) return `<ul>${lines.map(line => `<li>${inline(line.replace(/^\s*[-*]\s/, ''))}</li>`).join('')}</ul>`;
      if (lines.every(line => /^\s*\d+[.)]\s/.test(line))) return `<ol>${lines.map(line => `<li>${inline(line.replace(/^\s*\d+[.)]\s/, ''))}</li>`).join('')}</ol>`;
      return `<p>${lines.map(inline).join('<br>')}</p>`;
    }).join('');
  }).join('');
}

export function validExperiment(value) {
  return value && typeof value === 'object' && typeof value.id === 'string' &&
    typeof value.prompt === 'string' && value.prompt.length <= 8000 &&
    ['demo','live'].includes(value.mode) && typeof value.createdAt === 'string' && Number.isFinite(Date.parse(value.createdAt)) &&
    Array.isArray(value.results) && value.results.length >= 2 && value.results.length <= 3 &&
    value.results.every(result => result && typeof result.modelId === 'string' && typeof result.modelName === 'string' &&
      ['success','error'].includes(result.status) && typeof result.content === 'string');
}

export function readExperiments(storage) {
  try {
    const data = JSON.parse(storage.getItem('model-lab:experiments:v1') || '[]');
    if (!Array.isArray(data)) return [];
    return data.filter(validExperiment).slice(0, 50).map(experiment => {
      const ratings = {};
      for (const result of experiment.results) {
        const rating = experiment.ratings?.[result.modelId];
        if (Number.isInteger(rating) && rating >= 1 && rating <= 5) Object.defineProperty(ratings, result.modelId, { value: rating, enumerable: true, writable: true, configurable: true });
      }
      const settings = experiment.settings || {};
      return { ...experiment, ratings,
        winner: experiment.results.some(result => result.status === 'success' && result.modelId === experiment.winner) ? experiment.winner : null,
        settings: {
          temperature: typeof settings.temperature === 'number' && settings.temperature >= 0 && settings.temperature <= 2 ? settings.temperature : 0.7,
          maxTokens: [256,512,1024,2048,4096].includes(settings.maxTokens) ? settings.maxTokens : 1024,
          systemPrompt: typeof settings.systemPrompt === 'string' ? settings.systemPrompt.slice(0,2000) : '',
        },
      };
    });
  } catch { return []; }
}

export function formatCost(value) {
  return typeof value === 'number' && Number.isFinite(value) ? `$${value.toFixed(5)}` : '—';
}
