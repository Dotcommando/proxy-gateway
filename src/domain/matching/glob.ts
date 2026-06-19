export interface GlobMatchOptions {
  caseSensitive?: boolean;
}

export function matchGlob(pattern: string, value: string, options: GlobMatchOptions = {}): boolean {
  const patternSegments = splitPath(pattern);
  const valueSegments = splitPath(value);
  const segmentMatchers = patternSegments.map((segment) =>
    segment === '**' ? undefined : segmentToRegExp(segment, options),
  );
  const memo = new Map<string, boolean>();
  const match = (patternIndex: number, valueIndex: number): boolean => {
    const memoKey = `${patternIndex}:${valueIndex}`;
    const memoValue = memo.get(memoKey);

    if (memoValue !== undefined) {
      return memoValue;
    }

    let result: boolean;

    if (patternIndex === patternSegments.length) {
      result = valueIndex === valueSegments.length;
    } else if (patternSegments[patternIndex] === '**') {
      result =
        match(patternIndex + 1, valueIndex)
        || (valueIndex < valueSegments.length && match(patternIndex, valueIndex + 1));
    } else if (valueIndex >= valueSegments.length) {
      result = false;
    } else {
      result =
        segmentMatchers[patternIndex]!.test(valueSegments[valueIndex]!)
        && match(patternIndex + 1, valueIndex + 1);
    }

    memo.set(memoKey, result);

    return result;
  };

  return match(0, 0);
}

export function hasGlobMagic(pattern: string): boolean {
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];

    if (character === '\\') {
      index += 1;

      continue;
    }
    if (character === '*' || character === '?') {
      return true;
    }
    if (character === '[' && findClosingClassIndex(pattern, index + 1) !== -1) {
      return true;
    }
  }

  return false;
}

function splitPath(value: string): string[] {
  return value.split('/');
}

function segmentToRegExp(segment: string, options: GlobMatchOptions): RegExp {
  const source = `^${segmentToRegExpSource(segment)}$`;

  return new RegExp(source, options.caseSensitive === false ? 'i' : '');
}

function segmentToRegExpSource(segment: string): string {
  let source = '';

  for (let index = 0; index < segment.length; index += 1) {
    const character = segment[index]!;

    if (character === '\\') {
      index += 1;
      source += escapeRegExp(segment[index] ?? '\\');

      continue;
    }
    if (character === '*') {
      source += '[^/]*';

      continue;
    }
    if (character === '?') {
      source += '[^/]';

      continue;
    }
    if (character === '[') {
      const closingIndex = findClosingClassIndex(segment, index + 1);

      if (closingIndex !== -1) {
        source += characterClassToRegExpSource(segment.slice(index + 1, closingIndex));
        index = closingIndex;

        continue;
      }
    }

    source += escapeRegExp(character);
  }

  return source;
}

function findClosingClassIndex(input: string, fromIndex: number): number {
  for (let index = fromIndex; index < input.length; index += 1) {
    if (input[index] === '\\') {
      index += 1;

      continue;
    }
    if (input[index] === ']') {
      return index;
    }
  }

  return -1;
}

function characterClassToRegExpSource(content: string): string {
  if (content.length === 0) {
    return '\\[\\]';
  }

  const negated = content[0] === '!' || content[0] === '^';
  const body = negated ? content.slice(1) : content;

  if (body.length === 0) {
    return escapeRegExp(`[${content}]`);
  }

  return `[${negated ? '^' : ''}${escapeCharacterClassBody(body)}]`;
}

function escapeCharacterClassBody(value: string): string {
  let escaped = '';

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!;

    if (character === '\\') {
      index += 1;
      escaped += escapeCharacterClassLiteral(value[index] ?? '\\');

      continue;
    }

    escaped += escapeCharacterClassLiteral(character);
  }

  return escaped;
}

function escapeCharacterClassLiteral(value: string): string {
  return value === ']' || value === '\\' ? `\\${value}` : value;
}

function escapeRegExp(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
}
