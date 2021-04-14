import { CompletionItem, CompletionItemKind } from 'vscode-languageserver/node';
import { AddonMeta, CompletionFunctionParams } from './../../utils/addon-api';
import { uniqBy } from 'lodash';

import * as memoize from 'memoizee';
import * as fs from 'fs';
import { emberBlockItems, emberMustacheItems, emberSubExpressionItems, emberModifierItems } from './ember-helpers';
import { templateContextLookup } from './template-context-provider';
import { provideComponentTemplatePaths } from './template-definition-provider';

import { log, logInfo, logError } from '../../utils/logger';
import ASTPath, { getLocalScope } from '../../glimmer-utils';
import Server from '../../server';
import { Project } from '../../project';
import {
  isLinkToTarget,
  isComponentArgumentName,
  isLocalPathExpression,
  isArgumentPathExpression,
  isScopedPathExpression,
  isLinkComponentRouteTarget,
  isMustachePath,
  isBlockPath,
  isPathExpression,
  isSubExpressionPath,
  isAngleComponentPath,
  isModifierPath,
  isNamedBlockName,
} from '../../utils/ast-helpers';
import {
  listComponents,
  listMUComponents,
  listPodsComponents,
  listHelpers,
  listRoutes,
  listModifiers,
  builtinModifiers,
  mGetProjectAddonsInfo,
  hasNamespaceSupport,
  isRootStartingWithFilePath,
} from '../../utils/layout-helpers';

import { normalizeToAngleBracketComponent } from '../../utils/normalizers';
import { getTemplateBlocks } from '../../utils/template-tokens-collector';
import { ASTNode } from 'ast-types';
import { ASTv1 } from '@glimmer/syntax';

const mTemplateContextLookup = memoize(templateContextLookup, {
  length: 3,
  maxAge: 60000,
}); // 1 second
const mListModifiers = memoize(listModifiers, { length: 1, maxAge: 60000 }); // 1 second
const mListComponents = memoize(listComponents, { length: 1, maxAge: 60000 }); // 1 second
const mListMUComponents = memoize(listMUComponents, {
  length: 1,
  maxAge: 60000,
}); // 1 second
const mListPodsComponents = memoize(listPodsComponents, {
  length: 1,
  maxAge: 60000,
}); // 1 second
const mListHelpers = memoize(listHelpers, { length: 1, maxAge: 60000 }); // 1 second

const mListRoutes = memoize(listRoutes, { length: 1, maxAge: 60000 });

/**
 * Generates a map of completion label (file name) to array of potential namespaced
 * paths.
 * @param addonsMeta addons meta array
 * @param server Server
 * @param focusPath currentfocus path
 * @returns { [key: string]: string[] }
 */
export function generateNamespacedComponentsHashMap(addonsMeta: Array<AddonMeta>, server: Server, isAngleComponent: boolean) {
  const resultMap: { [key: string]: string[] } = {};

  // Iterate over the addons meta
  addonsMeta.forEach((addonData: AddonMeta) => {
    // Get the component registry based on the addon root.
    // The component registry is a map where the file name is the key and the value are
    // potential file paths.
    // Eg: { foo: ['bar/bang/biz/foo.js'] }
    const addonRegistry = server.getRegistry(addonData.root).component;

    // For each addon meta, generate the namespaced label.
    Object.keys(addonRegistry).forEach((addonItem) => {
      const addonFilePaths = addonRegistry[addonItem];
      const itemLabel = isAngleComponent ? normalizeToAngleBracketComponent(addonItem) : addonItem;

      if (!resultMap[itemLabel]) {
        resultMap[itemLabel] = [];
      }

      // If file paths are present, then iterate over the filepath and generate the
      // namespaced label
      if (addonFilePaths.length) {
        addonFilePaths.forEach((filePath: string) => {
          // Check if filepath starts with addon's root
          if (isRootStartingWithFilePath(addonData.root, filePath)) {
            const rootNameParts = addonData.name.split('/');
            const addonName = rootNameParts.pop() || '';

            const label = isAngleComponent
              ? `${normalizeToAngleBracketComponent(addonName)}$${normalizeToAngleBracketComponent(addonItem)}`
              : `${addonName}$${addonItem}`;

            if (!resultMap[itemLabel].includes(label)) {
              resultMap[itemLabel].push(label);
            }
          }
        });
      }
    });
  });

  return resultMap;
}

