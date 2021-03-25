import * as path from 'path';
import * as t from '@babel/types';
import { URI } from 'vscode-uri';
import * as fg from 'fast-glob';
import * as memoize from 'memoizee';
import { Definition, Location, Range } from 'vscode-languageserver/node';
import { DefinitionFunctionParams } from './../../utils/addon-api';
import { pathsToLocations, getAddonPathsForType, getAddonImport, mProjectRoot } from '../../utils/definition-helpers';
import {
  isRouteLookup,
  isTransformReference,
  isModelReference,
  isImportPathDeclaration,
  isServiceInjection,
  isNamedServiceInjection,
  isTemplateElement,
  isImportSpecifier,
} from './../../utils/ast-helpers';
import { normalizeServiceName } from '../../utils/normalizers';
import { isModuleUnificationApp, podModulePrefixForRoot } from './../../utils/layout-helpers';
import { provideRouteDefinition } from './template-definition-provider';

type ItemType = 'Model' | 'Transform' | 'Service';

// barking on 'LayoutCollectorFn' is defined but never used  @typescript-eslint/no-unused-vars
// eslint-disable-line
type LayoutCollectorFn = (root: string, itemName: string, podModulePrefix?: string) => string[];

const mFindByGlob = memoize(findByGlob, {
  length: 3,
  maxAge: 600000,
});

function findByGlob(pathName: string, appName: string, parentRoot: string) {
  let res: string[] = [];
  const pathParts = pathName.split('/');
  const addonName = pathParts.shift();

  res = fg.sync([`${parentRoot}/${appName}/(lib|engines)/**/${addonName}/**/${pathParts.join('/')}?(/index).js`], { ignore: ['**/node_modules/**'] });

  if (!res.length) {
    res = fg.sync([`${parentRoot}/(app|lib)/**/${addonName}/**/addon/${pathParts.join('/')}?(/index).js`], {
      ignore: ['**/node_modules/**'],
    });
  }

  return res.map((modulePath) => {
    return Location.create(URI.file(modulePath).toString(), Range.create(0, 0, 0, 0));
  });
}

function joinPaths(...args: string[]) {
  return ['.ts', '.js'].map((extName: string) => {
    const localArgs = args.slice(0);
    const lastArg = localArgs.pop() + extName;

    return path.join.apply(path, [...localArgs, lastArg]);
  });
}

class PathResolvers {
  [key: string]: LayoutCollectorFn;
  muModelPaths(root: string, modelName: string) {
    return joinPaths(root, 'src', 'data', 'models', modelName, 'model');
  }
  muTransformPaths(root: string, transformName: string) {
    return joinPaths(root, 'src', 'data', 'transforms', transformName);
  }
  muServicePaths(root: string, transformName: string) {
    return joinPaths(root, 'src', 'services', transformName);
  }
  classicModelPaths(root: string, modelName: string) {
    return joinPaths(root, 'app', 'models', modelName);
  }
  classicTransformPaths(root: string, transformName: string) {
    return joinPaths(root, 'app', 'transforms', transformName);
  }
  classicServicePaths(root: string, modelName: string) {
    return joinPaths(root, 'app', 'services', modelName);
  }
  podTransformPaths(root: string, transformName: string, podPrefix: string) {
    return joinPaths(root, 'app', podPrefix, transformName, 'transform');
  }
  podModelPaths(root: string, modelName: string, podPrefix: string) {
    return joinPaths(root, 'app', podPrefix, modelName, 'model');
  }
  podServicePaths(root: string, modelName: string, podPrefix: string) {
    return joinPaths(root, 'app', podPrefix, modelName, 'service');
  }
  addonServicePaths(root: string, serviceName: string) {
    return getAddonPathsForType(root, 'services', serviceName);
  }
  addonImportPaths(root: string, pathName: string, appName: string) {
    return getAddonImport(root, pathName, appName);
  }
  classicImportPaths(root: string, pathName: string, appName: string) {
    const pathParts = pathName.split('/');

    pathParts.shift();
    const appParams = [root, appName, 'app', ...pathParts];
    const testParams = [root, appName, 'tests', ...pathParts];
    const rootParams = [root, appName, ...pathParts];

    return joinPaths(...appParams).concat(joinPaths(...testParams).concat(joinPaths(...rootParams)));
  }
  muImportPaths(root: string, pathName: string) {
    const pathParts = pathName.split('/');

    pathParts.shift();
    const params = [root, ...pathParts];

    return joinPaths(...params);
  }
}

