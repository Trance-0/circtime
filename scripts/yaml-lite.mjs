const ARRAY_KEYS = new Set(['infrastructure', 'services', 'network', 'server_port', 'server_ports', 'domains', 'dns', 'containers', 'proxies']);

function stripComment(line) {
  let quote = null;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const prev = line[i - 1];
    if ((char === '"' || char === "'") && prev !== '\\') {
      quote = quote === char ? null : quote ?? char;
    }
    if (char === '#' && quote === null) {
      return line.slice(0, i);
    }
  }
  return line;
}

function splitKeyValue(text) {
  let quote = null;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const prev = text[i - 1];
    if ((char === '"' || char === "'") && prev !== '\\') {
      quote = quote === char ? null : quote ?? char;
    }
    if (char === ':' && quote === null) {
      return [text.slice(0, i).trim(), text.slice(i + 1).trim()];
    }
  }
  return null;
}

function parseInlineArray(value) {
  const body = value.slice(1, -1).trim();
  if (!body) return [];

  const parts = [];
  let quote = null;
  let current = '';
  for (let i = 0; i < body.length; i += 1) {
    const char = body[i];
    const prev = body[i - 1];
    if ((char === '"' || char === "'") && prev !== '\\') {
      quote = quote === char ? null : quote ?? char;
    }
    if (char === ',' && quote === null) {
      parts.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  if (current.trim()) parts.push(current.trim());

  return parts.map(parseScalar);
}

function parseScalar(value) {
  if (value === '') return null;
  if (value === '[]') return [];
  if (value.startsWith('[') && value.endsWith(']')) return parseInlineArray(value);
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null' || value === '~') return null;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  return value;
}

function collectionForKey(key) {
  return ARRAY_KEYS.has(key) ? [] : {};
}

export function parseYamlLite(source) {
  const root = {};
  const stack = [{ indent: -1, value: root }];

  const lines = source
    .split(/\r?\n/)
    .map((raw) => {
      const withoutComment = stripComment(raw).replace(/\s+$/, '');
      return {
        indent: withoutComment.match(/^ */)?.[0].length ?? 0,
        text: withoutComment.trim(),
      };
    })
    .filter((line) => line.text.length > 0);

  for (const line of lines) {
    while (line.indent <= stack[stack.length - 1].indent) {
      stack.pop();
    }

    const parent = stack[stack.length - 1].value;

    if (line.text.startsWith('- ')) {
      if (!Array.isArray(parent)) {
        throw new Error(`Unexpected list item: ${line.text}`);
      }

      const rest = line.text.slice(2).trim();
      const pair = splitKeyValue(rest);
      if (!pair) {
        parent.push(parseScalar(rest));
        continue;
      }

      const item = {};
      const [key, rawValue] = pair;
      const value = rawValue === '' ? collectionForKey(key) : parseScalar(rawValue);
      item[key] = value;
      parent.push(item);
      stack.push({ indent: line.indent, value: item });
      if (rawValue === '' && typeof value === 'object' && value !== null) {
        stack.push({ indent: line.indent + 1, value });
      }
      continue;
    }

    if (Array.isArray(parent)) {
      throw new Error(`Expected list item but found: ${line.text}`);
    }

    const pair = splitKeyValue(line.text);
    if (!pair) {
      throw new Error(`Expected key/value pair but found: ${line.text}`);
    }

    const [key, rawValue] = pair;
    const value = rawValue === '' ? collectionForKey(key) : parseScalar(rawValue);
    parent[key] = value;
    if (rawValue === '' && typeof value === 'object' && value !== null) {
      stack.push({ indent: line.indent, value });
    }
  }

  return root;
}