function mListMURouteLevelComponents(projectRoot: string, fileURI: string) {
  // /**/routes/**/-components/**/*.{js,ts,hbs}
  // we need to get current nesting level and resolve related components
  // only if we have -components under current fileURI template path
  if (!projectRoot || !fileURI) {
    return [];
  }

  return [];
}

function isArgumentName(name: string) {
  return name.startsWith('@');
}

export default class TemplateCompletionProvider {
  project!: Project;
  server!: Server;
  hasNamespaceSupport = false;
  meta: { [key: string]: boolean } = {
    projectAddonsInfoInitialized: false,
    helpersRegistryInitialized: false,
    modifiersRegistryInitialized: false,
    componentsRegistryInitialized: false,
    podComponentsRegistryInitialized: false,
    muComponentsRegistryInitialized: false,
    routesRegistryInitialized: false,
  };
  enableRegistryCache(value: string) {
    if (this.server.flags.hasExternalFileWatcher) {
      this.meta[value] = true;
    }
  }
  async initRegistry(_: Server, project: Project) {
    this.project = project;
    this.server = _;
    this.hasNamespaceSupport = hasNamespaceSupport(project.root);

    if (project.flags.enableEagerRegistryInitialization) {
      try {
        const initStartTime = Date.now();

        mListHelpers(project.root);
        this.enableRegistryCache('helpersRegistryInitialized');

        mListModifiers(project.root);
        this.enableRegistryCache('modifiersRegistryInitialized');

        mListRoutes(project.root);
        this.enableRegistryCache('routesRegistryInitialized');

        mListComponents(project.root);
        this.enableRegistryCache('componentsRegistryInitialized');

        mGetProjectAddonsInfo(project.root);
        this.enableRegistryCache('projectAddonsInfoInitialized');

        logInfo(project.root + ': registry initialized in ' + (Date.now() - initStartTime) + 'ms');
      } catch (e) {
        logError(e);
      }
    } else {
      logInfo('EagerRegistryInitialization is disabled for "' + project.name + '" (template-completion-provider)');
    }
  }
  getAllAngleBracketComponents(root: string, uri: string) {
    const items: CompletionItem[] = [];

    if (!this.meta.projectAddonsInfoInitialized) {
      mGetProjectAddonsInfo(root);
      this.enableRegistryCache('projectAddonsInfoInitialized');
    }

    if (!this.meta.muComponentsRegistryInitialized) {
      mListMUComponents(root);
      this.enableRegistryCache('muComponentsRegistryInitialized');
    }

    if (!this.meta.componentsRegistryInitialized) {
      mListComponents(root);
      this.enableRegistryCache('componentsRegistryInitialized');
    }

    if (!this.meta.podComponentsRegistryInitialized) {
      mListPodsComponents(root);
      this.enableRegistryCache('podComponentsRegistryInitialized');
    }

    const registry = this.server.getRegistry(this.project.roots);

    return uniqBy(
      items
        .concat(
          mListMURouteLevelComponents(root, uri),
          Object.keys(registry.component).map((rawName) => {
            return {
              label: rawName,
              kind: CompletionItemKind.Class,
              detail: 'component',
            };
          })
        )
        .map((item: CompletionItem) => {
          return Object.assign({}, item, {
            label: normalizeToAngleBracketComponent(item.label),
          });
        }),
      'label'
    );
  }
  getLocalPathExpressionCandidates(root: string, uri: string, originalText: string) {
    const candidates: CompletionItem[] = [...mTemplateContextLookup(root, uri, originalText)];

    return candidates;
  }
  getMustachePathCandidates(root: string) {
    const candidates: CompletionItem[] = [
      ...mListComponents(root),
      ...mListMUComponents(root),
      ...mListPodsComponents(root),
      ...mListHelpers(root),
      ...mGetProjectAddonsInfo(root).filter(({ detail }: { detail: string }) => {
        return detail === 'component' || detail === 'helper';
      }),
    ];

    return candidates;
  }
  getBlockPathCandidates(root: string) {
    const candidates: CompletionItem[] = [
      ...mListComponents(root),
      ...mListMUComponents(root),
      ...mListPodsComponents(root),
      ...mGetProjectAddonsInfo(root).filter(({ detail }: { detail: string }) => {
        return detail === 'component';
      }),
    ];

    return candidates;
  }
  getSubExpressionPathCandidates(root: string) {
    if (!this.meta.helpersRegistryInitialized) {
      mListHelpers(root);
      this.enableRegistryCache('helpersRegistryInitialized');
    }

    if (!this.meta.projectAddonsInfoInitialized) {
      mGetProjectAddonsInfo(root);
      this.enableRegistryCache('projectAddonsInfoInitialized');
    }

    const registry = this.server.getRegistry(this.project.roots);

    return Object.keys(registry.helper).map((helperName) => {
      return {
        label: helperName,
        kind: CompletionItemKind.Function,
        description: 'helper',
      };
    });
  }
  getScopedValues(focusPath: ASTPath) {
    const scopedValues = getLocalScope(focusPath).map(({ name, node, path }) => {
      const blockSource =
        node.type === 'ElementNode'
          ? `<${(node as ASTv1.ElementNode).tag} as |...|>`
          : `{{#${path.parentPath && ((path.parentPath.node as ASTv1.BlockStatement).path as ASTv1.PathExpression).original} as |...|}}`;

      return {
        label: name,
        kind: CompletionItemKind.Variable,
        detail: `Param from ${blockSource}`,
      };
    });

    return scopedValues;
  }
  getParentComponentYields(focusPath: ASTNode & { tag: string }) {
    if (focusPath.type !== 'ElementNode') {
      return [];
    }

    const paths: string[] = [];

    this.project.roots.forEach((projectRoot) => {
      const scopedPaths = provideComponentTemplatePaths(projectRoot, focusPath.tag).filter((p) => fs.existsSync(p));

      scopedPaths.forEach((p) => {
        if (!paths.includes(p)) {
          paths.push(p);
        }
      });
    });

    if (!paths.length) {
      return [];
    }

    const tpl = paths[0];

    const content = fs.readFileSync(tpl, 'utf8');

    return getTemplateBlocks(content).map((blockName: string) => {
      return {
        label: `:${blockName}`,
        kind: CompletionItemKind.Variable,
        detail: `Named block (Slot) for <${focusPath.tag}>`,
      };
    });
  }
  async onComplete(root: string, params: CompletionFunctionParams): Promise<CompletionItem[]> {
    log('provideCompletions');

    if (params.type !== 'template') {
      return params.results;
    }

    const completions: CompletionItem[] = params.results;
    const focusPath = params.focusPath;
    const uri = params.textDocument.uri;
    const originalText = params.originalText || '';

    try {
      if (isNamedBlockName(focusPath)) {
        log('isNamedBlockName');
        // <:main>
        const yields = this.getParentComponentYields(focusPath.parent);

        completions.push(...yields);
      } else if (isAngleComponentPath(focusPath) && !isNamedBlockName(focusPath)) {
        log('isAngleComponentPath');
        // <Foo>
        const candidates = this.getAllAngleBracketComponents(root, uri);
        const scopedValues = this.getScopedValues(focusPath);

        log(candidates, scopedValues);
        completions.push(...uniqBy([...candidates, ...scopedValues], 'label'));
      } else if (isComponentArgumentName(focusPath)) {
        // <Foo @name.. />

        const maybeComponentName = focusPath.parent.tag;
        const isValidComponent =
          !['Input', 'Textarea', 'LinkTo'].includes(maybeComponentName) &&
          !isArgumentName(maybeComponentName) &&
          !maybeComponentName.startsWith(':') &&
          !maybeComponentName.includes('.');

        if (isValidComponent) {
          const tpls: string[] = [];

          this.project.roots.forEach((pRoot) => {
            const localtpls = provideComponentTemplatePaths(pRoot, maybeComponentName);

            localtpls.forEach((item) => {
              if (!tpls.includes(item)) {
                tpls.push(item);
              }
            });
          });

          const existingTpls = tpls.filter(fs.existsSync);

          if (existingTpls.length) {
            const existingAttributes = focusPath.parent.attributes.map((attr: ASTv1.AttrNode) => attr.name).filter((name: string) => isArgumentName(name));
            const content = fs.readFileSync(existingTpls[0], 'utf8');
            const candidates = this.getLocalPathExpressionCandidates(root, tpls[0], content);
            const preResults: CompletionItem[] = [];

            candidates.forEach((obj: CompletionItem) => {
              const name = obj.label.split('.')[0];

              if (isArgumentName(name) && !existingAttributes.includes(name)) {
                preResults.push({
                  label: name,
                  detail: obj.detail,
                  kind: obj.kind,
                });
              }
            });

            if (preResults.length) {
              completions.push(...uniqBy(preResults, 'label'));
            }
          }
        }
      } else if (isLocalPathExpression(focusPath)) {
        // {{foo-bar this.na?}}
        log('isLocalPathExpression');
        const candidates = this.getLocalPathExpressionCandidates(root, uri, originalText).filter((el) => {
          return el.label.startsWith('this.');
        });

        completions.push(...uniqBy(candidates, 'label'));
      } else if (isArgumentPathExpression(focusPath)) {
        // {{@ite..}}
        const candidates = this.getLocalPathExpressionCandidates(root, uri, originalText).filter((el) => {
          return isArgumentName(el.label);
        });

        completions.push(...uniqBy(candidates, 'label'));
      } else if (isMustachePath(focusPath)) {
        // {{foo-bar?}}
        log('isMustachePath');
        const candidates = this.getMustachePathCandidates(root);
        const localCandidates = this.getLocalPathExpressionCandidates(root, uri, originalText);

        if (isScopedPathExpression(focusPath)) {
          const scopedValues = this.getScopedValues(focusPath);

          completions.push(...uniqBy(scopedValues, 'label'));
        }

        completions.push(...uniqBy(localCandidates, 'label'));
        completions.push(...uniqBy(candidates, 'label'));
        completions.push(...emberMustacheItems);
      } else if (isBlockPath(focusPath)) {
        // {{#foo-bar?}} {{/foo-bar}}
        log('isBlockPath');
        const candidates = this.getBlockPathCandidates(root);

        if (isScopedPathExpression(focusPath)) {
          const scopedValues = this.getScopedValues(focusPath);

          completions.push(...uniqBy(scopedValues, 'label'));
        }

        completions.push(...emberBlockItems);
        completions.push(...uniqBy(candidates, 'label'));
      } else if (isSubExpressionPath(focusPath)) {
        // {{foo-bar name=(subexpr? )}}
        log('isSubExpressionPath');
        const candidates = this.getSubExpressionPathCandidates(root);

        completions.push(...uniqBy(candidates, 'label'));
        completions.push(...emberSubExpressionItems);
      } else if (isPathExpression(focusPath)) {
        if (isScopedPathExpression(focusPath)) {
          const scopedValues = this.getScopedValues(focusPath);

          completions.push(...uniqBy(scopedValues, 'label'));
        }

        const candidates = this.getLocalPathExpressionCandidates(root, uri, originalText);

        completions.push(...uniqBy(candidates, 'label'));
      } else if (isLinkToTarget(focusPath)) {
        // {{link-to "name" "target?"}}, {{#link-to "target?"}} {{/link-to}}
        log('isLinkToTarget');
        completions.push(...uniqBy(mListRoutes(root), 'label'));
      } else if (isLinkComponentRouteTarget(focusPath)) {
        // <LinkTo @route="foo.." />
        log('isLinkComponentRouteTarget');
        completions.push(...uniqBy(mListRoutes(root), 'label'));
      } else if (isModifierPath(focusPath)) {
        log('isModifierPath');
        const addonModifiers = mGetProjectAddonsInfo(root).filter(({ detail }: { detail: string }) => {
          return detail === 'modifier';
        });

        completions.push(...uniqBy([...emberModifierItems, ...mListModifiers(root), ...addonModifiers, ...builtinModifiers()], 'label'));
      }
    } catch (e) {
      log('error', e);
    }

    if (this.hasNamespaceSupport) {
      const hasSomeComponents = completions.some((completion) => completion.detail === 'component');

      if (hasSomeComponents) {
        const resultsMap = generateNamespacedComponentsHashMap(this.project.addonsMeta, this.server, isAngleComponentPath(focusPath));
        const newCompletions: CompletionItem[] = [];

        // Iterate over the completions and add name spaced labels if applicable.
        completions.forEach((completionItem) => {
          const matchingLabels = resultsMap[completionItem.label];

          if (matchingLabels) {
            matchingLabels.forEach((labelItem: string) => {
              const completionObj = { ...completionItem };

              completionObj.label = labelItem;
              newCompletions.push(completionObj);
            });
          } else {
            newCompletions.push(completionItem);
          }
        });

        return newCompletions;
      }
    }

    return completions;
  }
}
