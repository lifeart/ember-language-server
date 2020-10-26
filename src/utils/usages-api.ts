import { extractTokensFromTemplate } from './template-tokens-collector';
import * as fs from 'fs';

export interface TemplateTokenMeta {
  source: string;
  tokens: string[];
}

const TEMPLATE_TOKENS: {
  component: {
    [key: string]: TemplateTokenMeta;
  };
  routePath: {
    [key: string]: TemplateTokenMeta;
  };
} = {
  component: {},
  routePath: {},
};

export type UsageType = 'component' | 'routePath';

export interface Usage {
  name: string;
  path: string;
  type: UsageType;
  usages: Usage[];
}

function closestParentRoutePath(name: string): string | null {
  const lastIndexOfDot = name.lastIndexOf('.');

  if (name.endsWith('-loading') || name.endsWith('-error')) {
    return name.slice(0, name.lastIndexOf('-'));
  }

  if (lastIndexOfDot === undefined || lastIndexOfDot < 0) {
    return null;
  }

  return name.slice(0, lastIndexOfDot);
}

function looksLikeRoutePath(token: string) {
  if (token.includes('.')) {
    return true;
  }

  if (token.endsWith('-loading')) {
    return true;
  }

  if (token.endsWith('-error')) {
    return true;
  }

  return false;
}

export function findRelatedFiles(token: string): Usage[] {
  const results: Usage[] = [];

  Object.keys(TEMPLATE_TOKENS).forEach((kindName) => {
    const components = TEMPLATE_TOKENS[kindName as UsageType];

    Object.keys(components).forEach((normalizedComponentName: string) => {
      if (components[normalizedComponentName].tokens.includes(token)) {
        results.push({
          name: normalizedComponentName,
          path: components[normalizedComponentName].source,
          type: kindName as UsageType,
          usages: [],
        });
      }
    });

    if (looksLikeRoutePath(token) && kindName === 'routePath') {
      let parent: string | null = token;

      do {
        parent = closestParentRoutePath(parent);

        if (parent !== null) {
          if (components[parent]) {
            results.push({
              name: parent,
              path: components[parent].source,
              type: kindName as UsageType,
              usages: [],
            });
            break;
          }
        } else {
          break;
        }
      } while (parent);
    } else if (token === 'index' && kindName === 'routePath') {
      if (components['application']) {
        results.push({
          name: 'application',
          path: components['application'].source,
          type: kindName as UsageType,
          usages: [],
        });
      }
    }
  });

  return results;
}

export function updateTemplateTokens(kind: UsageType, normalizedName: string, file: string | null) {
  if (file === null) {
    delete TEMPLATE_TOKENS[kind][normalizedName];

    return;
  }

  try {
    const tokens = extractTokensFromTemplate(fs.readFileSync(file, 'utf8'));

    TEMPLATE_TOKENS[kind][normalizedName] = {
      source: file,
      tokens,
    };
  } catch (e) {
    //
  }
}
