import { parentPort } from 'worker_threads';
import { toDiagnostic, toHbsSource } from './utils/diagnostic';
import { getTemplateNodes } from '@lifeart/ember-extract-inline-templates';
import { parseScriptFile } from 'ember-meta-explorer';
import { pathToFileURL } from 'url';
import { getExtension } from './utils/file-extension';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { Diagnostic } from 'vscode-languageserver/node';
import { URI } from 'vscode-uri';

import { getFileRanges, RangeWalker } from './utils/glimmer-script';
export interface TemplateLinterError {
  fatal?: boolean;
  moduleId: string;
  rule?: string;
  filePath: string;
  severity: number;
  message: string;
  isFixable?: boolean;
  line?: number;
  column?: number;
  source?: string;
}
type LinterVerifyArgs = { source: string; moduleId: string; filePath: string };

class Linter {
  constructor() {
    return this;
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  verify(_params: LinterVerifyArgs): TemplateLinterError[] {
    return [];
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  verifyAndFix(_params: LinterVerifyArgs): { isFixed: boolean; output: string } {
    return {
      output: '',
      isFixed: true,
    };
  }
}

type LintAction = 'verify' | 'verifyAndFix';

export type LinterMessage = { id: string; content: string; uri: string; action: LintAction; projectRoot: string; linterPath: string };

const linters: Map<string, typeof Linter> = new Map();

export const extensionsToLint: string[] = ['.hbs', '.js', '.ts', '.gts', '.gjs'];

async function getLinterClass(msg: LinterMessage) {
  try {
    // commonjs behavior

    // @ts-expect-error @todo - fix webpack imports
    const requireFunc = typeof __webpack_require__ === 'function' ? __non_webpack_require__ : require;

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const linter: typeof Linter = requireFunc(msg.linterPath);

    return linter;
  } catch {
    // ember-template-lint v4 support (as esm module)
    // using eval here to stop webpack from bundling it
    const linter: typeof Linter = (await eval(`import("${pathToFileURL(msg.linterPath)}")`)).default;

    return linter;
  }
}

function sourcesForDocument(textDocument: TextDocument) {
  const ext = getExtension(textDocument);

  if (ext !== null && !extensionsToLint.includes(ext)) {
    return [];
  }

  const documentContent = textDocument.getText();

  if (ext === '.hbs') {
    if (documentContent.trim().length === 0) {
      return [];
    } else {
      return [documentContent];
    }
  } else if (ext === '.gjs' || ext === '.gts') {
    const ranges = getFileRanges(documentContent);

    const rangeWalker = new RangeWalker(ranges);
    const templates = rangeWalker.templates();

    return templates.map((t) => {
      return toHbsSource({
        startLine: t.loc.start.line,
        startColumn: t.loc.start.character,
        endColumn: t.loc.end.character,
        endLine: t.loc.end.line,
        template: t.content,
      });
    });
  } else {
    const nodes = getTemplateNodes(documentContent, {
      parse(source: string) {
        return parseScriptFile(source);
      },
    });
    const sources = nodes.filter((el) => {
      return el.template.trim().length > 0;
    });

    return sources.map((el) => {
      return toHbsSource(el);
    });
  }
}

async function linkLinterToProject(msg: LinterMessage) {
  if (!linters.has(msg.projectRoot)) {
    linters.set(msg.projectRoot, await getLinterClass(msg));
  }
}

async function getLinterInstance(msg: LinterMessage) {
  const LinterKlass = linters.get(msg.projectRoot);

  return LinterKlass ? new LinterKlass() : undefined;
}

async function fixDocument(message: LinterMessage): Promise<[null | Error, { isFixed: boolean; output?: string }]> {
  try {
    await linkLinterToProject(message);
  } catch {
    return [new Error('Unable to find linter for project'), { isFixed: false }];
  }

  let linter: Linter | undefined;

  try {
    linter = await getLinterInstance(message);
  } catch {
    return [new Error('Unable to create linter instance'), { isFixed: false }];
  }

  if (!linter) {
    return [new Error('Unable resolve linter instance'), { isFixed: false }];
  }

  try {
    const { isFixed, output } = await (linter as Linter).verifyAndFix({
      source: message.content,
      moduleId: URI.parse(message.uri).fsPath,
      filePath: URI.parse(message.uri).fsPath,
    });

    return [null, { isFixed, output: isFixed ? output : '' }];
  } catch (e) {
    return [e, { isFixed: false }];
  }
}

async function lintDocument(message: LinterMessage): Promise<[null | Error, Diagnostic[]]> {
  try {
    await linkLinterToProject(message);
  } catch {
    return [new Error('Unable to find linter for project'), []];
  }

  let linter: Linter | undefined;

  try {
    linter = await getLinterInstance(message);
  } catch {
    return [new Error('Unable to create linter instance'), []];
  }

  if (!linter) {
    return [new Error('Unable resolve linter instance'), []];
  }

  let sources: string[] = [];

  try {
    sources = sourcesForDocument(TextDocument.create(message.uri, 'handlebars', 0, message.content));
  } catch (e) {
    return [new Error('Unable to extract document sources'), []];
  }

  let diagnostics: Diagnostic[] = [];

  try {
    const results = await Promise.all(
      sources.map(async (source) => {
        const errors = await (linter as Linter).verify({
          source,
          moduleId: URI.parse(message.uri).fsPath,
          filePath: URI.parse(message.uri).fsPath,
        });

        return errors.map((error: TemplateLinterError) => toDiagnostic(source, error));
      })
    );

    results.forEach((result) => {
      diagnostics = [...diagnostics, ...result];
    });
  } catch (e) {
    return [e, []];
  }

  return [null, diagnostics];
}

parentPort?.on('message', async (message: LinterMessage) => {
  if (message.action === 'verify') {
    try {
      const [err, diagnostics] = await lintDocument(message);

      parentPort?.postMessage({
        id: message.id,
        error: err,
        diagnostics,
      });
    } catch (e) {
      parentPort?.postMessage({
        id: message.id,
        error: e,
        diagnostics: [],
      });
    }
  } else if (message.action === 'verifyAndFix') {
    try {
      const [err, { isFixed, output }] = await fixDocument(message);

      parentPort?.postMessage({
        id: message.id,
        error: err,
        isFixed,
        output,
      });
    } catch (e) {
      parentPort?.postMessage({
        id: message.id,
        error: e,
        isFixed: false,
        output: '',
      });
    }
  }
});
