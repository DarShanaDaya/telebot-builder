// Minimal {{path.to.value}} templating used across node executors.
// Values are resolved against session variables + telegram context.

export function resolvePath(obj, path) {
  if (obj == null || !path) return undefined;
  return String(path)
    .split('.')
    .reduce((acc, key) => (acc == null ? acc : acc[key]), obj);
}

export function renderTemplate(str, ctx) {
  if (str == null) return str;
  // Double braces read regular session values ({{answer}}). Triple braces are
  // intentionally reserved for values emitted by a named flow node, so a
  // value can be referenced without colliding with ordinary variable names:
  // {{{plan_choice.standard}}}.
  return String(str).replace(/\{\{\{\s*([\w.$-]+)\s*\}\}\}|\{\{\s*([\w.$-]+)\s*\}\}/g, (match, nodeExpr, expr) => {
    const val = nodeExpr
      ? resolvePath(resolvePath(ctx, '_nodeValues'), nodeExpr)
      : resolvePath(ctx, expr);
    if (val == null || val === undefined) return '';
    if (typeof val === 'object') {
      try {
        return JSON.stringify(val);
      } catch {
        return String(val);
      }
    }
    return String(val);
  });
}

// Recursively render every string inside an arbitrary value.
export function renderDeep(value, ctx) {
  if (typeof value === 'string') return renderTemplate(value, ctx);
  if (Array.isArray(value)) return value.map((v) => renderDeep(v, ctx));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, renderDeep(v, ctx)]));
  }
  return value;
}

// Simple boolean expression evaluator for Condition nodes.
export function evaluateCondition({ left = '', op = 'eq', right = '' }, ctx) {
  const l = renderTemplate(left, ctx);
  const r = renderTemplate(right, ctx);
  switch (op) {
    case 'eq':
      return l === r;
    case 'neq':
      return l !== r;
    case 'contains':
      return l.toLowerCase().includes(r.toLowerCase());
    case 'not_contains':
      return !l.toLowerCase().includes(r.toLowerCase());
    case 'starts_with':
      return l.toLowerCase().startsWith(r.toLowerCase());
    case 'ends_with':
      return l.toLowerCase().endsWith(r.toLowerCase());
    case 'gt':
      return Number(l) > Number(r);
    case 'lt':
      return Number(l) < Number(r);
    case 'gte':
      return Number(l) >= Number(r);
    case 'lte':
      return Number(l) <= Number(r);
    case 'exists':
      return l.trim() !== '';
    case 'not_exists':
      return l.trim() === '';
    case 'regex': {
      try {
        return new RegExp(r).test(l);
      } catch {
        return false;
      }
    }
    default:
      return false;
  }
}