export default class CoreScriptDefinitionProvider {
  private resolvers!: PathResolvers;
  constructor() {
    this.resolvers = new PathResolvers();
  }
  guessPathForImport(root: string, uri: string, importPath: string, appName?: string) {
    if (!uri) {
      return null;
    }

    const guessedPaths: string[] = [];
    const fnName = 'Import';

    if (isModuleUnificationApp(root)) {
      this.resolvers[`mu${fnName}Paths`](root, importPath).forEach((pathLocation: string) => {
        guessedPaths.push(pathLocation);
      });
    } else {
      this.resolvers[`classic${fnName}Paths`](root, importPath, appName).forEach((pathLocation: string) => {
        guessedPaths.push(pathLocation);
      });
    }

    this.resolvers.addonImportPaths(root, importPath, appName as string).forEach((pathLocation: string) => {
      guessedPaths.push(pathLocation);
    });

    return pathsToLocations(...guessedPaths);
  }
  guessPathsForType(root: string, fnName: ItemType, typeName: string) {
    const guessedPaths: string[] = [];

    if (isModuleUnificationApp(root)) {
      this.resolvers[`mu${fnName}Paths`](root, typeName).forEach((pathLocation: string) => {
        guessedPaths.push(pathLocation);
      });
    } else {
      this.resolvers[`classic${fnName}Paths`](root, typeName).forEach((pathLocation: string) => {
        guessedPaths.push(pathLocation);
      });
      const podPrefix = podModulePrefixForRoot(root);

      if (podPrefix) {
        this.resolvers[`pod${fnName}Paths`](root, typeName, podPrefix).forEach((pathLocation: string) => {
          guessedPaths.push(pathLocation);
        });
      }
    }

    if (fnName === 'Service') {
      this.resolvers.addonServicePaths(root, typeName).forEach((item: string) => {
        guessedPaths.push(item);
      });
    }

    return pathsToLocations(...guessedPaths);
  }
  async onDefinition(root: string, params: DefinitionFunctionParams): Promise<Definition | null> {
    const { textDocument, focusPath, type, results, server, position } = params;

    if (type !== 'script') {
      return results;
    }

    const uri = textDocument.uri;
    let definitions: Location[] = results;
    const astPath = focusPath;

    if (isTemplateElement(astPath)) {
      const project = server.projectRoots.projectForUri(uri);

      if (!project) {
        return results;
      }

      const templateResults = await server.definitionProvider.template.handle(
        {
          textDocument,
          position,
        },
        project
      );

      if (Array.isArray(templateResults)) {
        definitions = templateResults;
      }
    } else if (isModelReference(astPath)) {
      const modelName = ((astPath.node as unknown) as t.StringLiteral).value;

      definitions = this.guessPathsForType(root, 'Model', modelName);
    } else if (isTransformReference(astPath)) {
      const transformName = ((astPath.node as unknown) as t.StringLiteral).value;

      definitions = this.guessPathsForType(root, 'Transform', transformName);
    } else if (isImportPathDeclaration(astPath)) {
      definitions = this.guessPathForImport(root, uri, ((astPath.node as unknown) as t.StringLiteral).value) || [];
    } else if (isImportSpecifier(astPath)) {
      const pathName: string = ((astPath.parentFromLevel(2) as unknown) as any).source.value;
      const parentRoot = mProjectRoot(root);
      const appName = (await server.connection.workspace.getConfiguration('els.appRoot')) || '';

      definitions = this.guessPathForImport(parentRoot, uri, pathName, appName) || [];

      if (!definitions.length) {
        definitions = mFindByGlob(pathName, appName, parentRoot);
      }
    } else if (isServiceInjection(astPath)) {
      let serviceName = ((astPath.node as unknown) as t.Identifier).name;
      const args = astPath.parent.value.arguments;

      if (args.length && args[0].type === 'StringLiteral') {
        serviceName = args[0].value;
      }

      definitions = this.guessPathsForType(root, 'Service', normalizeServiceName(serviceName));
    } else if (isNamedServiceInjection(astPath)) {
      const serviceName = ((astPath.node as unknown) as t.StringLiteral).value;

      definitions = this.guessPathsForType(root, 'Service', normalizeServiceName(serviceName));
    } else if (isRouteLookup(astPath)) {
      const routePath = ((astPath.node as unknown) as t.StringLiteral).value;

      definitions = provideRouteDefinition(root, routePath);
    }

    return definitions || [];
  }
}
